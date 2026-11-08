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

/** 提示词与输出属于用户私人内容、任何日志都不能打印正文的任务 */
const CONTENT_REDACTED_TASKS: ReadonlySet<string> = new Set(["style-analysis"]);

/**
 * 判断某个任务的提示词与模型输出是否允许出现在日志中。
 */
export function mayLogTaskContent(task: string | undefined): boolean {
  return task === undefined || !CONTENT_REDACTED_TASKS.has(task);
}

/**
 * 去掉不允许打印的正文预览，只保留长度。日志函数统一经过这里，调用方漏处理也不会泄漏。
 */
export function redactLlmLogDetails<T extends Record<string, unknown>>(
  details: T,
): T | Record<string, unknown> {
  const task = typeof details.task === "string" ? details.task : undefined;
  if (mayLogTaskContent(task)) {
    return details;
  }
  const { promptPreview, textPreview, ...rest } = details;
  return {
    ...rest,
    ...(typeof promptPreview === "string" ? { promptLength: promptPreview.length } : {}),
    ...(typeof textPreview === "string" ? { textLength: textPreview.length } : {}),
    contentRedacted: true,
  };
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
  console.debug(`[AI LLM:${provider}] ▶ 发起推理请求 (${modelId})`, redactLlmLogDetails(details));
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
  console.debug(`[AI LLM:${provider}] ✔ 推理成功 (${modelId})`, redactLlmLogDetails(details));
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
  console.warn(`[AI LLM:${provider}] 🔄 自愈重试 (${modelId})`, redactLlmLogDetails(details));
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
  console.error(`[AI LLM:${provider}] ✖ 推理失败 (${modelId})`, redactLlmLogDetails(details));
}
