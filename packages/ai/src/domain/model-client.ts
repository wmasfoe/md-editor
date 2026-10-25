/**
 * @file domain/model-client.ts
 * @module @md-editor/ai
 * @description
 * 依赖倒置（Dependency Inversion）核心模型抽象契约。
 *
 * App Harness 层仅依赖 `ModelClient` 接口与协议无关的 `ModelContext`，
 * 具体的 OpenAI / Anthropic / Google HTTP 协议转换与 Rust Tauri 本地推理调用
 * 全部下沉至 `adapters/` 层实现。
 */

import type { AiProviderType, AiTaskKind } from "./types.ts";

/** 模型输出格式约束声明 */
export type ModelOutputFormat =
  | { readonly kind: "text" }
  | {
      readonly kind: "json-object";
      readonly schemaName?: string;
      readonly schema?: Readonly<Record<string, unknown>>;
    }
  | {
      /** 本地 llama-server 采样层物理 GBNF 语法硬约束 */
      readonly kind: "gbnf-grammar";
      readonly grammar: string;
    };

/**
 * 原生裸补全载荷（专用于本地小模型超低延迟 FIM 续写，如 Qwen 3 Lite `/completion`）
 */
export interface ModelRawCompletionPayload {
  readonly prompt: string;
  readonly cachePrompt?: boolean;
}

/**
 * 送入任意 `ModelClient` 的标准化推理上下文（对应视频架构中的 ModelContext）。
 *
 * - `instruction` 映射为各协议原生系统指令：
 *   - OpenAI: `messages[0] = { role: "system", content: instruction }`
 *   - Anthropic: 顶层 `system: instruction`
 *   - Google Gemini: 顶层 `systemInstruction: { parts: [{ text: instruction }] }`
 *   - Local SLM: `/v1/chat/completions` 的 `system` 消息（配合 `--jinja` 渲染）
 */
export interface ModelContext {
  /** 系统级角色指令 */
  readonly instruction?: string;
  /** 用户输入正文 */
  readonly prompt: string;
  /** 可选：原生 FIM 裸补全载荷（仅 LocalSlmClient 消费，云端适配器忽略并走 prompt） */
  readonly rawCompletion?: ModelRawCompletionPayload;
  /** 可选：输出结构约束（JSON 对象或本地 GBNF 语法） */
  readonly outputFormat?: ModelOutputFormat;
  /** 最大生成 Token 数 */
  readonly maxTokens?: number;
  /** 采样温度 */
  readonly temperature?: number;
  /** 终止词序列 */
  readonly stopSequences?: readonly string[];
  /** 逻辑任务标识（用于本地 LoRA 动态激活：gec -> scale=1.0，其余 -> scale=0.0） */
  readonly task?: AiTaskKind;
  /** 外部取消信号 */
  readonly signal?: AbortSignal;
  /** 单次请求超时时间（毫秒） */
  readonly timeoutMs?: number;
}

/** 模型标准化响应结构 */
export interface ModelResponse {
  /** 模型生成的纯文本或 JSON 字符串 */
  readonly text: string;
  /** 停止原因（如 stop / length / end_turn / STOP） */
  readonly finishReason?: string;
  /** 端到端请求耗时（毫秒） */
  readonly latencyMs?: number;
}

/**
 * 依赖倒置核心接口：统一抽象云端多协议与端侧本地小模型。
 */
export interface ModelClient {
  readonly providerId: AiProviderType;
  readonly modelId: string;
  generate(context: ModelContext): Promise<ModelResponse>;
}

/** 本地推理标准 ChatML 消息结构 */
export interface LocalChatMessage {
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
}

/**
 * 跨平台本地推理桥接请求结构（RFC-004 规范）。
 *
 * `@md-editor/ai` 保持零平台依赖，桌面端通过实现 `LocalInferenceBridge`
 * 将该请求转发给 Rust 侧 `llama-server` 管理器。
 */
export interface LocalInferenceRequest {
  readonly modelId: string;
  readonly task?: AiTaskKind;
  /** 标准 `/v1/chat/completions` 对话消息列表（GEC / Standard 续写 / Distill） */
  readonly messages?: readonly LocalChatMessage[];
  /** 原生 `/completion` 裸 Prompt（Lite FIM 极速续写） */
  readonly rawPrompt?: string;
  /** GBNF 语法围栏字符串 */
  readonly grammar?: string;
  readonly maxTokens: number;
  readonly temperature: number;
  readonly stop?: readonly string[];
  /** 是否在请求体注入 `chat_template_kwargs: { enable_thinking: false }`（默认 true） */
  readonly disableThinking?: boolean;
  /** 是否启用底层 Prompt KV Cache 复用（默认 true） */
  readonly cachePrompt?: boolean;
}

/** 宿主平台注入的本地小模型推理桥接函数 */
export type LocalInferenceBridge = (request: LocalInferenceRequest) => Promise<string>;
