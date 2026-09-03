import { resolveCapabilityProfile } from "./slm-protocol.ts";

import {
  locateCloudEditSuggestion,
  parseTupleDiffOutput,
  resolveTripleDefenseDiffs,
} from "./tuple-diff-parser.ts";
import type {
  AiContextSnapshot,
  AiContinuationRequestOptions,
  AiSettings,
  AiWritingEditSuggestion,
  AiWritingSuggestion,
} from "./types.ts";

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

export interface AiPromptContext {
  readonly before: string;
  readonly selectedText: string;
  readonly after: string;
  readonly mode: AiContextSnapshot["mode"];
  readonly filePath?: string | null;
}

const DEFAULT_AI_TIMEOUT_MS = 30_000;
const CONTEXT_WINDOW = 3_000;

export function getAiCompletionReadiness(
  settings: AiSettings,
  intent: "continuation" | "editing" | "both" | "distill" = "both",
): string | null {
  if (!settings.enabled) {
    return "请先在设置中开启 AI 功能。";
  }

  if (intent === "distill") {
    if (settings.provider === "local") {
      if (!settings.localModel.enabled) {
        return "请先在设置中启用本地模型。";
      }
      if (settings.localModel.status !== "available") {
        return "本地模型尚未下载，当前还不能使用 AI。";
      }
      return null;
    }
    return null;
  }

  if (intent === "continuation" && !settings.features.continuation) {
    return "请先在设置中开启 AI 续写功能。";
  }
  if (intent === "editing" && !settings.features.editing) {
    return "请先在设置中开启语法标点修复功能。";
  }
  if (!settings.features.continuation && !settings.features.editing) {
    return "请先开启 AI 续写或语法标点修复。";
  }

  if (settings.provider === "local") {
    if (!settings.localModel.enabled) {
      return "请先在设置中启用本地模型。";
    }
    if (settings.localModel.status !== "available") {
      return "本地模型尚未下载，当前还不能使用 AI。";
    }
    return null;
  }

  if (!settings.openAiCompatible.baseUrl.trim()) {
    return "请先配置 AI endpoint。";
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
  context: AiContextSnapshot,
  options: AiContinuationRequestOptions = {},
): Promise<AiWritingSuggestion> {
  const readiness = getAiCompletionReadiness(settings, options.intent ?? "both");
  if (readiness) {
    throw new Error(readiness);
  }

  if (settings.provider === "local") {
    return requestLocalAiContinuation(settings, context, options);
  }

  return requestOpenAiCompatibleContinuation(settings, context, options);
}

export function createOpenAiCompatibleRequestBody(
  settings: AiSettings,
  context: AiContextSnapshot,
  options: AiContinuationRequestOptions = {},
): unknown {
  const promptContext = createAiPromptContext(context);
  const intent = options.intent ?? "both";
  const allowContinuation = intent !== "editing" && settings.features.continuation;
  const allowEditing = intent !== "continuation" && settings.features.editing;

  return {
    model: settings.openAiCompatible.model.trim(),
    stream: false,
    temperature: allowContinuation ? 0.7 : 0.3,
    max_tokens: 300,
    ...(shouldDisableDeepSeekThinking(settings)
      ? { extra_body: { thinking: { type: "disabled" } } }
      : {}),
    messages: [
      {
        role: "system",
        content: [
          "你是专业的 Markdown 写作与润色助手，提供光标处续写建议与语法/错别字/标点修复建议。",
          "只返回 JSON，不要解释，不要添加代码围栏。",
          'JSON schema: {"hasEdit":boolean,"edit":{"original":"string","replacement":"string","reason":"string"},"hasContinuation":boolean,"continuation":"string"}。',
          allowEditing
            ? '若检测到语法、错别字、标点或语病：设置 "hasEdit": true，并在 edit.original/replacement/reason 中填写修改内容；若无错误则 "hasEdit": false, "edit": null。'
            : '"hasEdit": false, "edit": null。',
          allowContinuation
            ? '若需要提供光标处续写内容：设置 "hasContinuation": true，并在 continuation 中填写续写文本；若无续写则 "hasContinuation": false, "continuation": ""。'
            : '"hasContinuation": false, "continuation": ""。',
          "保持原文语言、语气和 Markdown/MDX 格式边界。",
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          "请根据以下上下文返回严格符合上述 JSON Schema 的 JSON 建议。",
          "",
          "【光标前】",
          promptContext.before,
          "",
          promptContext.selectedText ? "【当前选中文本/待检行】" : "",
          promptContext.selectedText ? promptContext.selectedText : "",
          "",
          "【光标后】",
          promptContext.after,
          "",
          "只输出 JSON。",
        ]
          .filter(Boolean)
          .join("\n"),
      },
    ],
  };
}

export function createAiPromptContext(snapshot: AiContextSnapshot): AiPromptContext {
  return {
    before: trimBeforeContext(snapshot.before),
    selectedText: snapshot.selectedText,
    after: trimAfterContext(snapshot.after),
    mode: snapshot.mode,
    ...(snapshot.document && "filePath" in snapshot.document
      ? { filePath: snapshot.document.filePath ?? null }
      : {}),
  };
}

export function createAiContextCacheSeed(snapshot: AiContextSnapshot): string {
  return JSON.stringify({
    before: trimBeforeContext(snapshot.before),
    selectedText: snapshot.selectedText,
    after: trimAfterContext(snapshot.after),
    mode: snapshot.mode,
    cursor: snapshot.cursor,
    filePath: snapshot.document?.filePath ?? null,
  });
}

function shouldDisableDeepSeekThinking(settings: AiSettings): boolean {
  return settings.provider === "deepseek";
}

async function requestOpenAiCompatibleContinuation(
  settings: AiSettings,
  context: AiContextSnapshot,
  options: AiContinuationRequestOptions,
): Promise<AiWritingSuggestion> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? DEFAULT_AI_TIMEOUT_MS,
  );
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
        Authorization: `Bearer ${settings.openAiCompatible.apiKey}`,
      },
      body: JSON.stringify(createOpenAiCompatibleRequestBody(settings, context, options)),
      signal: controller.signal,
    });
    const body = await readOpenAiResponse(response);

    if (!response.ok) {
      throw new Error(body.error?.message || `AI 请求失败：HTTP ${response.status}`);
    }

    const content = body.choices?.[0]?.message?.content?.trim() ?? "";
    const suggestion = filterAiSuggestionBySettings(parseAiWritingSuggestion(content), settings);
    return suggestion;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("AI 续写超时，请稍后重试。", { cause: error });
    }
    throw error;
  } finally {
    options.signal?.removeEventListener("abort", abortFromParent);
    globalThis.clearTimeout(timeout);
  }
}

async function requestLocalAiContinuation(
  settings: AiSettings,
  context: AiContextSnapshot,
  options: AiContinuationRequestOptions,
): Promise<AiWritingSuggestion> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? DEFAULT_AI_TIMEOUT_MS,
  );
  const abortFromParent = () => controller.abort();
  if (options.signal?.aborted) {
    controller.abort();
  } else {
    options.signal?.addEventListener("abort", abortFromParent, { once: true });
  }

  const intent = options.intent ?? "both";
  const profile = resolveCapabilityProfile(context, intent, {
    profile: options.profile,
    language: options.language || context.document?.language,
    documentContext: options.documentContext || context.documentContext,
    previousSummary: options.previousSummary,
    isGhostText: options.isGhostText !== false,
  });

  try {
    if (!options.localInvokeImpl) {
      throw new Error("本地模型请求需要由平台注入 localInvokeImpl。");
    }

    if (controller.signal.aborted) {
      throw createAbortError();
    }

    const response = await waitForAbort(
      options.localInvokeImpl("request_local_ai_continuation", {
        context,
        options: {
          modelId: settings.localModel.modelId,
          maxTokens: profile.maxTokens,
          temperature: profile.temperature,
          intent: profile.task,
          prompt: profile.prompt,
          stop: profile.stop,
          grammar: profile.grammar,
        },
      }),
      controller.signal,
    );

    const content =
      typeof response === "string"
        ? response
        : typeof response === "object" && response !== null && "content" in response
          ? String((response as { content?: unknown }).content ?? "")
          : "";

    let rawSuggestion: AiWritingSuggestion;

    if (intent === "distill") {
      const topic = content.trim();
      return {
        hasContinuation: Boolean(topic),
        ...(topic ? { continuation: topic } : {}),
        hasEdit: false,
        edit: null,
      };
    }

    if (intent === "continuation") {
      const continuation = normalizeContinuationText(content);
      rawSuggestion = {
        hasContinuation: Boolean(continuation),
        ...(continuation ? { continuation } : {}),
        hasEdit: false,
        edit: null,
      };
    } else if (intent === "editing") {
      const targetText = context.selectedText || context.before;
      const diffs = parseTupleDiffOutput(content);
      const validated = resolveTripleDefenseDiffs(targetText, diffs);

      if (validated.length > 0) {
        const primary = validated[0];
        rawSuggestion = {
          hasContinuation: false,
          hasEdit: true,
          edit: {
            hasEdit: true,
            original: primary.original,
            replacement: primary.replacement,
            start: primary.start,
            end: primary.end,
            utf16From: primary.utf16From,
            utf16To: primary.utf16To,
            diffs: validated,
          },
        };
      } else {
        rawSuggestion = {
          hasContinuation: false,
          hasEdit: false,
          edit: null,
        };
      }
    } else {
      // intent === "both"
      const targetText = context.selectedText || context.before;
      const diffs = parseTupleDiffOutput(content);
      if (diffs.length > 0) {
        const validated = resolveTripleDefenseDiffs(targetText, diffs);
        const primary = validated[0];
        rawSuggestion = {
          hasContinuation: false,
          hasEdit: true,
          edit: primary
            ? {
                hasEdit: true,
                original: primary.original,
                replacement: primary.replacement,
                start: primary.start,
                end: primary.end,
                utf16From: primary.utf16From,
                utf16To: primary.utf16To,
                diffs: validated,
              }
            : null,
        };
      } else {
        rawSuggestion = parseAiWritingSuggestion(content, targetText);
      }
    }

    const suggestion = filterAiSuggestionBySettings(rawSuggestion, settings);
    return suggestion;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("AI 续写超时，请稍后重试。", { cause: error });
    }
    throw error;
  } finally {
    options.signal?.removeEventListener("abort", abortFromParent);
    globalThis.clearTimeout(timeout);
  }
}

function waitForAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(createAbortError());
  }

  return new Promise<T>((resolve, reject) => {
    const abortOperation = () => {
      reject(createAbortError());
    };

    signal.addEventListener("abort", abortOperation, { once: true });
    operation.then(
      (value) => {
        signal.removeEventListener("abort", abortOperation);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", abortOperation);
        reject(error);
      },
    );
  });
}

function createAbortError(): DOMException {
  return new DOMException("AI continuation aborted.", "AbortError");
}

function filterAiSuggestionBySettings(
  suggestion: AiWritingSuggestion,
  settings: AiSettings,
): AiWritingSuggestion {
  const allowContinuation = settings.features.continuation && Boolean(suggestion.hasContinuation);
  const allowEditing = settings.features.editing && Boolean(suggestion.hasEdit);

  return {
    hasContinuation: allowContinuation,
    ...(allowContinuation && suggestion.continuation
      ? { continuation: suggestion.continuation }
      : {}),
    hasEdit: allowEditing,
    ...(allowEditing && suggestion.edit ? { edit: suggestion.edit } : { edit: null }),
  };
}

export function parseAiWritingSuggestion(
  content: string,
  targetText?: string,
): AiWritingSuggestion {
  const parsed = parseJsonObject(extractJsonObject(content));
  if (!parsed) {
    const text = normalizeContinuationText(content);
    return text
      ? { hasContinuation: true, continuation: text, hasEdit: false, edit: null }
      : { hasContinuation: false, hasEdit: false, edit: null };
  }

  const rawHasEdit = parsed.hasEdit;
  const rawHasContinuation = parsed.hasContinuation;

  const continuation = normalizeContinuationText(readStringProperty(parsed, "continuation"));
  const editInput = readObjectProperty(parsed, "edit");
  const edit = editInput ? normalizeEditSuggestion(editInput, targetText) : undefined;

  const hasEdit = typeof rawHasEdit === "boolean" ? rawHasEdit : Boolean(edit);
  const hasContinuation =
    typeof rawHasContinuation === "boolean" ? rawHasContinuation : Boolean(continuation);

  return {
    hasContinuation,
    ...(continuation ? { continuation } : {}),
    hasEdit,
    edit: edit ?? null,
  };
}

async function readOpenAiResponse(response: Response): Promise<OpenAiChatCompletionResponse> {
  try {
    return (await response.json()) as OpenAiChatCompletionResponse;
  } catch {
    return {};
  }
}

function trimBeforeContext(value: string): string {
  if (value.length <= CONTEXT_WINDOW) {
    return value;
  }
  return value.slice(-CONTEXT_WINDOW);
}

function trimAfterContext(value: string): string {
  if (value.length <= CONTEXT_WINDOW) {
    return value;
  }
  return value.slice(0, CONTEXT_WINDOW);
}

function normalizeEditSuggestion(
  input: Record<string, unknown>,
  targetText?: string,
): AiWritingEditSuggestion | undefined {
  const original = normalizeSuggestionText(readStringProperty(input, "original"));
  const replacement = normalizeSuggestionText(readStringProperty(input, "replacement"));
  if (!original || !replacement || original === replacement) {
    return undefined;
  }

  const reason = normalizeSuggestionText(readStringProperty(input, "reason"));
  const rawStart = typeof input.start === "number" ? input.start : undefined;
  const rawEnd = typeof input.end === "number" ? input.end : undefined;

  if (targetText) {
    const located = locateCloudEditSuggestion(targetText, {
      original,
      replacement,
      start: rawStart,
      end: rawEnd,
      reason,
    });

    if (located) {
      return {
        original: located.original,
        replacement: located.replacement,
        ...(reason ? { reason } : {}),
        start: located.start,
        end: located.end,
        utf16From: located.utf16From,
        utf16To: located.utf16To,
        diffs: [located],
      };
    }
  }

  return {
    original,
    replacement,
    ...(reason ? { reason } : {}),
    ...(typeof rawStart === "number" ? { start: rawStart } : {}),
    ...(typeof rawEnd === "number" ? { end: rawEnd } : {}),
  };
}

function normalizeSuggestionText(value: string): string {
  return value.trim();
}

function normalizeContinuationText(value: string): string {
  return value.replace(/^[\t ]+/u, "").trimEnd();
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
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function readStringProperty(input: Record<string, unknown> | null, key: string): string {
  const value = input?.[key];
  return typeof value === "string" ? value : "";
}

function readObjectProperty(
  input: Record<string, unknown>,
  key: string,
): Record<string, unknown> | null {
  const value = input[key];
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
