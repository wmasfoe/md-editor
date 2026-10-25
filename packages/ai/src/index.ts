/**
 * @file index.ts
 * @module @md-editor/ai
 * @description
 * `@md-editor/ai` 组合根与公共导出入口。
 *
 * 分层结构：
 * - `domain/`：纯领域模型、`ModelClient` 依赖倒置契约、多协议配置与预设；
 * - `app/`：平台无关的 App Harness 编排（前置守卫、Prompt/GBNF 构建、后置净化与四重锚点定位、调度器与文档提炼）；
 * - `adapters/`：OpenAI / Anthropic / Google Gemini 云端协议客户端与端侧本地 GGUF 模型客户端。
 */

import { createModelClient } from "./adapters/client-factory.ts";
import { AiWritingService } from "./app/writing-service.ts";
import type { DocumentContextManager } from "./app/document-context.ts";
import type { AiRequestScheduler } from "./app/request-scheduler.ts";
import type { LocalInferenceBridge } from "./domain/model-client.ts";

export * from "./domain/types.ts";
export * from "./domain/model-client.ts";
export * from "./domain/settings.ts";

export * from "./app/cache.ts";
export * from "./app/request-scheduler.ts";
export * from "./app/harness-guardrails.ts";
export * from "./app/harness-prompts.ts";
export * from "./app/document-context.ts";
export * from "./app/writing-service.ts";

export * from "./adapters/http-transport.ts";
export * from "./adapters/openai-client.ts";
export * from "./adapters/anthropic-client.ts";
export * from "./adapters/google-client.ts";
export * from "./adapters/local-slm-client.ts";
export * from "./adapters/client-factory.ts";
export * from "./adapters/logger.ts";

export interface CreateAiWritingServiceOptions {
  /** 当前宿主平台是否允许使用桌面端本地模型（Desktop 为 true，Web / uTools 为 false） */
  readonly allowLocal?: boolean;
  /** 桌面端注入的本地推理桥接器 */
  readonly localBridge?: LocalInferenceBridge;
  /** 可选自定义 HTTP fetch（便于单测注入） */
  readonly fetchImpl?: typeof fetch;
  /** 可选自定义请求调度器 */
  readonly scheduler?: AiRequestScheduler;
  /** 可选自定义文档宏观上下文管理器 */
  readonly documentContext?: DocumentContextManager;
}

/**
 * 组合根工厂：将 `createModelClient` 适配器注入 `AiWritingService` 编排层，
 * 供 Desktop / Web / uTools 三端零重复创建各自运行时的 AI 服务实例。
 */
export function createAiWritingService(
  options: CreateAiWritingServiceOptions = {},
): AiWritingService {
  return new AiWritingService({
    allowLocal: options.allowLocal,
    scheduler: options.scheduler,
    documentContext: options.documentContext,
    resolveClient: (settings, overrides) =>
      createModelClient(settings, {
        localBridge: options.localBridge,
        fetchImpl: overrides?.fetchImpl ?? options.fetchImpl,
      }),
  });
}
