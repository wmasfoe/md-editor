/**
 * @file adapters/google-client.ts
 * @module @md-editor/ai
 * @description
 * Google Gemini REST API (`/v1beta/models/{model}:generateContent`) 原生协议适配器（支持官方 Gemini 与自定义反向代理 URL）。
 */

import type { ModelClient, ModelContext, ModelResponse } from "../domain/model-client.ts";
import type { AiProtocolEndpointSettings } from "../domain/types.ts";
import {
  extractApiErrorMessage,
  fetchJsonWithTimeout,
  resolveGoogleGenerateContentEndpoint,
} from "./http-transport.ts";

interface GoogleGenerateContentResponse {
  readonly candidates?: ReadonlyArray<{
    readonly finishReason?: string;
    readonly content?: {
      readonly parts?: ReadonlyArray<{
        readonly text?: string;
        readonly thought?: boolean;
      }>;
    };
  }>;
}

export class GoogleClient implements ModelClient {
  public readonly providerId = "google" as const;
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
    const url = resolveGoogleGenerateContentEndpoint(this.baseUrl, this.modelId);

    const generationConfig: Record<string, unknown> = {
      maxOutputTokens: context.maxTokens ?? 256,
    };

    if (typeof context.temperature === "number") {
      generationConfig.temperature = context.temperature;
    }
    if (context.stopSequences && context.stopSequences.length > 0) {
      generationConfig.stopSequences = [...context.stopSequences];
    }
    if (context.outputFormat?.kind === "json-object") {
      generationConfig.responseMimeType = "application/json";
    }

    // 针对支持 0 预算关闭思考的 gemini-2.5-flash 系列，显式关闭思考以降低行内响应延迟并避免耗尽 maxOutputTokens
    const normalizedModel = this.modelId.replace(/^models\//u, "");
    if (/^gemini-2\.5-flash/iu.test(normalizedModel)) {
      generationConfig.thinkingConfig = { thinkingBudget: 0 };
    }

    const body: Record<string, unknown> = {
      contents: [
        {
          role: "user",
          parts: [{ text: context.prompt }],
        },
      ],
      generationConfig,
    };

    if (context.instruction?.trim()) {
      body.systemInstruction = {
        parts: [{ text: context.instruction.trim() }],
      };
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.apiKey) {
      headers["x-goog-api-key"] = this.apiKey;
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
      throw new Error(extractApiErrorMessage(data, status, "Google Gemini 服务"));
    }

    const parsed = (data ?? {}) as GoogleGenerateContentResponse;
    const candidate = parsed.candidates?.[0];
    const text = (candidate?.content?.parts ?? [])
      .filter((part) => !part.thought && typeof part.text === "string")
      .map((part) => part.text ?? "")
      .join("");

    return {
      text,
      finishReason: candidate?.finishReason,
      latencyMs: Date.now() - startTime,
    };
  }
}
