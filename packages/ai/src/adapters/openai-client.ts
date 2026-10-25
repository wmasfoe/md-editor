/**
 * @file adapters/openai-client.ts
 * @module @md-editor/ai
 * @description
 * OpenAI Chat Completions 协议适配器（同时支持自定义 Base URL 接入 DeepSeek、Ollama、LM Studio、vLLM、OpenRouter 等兼容服务）。
 */

import type { ModelClient, ModelContext, ModelResponse } from "../domain/model-client.ts";
import type { AiProtocolEndpointSettings } from "../domain/types.ts";
import {
  extractApiErrorMessage,
  fetchJsonWithTimeout,
  resolveOpenAiChatEndpoint,
} from "./http-transport.ts";

interface OpenAiChatResponse {
  readonly choices?: ReadonlyArray<{
    readonly finish_reason?: string | null;
    readonly message?: {
      readonly content?:
        string | ReadonlyArray<{ readonly type?: string; readonly text?: string }> | null;
    };
  }>;
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

    const messages: Array<{ role: "system" | "user"; content: string }> = [];
    if (context.instruction?.trim()) {
      messages.push({ role: "system", content: context.instruction.trim() });
    }
    messages.push({ role: "user", content: context.prompt });

    const body: Record<string, unknown> = {
      model: this.modelId,
      messages,
      stream: false,
      temperature: context.temperature ?? 0.3,
      max_tokens: context.maxTokens ?? 256,
    };

    if (context.stopSequences && context.stopSequences.length > 0) {
      body.stop = [...context.stopSequences];
    }
    if (context.outputFormat?.kind === "json-object") {
      body.response_format = { type: "json_object" };
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }

    const { ok, status, data } = await fetchJsonWithTimeout({
      url,
      headers,
      body,
      signal: context.signal,
      timeoutMs: context.timeoutMs,
      fetchImpl: this.fetchImpl,
    });

    if (!ok) {
      throw new Error(extractApiErrorMessage(data, status, "OpenAI 兼容服务"));
    }

    const parsed = (data ?? {}) as OpenAiChatResponse;
    const choice = parsed.choices?.[0];
    const rawContent = choice?.message?.content;
    const text =
      typeof rawContent === "string"
        ? rawContent
        : Array.isArray(rawContent)
          ? rawContent.map((part) => (typeof part?.text === "string" ? part.text : "")).join("")
          : "";

    return {
      text,
      finishReason: choice?.finish_reason ?? undefined,
      latencyMs: Date.now() - startTime,
    };
  }
}
