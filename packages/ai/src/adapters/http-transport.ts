/**
 * @file adapters/http-transport.ts
 * @module @md-editor/ai
 * @description
 * 云端多协议 HTTP 传输辅助层：处理自定义 Base URL 路由规范化、AbortSignal 联动超时控制与统一错误消息提取。
 */

/** 默认云端 HTTP 请求超时时间（毫秒） */
export const DEFAULT_HTTP_TIMEOUT_MS = 30_000;

/**
 * 规范化 OpenAI 兼容协议的 Chat Completions 完整请求 URL。
 *
 * 兼容场景：
 * - `https://api.openai.com/v1` -> `https://api.openai.com/v1/chat/completions`
 * - `https://api.openai.com` -> `https://api.openai.com/v1/chat/completions`
 * - `https://api.deepseek.com` -> `https://api.deepseek.com/chat/completions`
 * - `http://localhost:11434/v1` -> `http://localhost:11434/v1/chat/completions`
 * - `http://localhost:11434` -> `http://localhost:11434/v1/chat/completions`
 * - 已包含 `/chat/completions` 的完整自定义代理地址原样保留
 */
export function resolveOpenAiChatEndpoint(baseUrl: string): string {
  const clean = stripTrailingSlashes(baseUrl);
  if (!clean) {
    throw new Error("OpenAI 协议 Base URL 不能为空。");
  }
  if (clean.endsWith("/chat/completions")) {
    return clean;
  }

  try {
    const parsed = new URL(clean);
    const pathname = parsed.pathname.replace(/\/+$/u, "");
    if (!pathname && !parsed.hostname.toLowerCase().endsWith("deepseek.com")) {
      return `${clean}/v1/chat/completions`;
    }
  } catch {
    // 非标准相对路径或测试桩路径直接拼接 /chat/completions
  }

  return `${clean}/chat/completions`;
}

/**
 * 规范化 Anthropic Messages API 完整请求 URL。
 *
 * 兼容场景：
 * - `https://api.anthropic.com` -> `https://api.anthropic.com/v1/messages`
 * - `https://custom-claude-proxy.example.com/v1` -> `https://custom-claude-proxy.example.com/v1/messages`
 * - 已包含 `/messages` 的完整自定义路径原样保留
 */
export function resolveAnthropicMessagesEndpoint(baseUrl: string): string {
  const clean = stripTrailingSlashes(baseUrl);
  if (!clean) {
    throw new Error("Anthropic 协议 Base URL 不能为空。");
  }
  if (clean.endsWith("/messages")) {
    return clean;
  }
  if (clean.endsWith("/v1")) {
    return `${clean}/messages`;
  }
  return `${clean}/v1/messages`;
}

/**
 * 规范化 Google Gemini `generateContent` 完整请求 URL。
 *
 * 兼容场景：
 * - `https://generativelanguage.googleapis.com` + `gemini-2.5-flash`
 *   -> `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent`
 * - `https://my-gemini-gateway.example.com/v1beta` + `models/gemini-2.5-pro`
 *   -> `https://my-gemini-gateway.example.com/v1beta/models/gemini-2.5-pro:generateContent`
 */
export function resolveGoogleGenerateContentEndpoint(baseUrl: string, model: string): string {
  const clean = stripTrailingSlashes(baseUrl);
  if (!clean) {
    throw new Error("Google Gemini 协议 Base URL 不能为空。");
  }
  if (clean.includes(":generateContent")) {
    return clean;
  }

  const cleanModel = model.trim().replace(/^models\//u, "");
  if (!cleanModel) {
    throw new Error("Google Gemini 模型名称不能为空。");
  }

  const encodedModel = encodeURIComponent(cleanModel);
  if (/\/v1(?:beta)?$/u.test(clean)) {
    return `${clean}/models/${encodedModel}:generateContent`;
  }
  return `${clean}/v1beta/models/${encodedModel}:generateContent`;
}

/**
 * 执行带超时控制与外部 `AbortSignal` 级联取消的 HTTP 请求。
 *
 * - 当外部 `signal` 主动取消（例如用户继续打字）时，抛出标准 `AbortError`；
 * - 当达到 `timeoutMs` 超时时，抛出用户可读的超时错误提示。
 */
export async function fetchJsonWithTimeout(options: {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}): Promise<{ readonly status: number; readonly ok: boolean; readonly data: unknown }> {
  const fetchFn = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS;

  if (options.signal?.aborted) {
    throw createAbortError();
  }

  const controller = new AbortController();
  let timedOut = false;

  const timer = globalThis.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const onParentAbort = () => {
    controller.abort();
  };
  options.signal?.addEventListener("abort", onParentAbort, { once: true });

  try {
    const response = await fetchFn(options.url, {
      method: "POST",
      headers: options.headers,
      body: JSON.stringify(options.body),
      signal: controller.signal,
    });

    let data: unknown = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }

    return {
      status: response.status,
      ok: response.ok,
      data,
    };
  } catch (error) {
    if (timedOut) {
      throw new Error("AI 请求超时，请稍后重试。", { cause: error });
    }
    if (options.signal?.aborted || isAbortError(error)) {
      throw createAbortError();
    }
    throw error;
  } finally {
    options.signal?.removeEventListener("abort", onParentAbort);
    globalThis.clearTimeout(timer);
  }
}

/**
 * 从不同云厂商（OpenAI / Anthropic / Google）错误响应体中提取可读错误信息。
 */
export function extractApiErrorMessage(
  data: unknown,
  status: number,
  providerLabel: string,
): string {
  if (typeof data === "object" && data !== null) {
    const record = data as Record<string, unknown>;
    if (typeof record.error === "object" && record.error !== null) {
      const errObj = record.error as Record<string, unknown>;
      if (typeof errObj.message === "string" && errObj.message.trim()) {
        return errObj.message.trim();
      }
    }
    if (typeof record.error === "string" && record.error.trim()) {
      return record.error.trim();
    }
    if (typeof record.message === "string" && record.message.trim()) {
      return record.message.trim();
    }
  }
  return `${providerLabel} 请求失败：HTTP ${status}`;
}

/**
 * 创建标准取消异常（`name === "AbortError"`）。
 */
export function createAbortError(message = "AI 请求已取消。"): Error {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

/**
 * 判断异常是否属于主动取消信号触发的 `AbortError`。
 */
export function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

function stripTrailingSlashes(value: string): string {
  return value.trim().replace(/\/+$/u, "");
}
