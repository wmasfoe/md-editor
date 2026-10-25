/**
 * @file adapters/local-slm-client.ts
 * @module @md-editor/ai
 * @description
 * 端侧本地 GGUF 小模型推理适配器（RFC-004 规范）。
 *
 * 通过依赖倒置注入的 `LocalInferenceBridge` 与桌面端 Rust `llama-server` 进程通信：
 * - 当 `context.rawCompletion` 存在时（Lite 0.6B FIM 续写），路由至 `/completion` 原生极速通道；
 * - 其余场景（Lite/Standard GEC、Standard Gemma 4 续写、Distill），路由至 `/v1/chat/completions` 标准对话通道，
 *   并默认附加 `disableThinking: true`（映射为 `chat_template_kwargs: { enable_thinking: false }`）及可选 GBNF 语法围栏。
 */

import type {
  LocalChatMessage,
  LocalInferenceBridge,
  LocalInferenceRequest,
  ModelClient,
  ModelContext,
  ModelResponse,
} from "../domain/model-client.ts";
import { createAbortError, DEFAULT_HTTP_TIMEOUT_MS } from "./http-transport.ts";
import { logLlmError, logLlmRequest, logLlmSuccess } from "./logger.ts";

export class LocalSlmClient implements ModelClient {
  public readonly providerId = "local" as const;
  public readonly modelId: string;
  private readonly bridge: LocalInferenceBridge;

  public constructor(modelId: string, bridge: LocalInferenceBridge) {
    this.modelId = modelId.trim();
    this.bridge = bridge;
  }

  public async generate(context: ModelContext): Promise<ModelResponse> {
    if (context.signal?.aborted) {
      throw createAbortError();
    }

    const startTime = Date.now();
    const grammar =
      context.outputFormat?.kind === "gbnf-grammar" ? context.outputFormat.grammar : undefined;

    let request: LocalInferenceRequest;
    if (context.rawCompletion) {
      request = {
        modelId: this.modelId,
        task: context.task,
        rawPrompt: context.rawCompletion.prompt,
        cachePrompt: context.rawCompletion.cachePrompt ?? true,
        grammar,
        maxTokens: context.maxTokens ?? 64,
        temperature: context.temperature ?? 0.3,
        stop: context.stopSequences,
        disableThinking: true,
      };
    } else {
      const messages: LocalChatMessage[] = [];
      if (context.instruction?.trim()) {
        messages.push({
          role: "system",
          content: context.instruction.trim(),
        });
      }
      messages.push({
        role: "user",
        content: context.prompt,
      });

      request = {
        modelId: this.modelId,
        task: context.task,
        messages,
        grammar,
        maxTokens: context.maxTokens ?? 128,
        temperature: context.temperature ?? 0.0,
        stop: context.stopSequences,
        disableThinking: true,
        cachePrompt: true,
      };
    }

    logLlmRequest("LocalSLM", this.modelId, {
      task: context.task,
      isFim: Boolean(context.rawCompletion),
      temperature: request.temperature,
      maxTokens: request.maxTokens,
      promptPreview: (request.rawPrompt ?? context.prompt).slice(0, 80),
    });

    try {
      const text = await runBridgeWithTimeout(
        () => this.bridge(request),
        context.signal,
        context.timeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS,
      );

      const latencyMs = Date.now() - startTime;
      logLlmSuccess("LocalSLM", this.modelId, {
        latencyMs,
        textPreview: text.slice(0, 100),
      });

      return {
        text,
        latencyMs,
      };
    } catch (error) {
      logLlmError("LocalSLM", this.modelId, {
        latencyMs: Date.now() - startTime,
        error,
      });
      throw error;
    }
  }
}

async function runBridgeWithTimeout(
  run: () => Promise<string>,
  signal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<string> {
  if (signal?.aborted) {
    throw createAbortError();
  }

  return new Promise<string>((resolve, reject) => {
    let settled = false;

    const timer = globalThis.setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      reject(new Error("AI 请求超时，请稍后重试。"));
    }, timeoutMs);

    const onAbort = () => {
      if (settled) {
        return;
      }
      settled = true;
      globalThis.clearTimeout(timer);
      reject(createAbortError());
    };

    signal?.addEventListener("abort", onAbort, { once: true });

    run().then(
      (result) => {
        if (settled) {
          return;
        }
        settled = true;
        globalThis.clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        resolve(result);
      },
      (error: unknown) => {
        if (settled) {
          return;
        }
        settled = true;
        globalThis.clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}
