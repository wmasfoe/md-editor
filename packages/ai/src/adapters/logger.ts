/**
 * @file adapters/logger.ts
 * @module @md-editor/ai
 * @description
 * 开发环境下的 AI 推理与 LLM 请求统一结构化日志工具。
 */

export function isDevEnvironment(): boolean {
  try {
    if (
      typeof process !== "undefined" &&
      (process.env?.VITEST || process.env?.NODE_ENV === "test")
    ) {
      return false;
    }
    if (
      typeof import.meta !== "undefined" &&
      (import.meta as unknown as { readonly env?: { readonly DEV?: boolean } }).env?.DEV
    ) {
      return true;
    }
    if (typeof process !== "undefined" && process.env?.NODE_ENV === "development") {
      return true;
    }
  } catch {
    // 忽略异常，默认生产环境安全静默
  }
  return false;
}

export function logLlmRequest(
  provider: string,
  modelId: string,
  details: {
    readonly url?: string;
    readonly task?: string;
    readonly promptPreview?: string;
    readonly [key: string]: unknown;
  },
): void {
  if (!isDevEnvironment()) {
    return;
  }
  console.debug(`[AI LLM:${provider}] ▶ 发起推理请求 (${modelId})`, details);
}

export function logLlmSuccess(
  provider: string,
  modelId: string,
  details: {
    readonly latencyMs?: number;
    readonly finishReason?: string;
    readonly textPreview?: string;
    readonly [key: string]: unknown;
  },
): void {
  if (!isDevEnvironment()) {
    return;
  }
  console.debug(`[AI LLM:${provider}] ✔ 推理成功 (${modelId})`, details);
}

export function logLlmRetry(
  provider: string,
  modelId: string,
  details: {
    readonly attempt: number;
    readonly reason: string;
    readonly [key: string]: unknown;
  },
): void {
  if (!isDevEnvironment()) {
    return;
  }
  console.warn(`[AI LLM:${provider}] 🔄 自愈重试 (${modelId})`, details);
}

export function logLlmError(
  provider: string,
  modelId: string,
  details: {
    readonly latencyMs?: number;
    readonly error: unknown;
    readonly [key: string]: unknown;
  },
): void {
  if (!isDevEnvironment()) {
    return;
  }
  console.error(`[AI LLM:${provider}] ✖ 推理失败 (${modelId})`, details);
}
