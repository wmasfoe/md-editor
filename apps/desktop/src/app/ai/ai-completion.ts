import type {
  AiCompletionContext,
  AiSettings,
  AiWritingEditSuggestion,
  AiWritingSuggestion
} from "@md-editor/editor-core";

export interface AiContinuationRequestOptions {
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

interface OpenAiChatCompletionResponse {
  readonly choices?: Array<{
    readonly message?: {
      readonly content?: string | null;
    };
  }>;
  readonly error?: {
    readonly message?: string;
  };
}

const DEFAULT_AI_TIMEOUT_MS = 30_000;
const CONTEXT_WINDOW = 3_000;

export function getAiCompletionReadiness(settings: AiSettings): string | null {
  if (!settings.enabled) {
    return "请先在设置中开启 AI 功能。";
  }
  if (!settings.features.continuation && !settings.features.editing) {
    return "请先开启 AI 续写或语法标点修复。";
  }

  if (settings.provider === "local") {
    if (!settings.localModel.enabled) {
      return "请先在设置中启用本地模型。";
    }
    if (settings.localModel.status !== "available") {
      return "本地模型尚未下载，当前还不能续写。";
    }
    return null;
  }

  if (!settings.openAiCompatible.baseUrl.trim()) {
    return "请先配置 OpenAI-compatible endpoint。";
  }
  if (!settings.openAiCompatible.model.trim()) {
    return "请先配置 AI 模型名称。";
  }
  if (!settings.openAiCompatible.apiKey.trim()) {
    return "请先配置 OpenAI-compatible API Key。";
  }

  return null;
}

export async function requestAiContinuation(
  settings: AiSettings,
  context: AiCompletionContext,
  options: AiContinuationRequestOptions = {}
): Promise<AiWritingSuggestion> {
  const readiness = getAiCompletionReadiness(settings);
  if (readiness) {
    throw new Error(readiness);
  }

  if (settings.provider === "local") {
    throw new Error("本地模型续写还未接入，当前请先使用 OpenAI-compatible provider。");
  }

  return requestOpenAiCompatibleContinuation(settings, context, options);
}

export function createOpenAiCompatibleRequestBody(
  settings: AiSettings,
  context: AiCompletionContext
): unknown {
  return {
    model: settings.openAiCompatible.model.trim(),
    stream: false,
    temperature: 0.7,
    max_tokens: 220,
    messages: [
      {
        role: "system",
        content: [
          "你是 Markdown 写作助手，需要同时给出光标处续写建议和当前句子的语法/标点修复建议。",
          "只返回 JSON，不要解释，不要添加代码围栏。",
          "JSON schema: {\"continuation\":\"string\",\"edit\":{\"original\":\"string\",\"replacement\":\"string\",\"reason\":\"string\"}}。",
          settings.features.continuation
            ? "continuation 是要插入到光标处的续写内容，可以为空字符串。"
            : "continuation 必须返回空字符串，因为用户关闭了 AI 续写。",
          settings.features.editing
            ? "edit.original 必须是光标附近上下文中逐字存在的原文片段；没有明确问题时 edit 设为 null。"
            : "edit 必须返回 null，因为用户关闭了语法、标点修复。",
          "edit.replacement 只能修复语法、错别字、标点或轻微表达，不要改写整段。",
          "保持原文语言、语气和 Markdown/MDX 格式边界。"
        ].join("\n")
      },
      {
        role: "user",
        content: [
          "请根据以下上下文返回 JSON 建议。",
          "",
          "【光标前】",
          trimContext(context.before),
          "",
          context.selectedText ? "【当前选中文本】" : "",
          context.selectedText ? context.selectedText : "",
          "",
          "【光标后】",
          trimContext(context.after),
          "",
          "只输出 JSON。"
        ].filter(Boolean).join("\n")
      }
    ]
  };
}

async function requestOpenAiCompatibleContinuation(
  settings: AiSettings,
  context: AiCompletionContext,
  options: AiContinuationRequestOptions
): Promise<AiWritingSuggestion> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_AI_TIMEOUT_MS);
  const fetchImpl = options.fetchImpl ?? fetch;
  const abortFromParent = () => controller.abort();
  if (options.signal?.aborted) {
    controller.abort();
  } else {
    options.signal?.addEventListener("abort", abortFromParent, { once: true });
  }

  try {
    const response = await fetchImpl(`${settings.openAiCompatible.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${settings.openAiCompatible.apiKey}`
      },
      body: JSON.stringify(createOpenAiCompatibleRequestBody(settings, context)),
      signal: controller.signal
    });
    const body = await readOpenAiResponse(response);

    if (!response.ok) {
      throw new Error(body.error?.message || `AI 请求失败：HTTP ${response.status}`);
    }

    const content = body.choices?.[0]?.message?.content?.trim() ?? "";
    const suggestion = filterAiSuggestionBySettings(parseAiWritingSuggestion(content), settings);
    if (!suggestion.continuation && !suggestion.edit) {
      throw new Error("AI 没有返回可展示的写作建议。");
    }
    return suggestion;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("AI 续写超时，请稍后重试。");
    }
    throw error;
  } finally {
    options.signal?.removeEventListener("abort", abortFromParent);
    globalThis.clearTimeout(timeout);
  }
}

function filterAiSuggestionBySettings(
  suggestion: AiWritingSuggestion,
  settings: AiSettings
): AiWritingSuggestion {
  return {
    ...(settings.features.continuation && suggestion.continuation
      ? { continuation: suggestion.continuation }
      : {}),
    ...(settings.features.editing && suggestion.edit
      ? { edit: suggestion.edit }
      : {})
  };
}

export function parseAiWritingSuggestion(content: string): AiWritingSuggestion {
  const parsed = parseJsonObject(extractJsonObject(content));
  if (!parsed) {
    return { continuation: normalizeSuggestionText(content) };
  }

  const continuation = normalizeSuggestionText(readStringProperty(parsed, "continuation"));
  const editInput = readObjectProperty(parsed, "edit");
  const edit = editInput ? normalizeEditSuggestion(editInput) : undefined;
  return {
    ...(continuation ? { continuation } : {}),
    ...(edit ? { edit } : {})
  };
}

async function readOpenAiResponse(response: Response): Promise<OpenAiChatCompletionResponse> {
  try {
    return await response.json() as OpenAiChatCompletionResponse;
  } catch {
    return {};
  }
}

function trimContext(value: string): string {
  if (value.length <= CONTEXT_WINDOW) {
    return value;
  }
  return value.slice(-CONTEXT_WINDOW);
}

function normalizeEditSuggestion(input: Record<string, unknown>): AiWritingEditSuggestion | undefined {
  const original = normalizeSuggestionText(readStringProperty(input, "original"));
  const replacement = normalizeSuggestionText(readStringProperty(input, "replacement"));
  if (!original || !replacement || original === replacement) {
    return undefined;
  }

  const reason = normalizeSuggestionText(readStringProperty(input, "reason"));
  return {
    original,
    replacement,
    ...(reason ? { reason } : {})
  };
}

function normalizeSuggestionText(value: string): string {
  return value.trim();
}

function extractJsonObject(content: string): string {
  const trimmed = content.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  return start >= 0 && end > start ? trimmed.slice(start, end + 1) : trimmed;
}

function parseJsonObject(content: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(content) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function readStringProperty(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  return typeof value === "string" ? value : "";
}

function readObjectProperty(input: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const value = input[key];
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
