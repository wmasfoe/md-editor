/**
 * @file app/harness-guardrails.ts
 * @module @md-editor/ai
 * @description
 * App Harness 前置守卫（Pre-Model Guardrails）与后置净化/定位器（Post-Model Sanitizers & Diff Locators）。
 *
 * 核心职责：
 * 1. 前置守卫：拦截代码块、公式块、表格分隔行、纯链接等不适合触发自动 GEC 的 Markdown 结构；
 * 2. 后置净化：剥离 `<think>`、Gemma 4 `<|thought>` 等思维链残留标签，消除续写首尾重叠（Boundary Overlap）；
 * 3. 四重防御定位（Quad-Layer Tuple-Diff Resolver）：
 *    - 第 1 层：Unicode Code Point -> UTF-16 精确切片强匹配；
 *    - 第 2 层：±fuzzyRadius 滑动窗口局部纠偏；
 *    - 第 3 层：全文唯一匹配 / 最近邻文本锚点兜底（彻底免疫模型坐标偏移）；
 *    - 第 4 层：原文不存在时静默丢弃，绝不盲目破坏用户正文。
 */

import type {
  AiContextSnapshot,
  AiWritingEditSuggestion,
  AiWritingSuggestion,
  CompactTupleDiff,
  ValidatedDiffItem,
} from "../domain/types.ts";

/** 默认发送给云端模型的上下文窗口大小（字符数） */
export const DEFAULT_CONTEXT_WINDOW_CHARS = 3_000;

/** 截取后的标准上下文窗口结构 */
export interface AiPromptContext {
  readonly before: string;
  readonly selectedText: string;
  readonly after: string;
  readonly mode: AiContextSnapshot["mode"];
  readonly filePath?: string | null;
}

/**
 * 前置守卫：判断当前行或光标位置是否应跳过自动语法纠错（Auto GEC）。
 *
 * 避免对代码块内部、LaTeX 数学公式块、Markdown 表格对齐分隔行、分割线或纯 URL 发起无效推理。
 */
export function shouldSkipAutoGec(targetLineText: string, beforeCursorText: string): boolean {
  const trimmed = targetLineText.trim();
  if (trimmed.length < 3) {
    return true;
  }

  // 1. 代码围栏行本身、分割线、表格对齐行、纯 URL、HTML 注释行直接跳过
  if (
    /^(`{3,}|~{3,})/u.test(trimmed) ||
    /^\|?[\s:-]+\|[\s|:-]*$/u.test(trimmed) ||
    /^([-*_]\s*){3,}$/u.test(trimmed) ||
    /^https?:\/\/\S+$/iu.test(trimmed) ||
    /^<!--.*-->$/u.test(trimmed)
  ) {
    return true;
  }

  // 2. 光标位于未闭合的 Markdown Fenced Code Block 内部时跳过自动纠错
  const fenceMatches = beforeCursorText.match(/^[ \t]*(`{3,}|~{3,})/gmu);
  if (fenceMatches && fenceMatches.length % 2 === 1) {
    return true;
  }

  // 3. 光标位于未闭合的 $$ 多行数学公式块内部时跳过自动纠错
  const mathFenceMatches = beforeCursorText.match(/\$\$/gu);
  if (mathFenceMatches && mathFenceMatches.length % 2 === 1) {
    return true;
  }

  return false;
}

/**
 * 截取光标前后受限窗口上下文，避免超长文档撑爆 Token 预算。
 */
export function createAiPromptContext(
  snapshot: AiContextSnapshot,
  windowChars = DEFAULT_CONTEXT_WINDOW_CHARS,
): AiPromptContext {
  const before =
    snapshot.before.length <= windowChars ? snapshot.before : snapshot.before.slice(-windowChars);
  const after =
    snapshot.after.length <= windowChars ? snapshot.after : snapshot.after.slice(0, windowChars);

  return {
    before,
    selectedText: snapshot.selectedText,
    after,
    mode: snapshot.mode,
    ...(snapshot.document && "filePath" in snapshot.document
      ? { filePath: snapshot.document.filePath ?? null }
      : {}),
  };
}

/**
 * 生成用于请求缓存去重的上下文特征种子。
 */
export function createAiContextCacheSeed(snapshot: AiContextSnapshot): string {
  const ctx = createAiPromptContext(snapshot);
  return JSON.stringify({
    before: ctx.before,
    selectedText: ctx.selectedText,
    after: ctx.after,
    mode: ctx.mode,
    cursor: snapshot.cursor,
    filePath: snapshot.document?.filePath ?? null,
  });
}

/**
 * 剥离模型可能泄漏的思维链（Thinking / Reasoning）块与特殊控制符。
 * 兼容 Qwen 3 `<think>...</think>`、DeepSeek R1 以及 Google Gemma 4 `<|thought>...<thought|>`。
 */
export function stripThinkingTags(text: string): string {
  if (!text) {
    return "";
  }

  // 1. 剥离闭合的 <think>...</think> 与 Gemma 4 <|thought>...<thought|> / <thought>...</thought>
  let cleaned = text.replace(/<think>[\s\S]*?<\/think>/giu, "");
  cleaned = cleaned.replace(/<\|thought\|?>[\s\S]*?(?:<thought\|>|<\/thought>)/giu, "");
  cleaned = cleaned.replace(/<thought>[\s\S]*?<\/thought>/giu, "");

  // 2. 剥离因 max_tokens 截断而未闭合的思考前缀
  if (/<think>/iu.test(cleaned) && !/<\/think>/iu.test(cleaned)) {
    cleaned = cleaned.replace(/<think>[\s\S]*/giu, "");
  }
  if (/<\|thought\|?>/iu.test(cleaned) && !/(?:<thought\|>|<\/thought>)/iu.test(cleaned)) {
    cleaned = cleaned.replace(/<\|thought\|?>[\s\S]*/giu, "");
  }

  // 3. 剥离残留的特殊控制 Token
  cleaned = cleaned.replace(/<\/?think>/giu, "");
  cleaned = cleaned.replace(/<\|thought\|?>|<thought\|>|<\/?thought>/giu, "");
  cleaned = cleaned.replace(/<\|task_[a-z_]+\|>/giu, "");
  cleaned = cleaned.replace(/<\|fim_[a-z_]+\|>/giu, "");
  cleaned = cleaned.replace(/<LM\|fim_end\|>/giu, "");
  cleaned = cleaned.replace(/<\|im_end\|>/giu, "");
  cleaned = cleaned.replace(/<\|endoftext\|>/giu, "");
  cleaned = cleaned.replace(/<end_of_turn>/giu, "");

  return cleaned;
}

/**
 * 净化模型输出的续写文本：
 * - 剥离思维链与控制符；
 * - 行内幽灵续写（isGhostText=true）时强制收敛为单行；
 * - 自动消除模型复读光标前文尾部或光标后文首部的重叠片段（Boundary Overlap Deduplication）。
 */
export function sanitizeContinuationOutput(
  rawText: string,
  options: {
    readonly before?: string;
    readonly after?: string;
    readonly isGhostText?: boolean;
  } = {},
): string {
  let text = stripThinkingTags(rawText);
  if (!text) {
    return "";
  }

  // 若模型误用 ``` 包裹了单段普通文本，剥离外层围栏（仅在光标不在代码块中时剥离）
  const trimmedFenceCheck = text.trim();
  if (/^```[\w-]*\n[\s\S]*\n```$/u.test(trimmedFenceCheck)) {
    text = trimmedFenceCheck.replace(/^```[\w-]*\n/u, "").replace(/\n```$/u, "");
  }

  // 剥离模型输出的前导换行（无论单行幽灵还是多行段落，前导换行都会破坏行内衔接并导致前缀去重失效）
  text = text.replace(/^[\r\n]+/u, "");

  if (options.isGhostText) {
    const firstLineBreak = text.search(/[\r\n]/u);
    if (firstLineBreak !== -1) {
      text = text.slice(0, firstLineBreak);
    }
  }

  // 消除与光标前文尾部的重复复读（检测 2 ~ 40 字符的最大后缀-前缀重叠）
  if (options.before && text.length > 0) {
    text = stripPrefixOverlapWithBefore(options.before, text);
  }

  // 消除与光标后文首部的重复生成（检测 2 ~ 40 字符的最大后缀-前缀重叠）
  if (options.after && text.length > 0) {
    text = stripSuffixOverlapWithAfter(text, options.after);
  }

  // 若光标前文末尾不是英文单词字符，或已在空白后，清理多余的前导空格；英文单词后续写保留必要的单个前导空格
  const beforeEndsWithAsciiWord =
    typeof options.before === "string" && /[A-Za-z0-9]$/u.test(options.before);
  if (beforeEndsWithAsciiWord && /^[ \t]+\S/u.test(text)) {
    text = ` ${text.replace(/^[ \t]+/u, "")}`;
  } else {
    text = text.replace(/^[ \t]+/u, "");
  }

  return text.trimEnd();
}

function stripPrefixOverlapWithBefore(before: string, continuation: string): string {
  const maxOverlap = Math.min(40, before.length, continuation.length);
  for (let len = maxOverlap; len >= 2; len--) {
    const candidate = continuation.slice(0, len);
    if (!candidate.trim()) {
      continue;
    }
    if (before.endsWith(candidate)) {
      return continuation.slice(len);
    }
  }
  return continuation;
}

function stripSuffixOverlapWithAfter(continuation: string, after: string): string {
  const maxOverlap = Math.min(40, continuation.length, after.length);
  for (let len = maxOverlap; len >= 2; len--) {
    const candidate = continuation.slice(continuation.length - len);
    if (!candidate.trim()) {
      continue;
    }
    if (after.startsWith(candidate)) {
      return continuation.slice(0, continuation.length - len);
    }
  }
  return continuation;
}

/**
 * 将 Unicode Code Point 索引（字符数）换算为 JavaScript / CodeMirror 6 的 UTF-16 Code Unit 偏移量。
 */
export function codePointOffsetToUtf16Offset(text: string, codePointIndex: number): number {
  if (codePointIndex <= 0) {
    return 0;
  }

  let codePointCount = 0;
  let utf16Offset = 0;

  for (const char of text) {
    if (codePointCount >= codePointIndex) {
      break;
    }
    utf16Offset += char.length;
    codePointCount += 1;
  }

  return utf16Offset;
}

/**
 * 解析 RFC-002 / RFC-004 紧凑四元组 JSON Diff 输出：`[[start, end, "原词", "建议词"], ...]`。
 * 若无错误、空字符串或非法格式则安全返回 `[]`。
 */
export function parseTupleDiffOutput(content: string): CompactTupleDiff[] {
  const cleaned = stripThinkingTags(content).trim();
  if (!cleaned || cleaned === "[]") {
    return [];
  }

  const jsonString = extractJsonArrayString(cleaned);
  if (!jsonString) {
    return [];
  }

  try {
    const parsed = JSON.parse(jsonString) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    const diffs: CompactTupleDiff[] = [];
    for (const item of parsed) {
      if (
        Array.isArray(item) &&
        item.length === 4 &&
        typeof item[0] === "number" &&
        typeof item[1] === "number" &&
        typeof item[2] === "string" &&
        typeof item[3] === "string" &&
        item[2] !== item[3]
      ) {
        diffs.push([item[0], item[1], item[2], item[3]]);
      }
    }

    return diffs;
  } catch {
    return [];
  }
}

/**
 * 四重防御定位校验算法（RFC-004 客户端锚点增强版）：
 * 1. 精确坐标换算强一致匹配（Code Points -> UTF-16，`slice === original`）；
 * 2. ±fuzzyRadius 滑动窗口模糊纠偏；
 * 3. 全文唯一子串 / 最近邻锚点兜底（当模型数偏了字符偏移但 `original` 在待检文本中真实存在时，自动校准至精确坐标）；
 * 4. 原文不存在该片段时静默丢弃，杜绝误改。
 */
export function resolveTripleDefenseDiffs(
  targetText: string,
  diffs: readonly CompactTupleDiff[],
  fuzzyRadius = 5,
): ValidatedDiffItem[] {
  const validated: ValidatedDiffItem[] = [];

  for (const [start, end, original, replacement] of diffs) {
    if (original === replacement) {
      continue;
    }

    const utf16From = codePointOffsetToUtf16Offset(targetText, start);
    const utf16To = codePointOffsetToUtf16Offset(targetText, end);

    // 第 1 层：精确坐标强一致匹配
    if (targetText.slice(utf16From, utf16To) === original) {
      validated.push({
        start,
        end,
        utf16From,
        utf16To,
        original,
        replacement,
        wasAdjusted: false,
      });
      continue;
    }

    // 纯插入场景（original 为空，start === end）
    if (original === "" && utf16From === utf16To && utf16From <= targetText.length) {
      validated.push({
        start,
        end,
        utf16From,
        utf16To,
        original,
        replacement,
        wasAdjusted: false,
      });
      continue;
    }

    if (original !== "") {
      // 第 2 层：±fuzzyRadius 滑动窗口局部纠偏
      const searchStart = Math.max(0, utf16From - fuzzyRadius);
      const searchEnd = Math.min(targetText.length, utf16To + fuzzyRadius);
      const searchWindow = targetText.slice(searchStart, searchEnd);
      const indexInWindow = searchWindow.indexOf(original);

      if (indexInWindow !== -1) {
        const adjustedFrom = searchStart + indexInWindow;
        const adjustedTo = adjustedFrom + original.length;
        validated.push({
          start,
          end,
          utf16From: adjustedFrom,
          utf16To: adjustedTo,
          original,
          replacement,
          wasAdjusted: true,
        });
        continue;
      }

      // 第 3 层：全文唯一匹配 / 最近邻锚点兜底（应对大于 fuzzyRadius 的前缀偏移）
      const anchored = findNearestSubstringAnchor(targetText, original, utf16From);
      if (anchored) {
        validated.push({
          start,
          end,
          utf16From: anchored.utf16From,
          utf16To: anchored.utf16To,
          original,
          replacement,
          wasAdjusted: true,
        });
        continue;
      }
    }

    // 第 4 层：原文中不存在对应文本，安全静默丢弃
  }

  return deduplicateOverlappingDiffs(validated);
}

/**
 * 倒序应用一组已通过校验的 Diff（从后向前替换，不破坏前部偏移）。
 */
export function applyTupleDiffs(
  targetText: string,
  validatedDiffs: readonly ValidatedDiffItem[],
): string {
  if (validatedDiffs.length === 0) {
    return targetText;
  }

  const sorted = validatedDiffs.toSorted((a, b) => b.utf16From - a.utf16From);
  let result = targetText;

  for (const diff of sorted) {
    result = result.slice(0, diff.utf16From) + diff.replacement + result.slice(diff.utf16To);
  }

  return result;
}

/**
 * 云端通用大模型（OpenAI / Claude / Gemini）的三级自适应编辑定位器。
 */
export function locateCloudEditSuggestion(
  targetText: string,
  edit: {
    readonly original: string;
    readonly replacement: string;
    readonly start?: number | null;
    readonly end?: number | null;
    readonly reason?: string;
  },
): ValidatedDiffItem | null {
  const { original, replacement } = edit;
  if (!original || original === replacement) {
    return null;
  }

  if (
    typeof edit.start === "number" &&
    typeof edit.end === "number" &&
    edit.start >= 0 &&
    edit.end <= targetText.length &&
    targetText.slice(edit.start, edit.end) === original
  ) {
    return {
      start: edit.start,
      end: edit.end,
      utf16From: edit.start,
      utf16To: edit.end,
      original,
      replacement,
      wasAdjusted: false,
    };
  }

  const anchored = findNearestSubstringAnchor(
    targetText,
    original,
    typeof edit.start === "number" ? edit.start : undefined,
  );
  if (!anchored) {
    return null;
  }

  return {
    start: anchored.utf16From,
    end: anchored.utf16To,
    utf16From: anchored.utf16From,
    utf16To: anchored.utf16To,
    original,
    replacement,
    wasAdjusted: true,
  };
}

/**
 * 将紧凑元组 Diff 校验列表转换为统一的 `AiWritingSuggestion` 结构。
 */
export function buildEditSuggestionFromDiffs(
  validatedDiffs: readonly ValidatedDiffItem[],
  reason?: string,
): AiWritingSuggestion {
  if (validatedDiffs.length === 0) {
    return {
      hasContinuation: false,
      hasEdit: false,
      edit: null,
    };
  }

  const primary = validatedDiffs[0];
  return {
    hasContinuation: false,
    hasEdit: true,
    edit: {
      hasEdit: true,
      original: primary.original,
      replacement: primary.replacement,
      ...(reason ? { reason } : {}),
      start: primary.start,
      end: primary.end,
      utf16From: primary.utf16From,
      utf16To: primary.utf16To,
      diffs: validatedDiffs,
    },
  };
}

/**
 * 解析云端或兼容格式模型返回的写作建议（兼容 Tuple-Diff 数组、结构化 JSON 对象与纯文本续写）。
 */
export function parseAiWritingSuggestion(
  content: string,
  targetText?: string,
): AiWritingSuggestion {
  const cleaned = stripThinkingTags(content);
  const trimmed = cleaned.trim();
  if (!trimmed) {
    return { hasContinuation: false, hasEdit: false, edit: null };
  }

  // 1. 若返回的是紧凑元组数组 [[start, end, orig, repl]] 或 []
  if (trimmed.startsWith("[") && targetText !== undefined) {
    const tupleDiffs = parseTupleDiffOutput(trimmed);
    const validated = resolveTripleDefenseDiffs(targetText, tupleDiffs);
    return buildEditSuggestionFromDiffs(validated);
  }

  // 2. 尝试解析 JSON 对象
  const parsed = parseJsonObject(extractJsonObject(trimmed));
  if (!parsed) {
    const continuation = sanitizeContinuationOutput(cleaned);
    return continuation
      ? { hasContinuation: true, continuation, hasEdit: false, edit: null }
      : { hasContinuation: false, hasEdit: false, edit: null };
  }

  // 支持云端返回 { diffs: [[start, end, orig, repl]], reason?: string }
  if (Array.isArray(parsed.diffs) && targetText !== undefined) {
    const tupleDiffs = parseTupleDiffOutput(JSON.stringify(parsed.diffs));
    const validated = resolveTripleDefenseDiffs(targetText, tupleDiffs);
    const reason = readStringProperty(parsed, "reason").trim() || undefined;
    if (validated.length > 0) {
      return buildEditSuggestionFromDiffs(validated, reason);
    }
  }

  const rawHasEdit = parsed.hasEdit;
  const rawHasContinuation = parsed.hasContinuation;

  const continuation = sanitizeContinuationOutput(readStringProperty(parsed, "continuation"));
  const editInput = readObjectProperty(parsed, "edit");
  const edit = editInput ? normalizeCloudEditObject(editInput, targetText) : undefined;

  const hasEdit = typeof rawHasEdit === "boolean" ? rawHasEdit && Boolean(edit) : Boolean(edit);
  const hasContinuation =
    typeof rawHasContinuation === "boolean"
      ? rawHasContinuation && Boolean(continuation)
      : Boolean(continuation);

  return {
    hasContinuation,
    ...(hasContinuation && continuation ? { continuation } : {}),
    hasEdit,
    edit: hasEdit && edit ? edit : null,
  };
}

function normalizeCloudEditObject(
  input: Record<string, unknown>,
  targetText?: string,
): AiWritingEditSuggestion | undefined {
  const original = stripThinkingTags(readStringProperty(input, "original")).trim();
  const replacement = stripThinkingTags(readStringProperty(input, "replacement")).trim();
  if (!original || !replacement || original === replacement) {
    return undefined;
  }

  const reason = stripThinkingTags(readStringProperty(input, "reason")).trim() || undefined;
  const rawStart = typeof input.start === "number" ? input.start : undefined;
  const rawEnd = typeof input.end === "number" ? input.end : undefined;

  if (targetText !== undefined) {
    const located = locateCloudEditSuggestion(targetText, {
      original,
      replacement,
      start: rawStart,
      end: rawEnd,
      reason,
    });
    if (!located) {
      // 如果传入了明确的 targetText 但完全找不到 original，拒绝产生幻觉替换
      return undefined;
    }

    return {
      hasEdit: true,
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

  return {
    hasEdit: true,
    original,
    replacement,
    ...(reason ? { reason } : {}),
    ...(typeof rawStart === "number" ? { start: rawStart } : {}),
    ...(typeof rawEnd === "number" ? { end: rawEnd } : {}),
  };
}

function findNearestSubstringAnchor(
  targetText: string,
  original: string,
  approxUtf16Start?: number,
): { readonly utf16From: number; readonly utf16To: number } | null {
  const occurrences: number[] = [];
  let pos = targetText.indexOf(original);
  while (pos !== -1) {
    occurrences.push(pos);
    pos = targetText.indexOf(original, pos + 1);
  }

  if (occurrences.length === 0) {
    return null;
  }

  let bestFrom = occurrences[0];
  if (occurrences.length > 1 && typeof approxUtf16Start === "number") {
    let minDistance = Math.abs(occurrences[0] - approxUtf16Start);
    for (let i = 1; i < occurrences.length; i++) {
      const dist = Math.abs(occurrences[i] - approxUtf16Start);
      if (dist < minDistance) {
        minDistance = dist;
        bestFrom = occurrences[i];
      }
    }
  }

  return {
    utf16From: bestFrom,
    utf16To: bestFrom + original.length,
  };
}

function deduplicateOverlappingDiffs(diffs: readonly ValidatedDiffItem[]): ValidatedDiffItem[] {
  if (diffs.length <= 1) {
    return [...diffs];
  }
  const sorted = diffs.toSorted((a, b) => a.utf16From - b.utf16From);
  const result: ValidatedDiffItem[] = [];
  let lastEnd = -1;
  for (const item of sorted) {
    if (item.utf16From >= lastEnd) {
      result.push(item);
      lastEnd = item.utf16To;
    }
  }
  return result;
}

function extractJsonArrayString(content: string): string | null {
  const start = content.indexOf("[");
  const end = content.lastIndexOf("]");
  if (start >= 0 && end > start) {
    return content.slice(start, end + 1);
  }
  return null;
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
