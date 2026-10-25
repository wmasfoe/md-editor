/**
 * @file adapters/client-factory.ts
 * @module @md-editor/ai
 * @description
 * `ModelClient` 适配器工厂：根据当前 `AiSettings.provider` 动态装配对应的协议客户端实例。
 */

import type { LocalInferenceBridge, ModelClient } from "../domain/model-client.ts";
import type { AiSettings } from "../domain/types.ts";
import { AnthropicClient } from "./anthropic-client.ts";
import { GoogleClient } from "./google-client.ts";
import { LocalSlmClient } from "./local-slm-client.ts";
import { OpenAIClient } from "./openai-client.ts";

export interface ModelClientFactoryDeps {
  readonly fetchImpl?: typeof fetch;
  readonly localBridge?: LocalInferenceBridge;
}

/**
 * 根据全局 `AiSettings` 创建解耦的 `ModelClient` 实例。
 */
export function createModelClient(
  settings: AiSettings,
  deps: ModelClientFactoryDeps = {},
): ModelClient {
  switch (settings.provider) {
    case "local": {
      if (!deps.localBridge) {
        throw new Error("当前平台未注入本地模型推理桥接器 (localBridge)。");
      }
      return new LocalSlmClient(settings.localModel.modelId, deps.localBridge);
    }
    case "anthropic":
      return new AnthropicClient(settings.endpoints.anthropic, { fetchImpl: deps.fetchImpl });
    case "google":
      return new GoogleClient(settings.endpoints.google, { fetchImpl: deps.fetchImpl });
    case "openai":
      return new OpenAIClient(settings.endpoints.openai, { fetchImpl: deps.fetchImpl });
  }
}
