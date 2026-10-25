/**
 * @file adapters/openai-client.ts
 * @module @md-editor/ai
 * @description
 * OpenAI Chat Completions 协议适配器（同时支持自定义 Base URL 接入 DeepSeek、Ollama、LM Studio、vLLM、OpenRouter 等兼容服务）。
 *
 * 智能适配：
 * 1. 自动识别 OpenAI 推理模型（o1、o3、o4 系列）：
 *    - 自动转用 `max_completion_tokens` 并配置保底 token 预算（防止推理思维链消耗完毕导致输出为空）；
 *    - 移除不兼容的 `temperature` 参数；
 *    - o1 / o3 标准模型使用 `developer` 角色，早期 o1-mini / o1-preview 自动将指令合并入 user prompt；
 * 2. 具备 400 错误自愈能力：若第三方网关或新版端点报告 max_tokens / max_completion_tokens / temperature / role 不兼容，
 *    客户端在底层自动修正 payload 重试，避免前台直接报错打扰用户。
 */

import type { ModelClient, ModelContext, ModelResponse } from "../domain/model-client.ts";
import type { AiProtocolEndpointSettings } from "../domain/types.ts";
import {
  extractApiErrorMessage,
  fetchJsonWithTimeout,
  resolveOpenAiChatEndpoint,
} from "./http-transport.ts";
import { logLlmError, logLlmRequest, logLlmRetry, logLlmSuccess } from "./logger.ts";

interface OpenAiChatResponse {
  readonly choices?: ReadonlyArray<{
    readonly finish_reason?: string | null;
    readonly message?: {
      readonly content?:
        string | ReadonlyArray<{ readonly type?: string; readonly text?: string }> | null;
    };
  }>;
}

/**
 * 判断指定模型是否属于 OpenAI 推理模型（如 o1, o1-mini, o1-preview, o3-mini 等）。
 *
 * 推理模型特点：
 * 1. 不支持 legacy 的 `max_tokens` 参数，必须使用 `max_completion_tokens`；
 * 2. 内部思维链（reasoning tokens）会计入 completion 预算，预算过低（如默认 256）会导致无法输出有效结果；
 * 3. 不支持自定义 `temperature` 参数（传入会直接返回 HTTP 400 Unsupported parameter: 'temperature'）；
 * 4. 早期模型（o1-mini、o1-preview）不支持 system / developer 角色，需整合到 user prompt；
 * 5. o1 / o3 系列支持 `developer` 角色替代 `system` 角色。
 */
export function isOpenAiReasoningModel(modelId: string): boolean {
  const normalized = modelId.trim().toLowerCase();
  return /(?:^|\/)(?:o[1-9]|o[1-9]-)/iu.test(normalized);
}

/**
 * 判断指定模型是否为仅支持纯 user 角色的早期 o1 模型（o1-mini, o1-preview）。
 */
export function isEarlyOpenAiReasoningModel(modelId: string): boolean {
  const normalized = modelId.trim().toLowerCase();
  return /(?:^|\/)o1-(?:mini|preview)/iu.test(normalized);
}

/**
 * 构造 OpenAI 消息列表，根据模型特性自适应选择 system / developer / 纯 user。
 */
export function buildOpenAiMessages(
  modelId: string,
  instruction: string | undefined,
  prompt: string,
): Array<{ role: "system" | "user" | "developer"; content: string }> {
  const trimmedInstruction = instruction?.trim();
  const isReasoning = isOpenAiReasoningModel(modelId);
  const isEarly = isEarlyOpenAiReasoningModel(modelId);

  if (!trimmedInstruction) {
    return [{ role: "user", content: prompt }];
  }

  if (isEarly) {
    return [
      {
        role: "user",
        content: `[Instruction]\n${trimmedInstruction}\n\n[Content]\n${prompt}`,
      },
    ];
  }

  if (isReasoning) {
    return [
      { role: "developer", content: trimmedInstruction },
      { role: "user", content: prompt },
    ];
  }

  return [
    { role: "system", content: trimmedInstruction },
    { role: "user", content: prompt },
  ];
}

/**
 * 构造符合 OpenAI 协议的请求体。
 */
export function buildOpenAiRequestBody(
  modelId: string,
  context: ModelContext,
  messages: Array<{ role: "system" | "user" | "developer"; content: string }>,
): Record<string, unknown> {
  const isReasoning = isOpenAiReasoningModel(modelId);
  const body: Record<string, unknown> = {
    model: modelId,
    messages: [...messages],
    stream: false,
  };

  if (isReasoning) {
    // 推理模型强制使用 max_completion_tokens，且思维链 tokens 共享预算，保底 1024
    body.max_completion_tokens = Math.max(context.maxTokens ?? 256, 1024);
    // 推理模型严格禁止传入 temperature
  } else {
    // 兼容传统 OpenAI 兼容端点（如旧版 Ollama/vLLM）
    body.max_tokens = context.maxTokens ?? 256;
    if (typeof context.temperature === "number") {
      body.temperature = context.temperature;
    } else {
      body.temperature = 0.3;
    }
  }

  if (context.stopSequences && context.stopSequences.length > 0) {
    body.stop = [...context.stopSequences];
  }
  if (context.outputFormat?.kind === "json-object") {
    body.response_format = { type: "json_object" };
  }

  return body;
}

export class OpenAIClient implements ModelClient {
  public readonly providerId = "openai" as const;
  public readonly modelId: string;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl?: typeof fetch;

  public constructor(
    endpoint: AiProtocolEndpointSettings,
    options: { readonly fetchImpl?: typeof fetch } = {},
  ) {
    this.baseUrl = endpoint.baseUrl.trim();
    this.modelId = endpoint.model.trim();
    this.apiKey = endpoint.apiKey.trim();
    this.fetchImpl = options.fetchImpl;
  }

  public async generate(context: ModelContext): Promise<ModelResponse> {
    const startTime = Date.now();
    const url = resolveOpenAiChatEndpoint(this.baseUrl);

    const messages = buildOpenAiMessages(this.modelId, context.instruction, context.prompt);
    const body = buildOpenAiRequestBody(this.modelId, context, messages);

    logLlmRequest("OpenAI", this.modelId, {
      url,
      task: context.task,
      temperature: body.temperature,
      maxTokens: body.max_tokens ?? body.max_completion_tokens,
      promptPreview: context.prompt.slice(0, 80),
    });

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }

    let lastError: Error | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const { ok, status, data } = await fetchJsonWithTimeout({
        url,
        headers,
        body,
        signal: context.signal,
        timeoutMs: context.timeoutMs,
        fetchImpl: this.fetchImpl,
      });

      if (ok) {
        const parsed = (data ?? {}) as OpenAiChatResponse;
        const choice = parsed.choices?.[0];
        const rawContent = choice?.message?.content;
        const text =
          typeof rawContent === "string"
            ? rawContent
            : Array.isArray(rawContent)
              ? rawContent.map((part) => (typeof part?.text === "string" ? part.text : "")).join("")
              : "";

        const latencyMs = Date.now() - startTime;
        logLlmSuccess("OpenAI", this.modelId, {
          latencyMs,
          finishReason: choice?.finish_reason ?? undefined,
          textPreview: text.slice(0, 100),
        });

        return {
          text,
          finishReason: choice?.finish_reason ?? undefined,
          latencyMs,
        };
      }

      const rawMessage = extractApiErrorMessage(data, status, "OpenAI 兼容服务");
      lastError = new Error(rawMessage);

      // 自愈重试：当服务返回 HTTP 400 并提示参数不支持时，动态自愈调整 payload
      if (status === 400 && attempt < 2) {
        let adapted = false;
        const lowerMsg = rawMessage.toLowerCase();

        // 1. 服务端要求使用 max_completion_tokens（例如未在正则中命中的推理模型，或开启了严格校验的新版端点）
        if (
          "max_tokens" in body &&
          (lowerMsg.includes("max_completion_tokens") ||
            (lowerMsg.includes("max_tokens") &&
              (lowerMsg.includes("unsupported") || lowerMsg.includes("not supported"))))
        ) {
          const maxVal = (body.max_tokens as number) ?? 256;
          delete body.max_tokens;
          body.max_completion_tokens = Math.max(maxVal, 1024);
          // 推理模型通常也不允许 temperature，顺便清理
          delete body.temperature;
          adapted = true;
        } else if (
          "max_completion_tokens" in body &&
          lowerMsg.includes("max_completion_tokens") &&
          (lowerMsg.includes("unsupported") ||
            lowerMsg.includes("not supported") ||
            lowerMsg.includes("unrecognized") ||
            lowerMsg.includes("unknown"))
        ) {
          // 2. 服务端为老旧代理，不支持 max_completion_tokens，回退到 max_tokens
          const maxVal = (body.max_completion_tokens as number) ?? 256;
          delete body.max_completion_tokens;
          body.max_tokens = Math.min(maxVal, 4096);
          adapted = true;
        }

        // 3. 服务端不支持 temperature（例如推理模型）
        if (
          "temperature" in body &&
          lowerMsg.includes("temperature") &&
          (lowerMsg.includes("unsupported") || lowerMsg.includes("not supported"))
        ) {
          delete body.temperature;
          adapted = true;
        }

        // 4. 服务端不支持 developer 或 system 角色
        if (
          lowerMsg.includes("role") ||
          lowerMsg.includes("system") ||
          lowerMsg.includes("developer")
        ) {
          const msgList = body.messages as Array<{ role: string; content: string }>;
          if (Array.isArray(msgList) && msgList.length > 1) {
            const nonUser = msgList.filter((m) => m.role !== "user");
            const userMsg = msgList.find((m) => m.role === "user");
            if (nonUser.length > 0 && userMsg) {
              const prefix = nonUser.map((m) => `[Instruction]\n${m.content}`).join("\n\n");
              body.messages = [
                { role: "user", content: `${prefix}\n\n[Content]\n${userMsg.content}` },
              ];
              adapted = true;
            }
          }
        }

        if (adapted) {
          logLlmRetry("OpenAI", this.modelId, {
            attempt: attempt + 1,
            reason: rawMessage,
            adaptedBody: body,
          });
          continue;
        }
      }

      logLlmError("OpenAI", this.modelId, {
        latencyMs: Date.now() - startTime,
        error: lastError.message,
      });
      throw lastError;
    }

    logLlmError("OpenAI", this.modelId, {
      latencyMs: Date.now() - startTime,
      error: lastError?.message ?? "OpenAI 兼容服务请求失败",
    });
    throw lastError ?? new Error("OpenAI 兼容服务请求失败");
  }
}
