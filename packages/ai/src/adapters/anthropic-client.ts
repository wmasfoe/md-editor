/**
 * @file adapters/anthropic-client.ts
 * @module @md-editor/ai
 * @description
 * Anthropic Messages API (`/v1/messages`) 原生协议适配器（支持官方 Claude 与自定义 Anthropic 兼容网关）。
 *
 * 自动注入 `anthropic-version: 2023-06-01` 与 `anthropic-dangerous-direct-browser-access: true`，
 * 确保在 Web 浏览器、Tauri WebView 与 uTools 容器中直连无 CORS 阻断。
 */

import type { ModelClient, ModelContext, ModelResponse } from "../domain/model-client.ts";
import type { AiProtocolEndpointSettings } from "../domain/types.ts";
import {
  extractApiErrorMessage,
  fetchJsonWithTimeout,
  resolveAnthropicMessagesEndpoint,
} from "./http-transport.ts";

interface AnthropicMessagesResponse {
  readonly stop_reason?: string | null;
  readonly content?: ReadonlyArray<{
    readonly type?: string;
    readonly text?: string;
  }>;
}

export class AnthropicClient implements ModelClient {
  public readonly providerId = "anthropic" as const;
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
    const url = resolveAnthropicMessagesEndpoint(this.baseUrl);

    const body: Record<string, unknown> = {
      model: this.modelId,
      max_tokens: context.maxTokens ?? 256,
      messages: [{ role: "user", content: context.prompt }],
    };

    if (context.instruction?.trim()) {
      body.system = context.instruction.trim();
    }
    if (typeof context.temperature === "number") {
      body.temperature = context.temperature;
    }
    if (context.stopSequences && context.stopSequences.length > 0) {
      body.stop_sequences = [...context.stopSequences];
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    };
    if (this.apiKey) {
      headers["x-api-key"] = this.apiKey;
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
      throw new Error(extractApiErrorMessage(data, status, "Anthropic 服务"));
    }

    const parsed = (data ?? {}) as AnthropicMessagesResponse;
    const text = (parsed.content ?? [])
      .filter((block) => block.type === "text" && typeof block.text === "string")
      .map((block) => block.text ?? "")
      .join("");

    return {
      text,
      finishReason: parsed.stop_reason ?? undefined,
      latencyMs: Date.now() - startTime,
    };
  }
}
