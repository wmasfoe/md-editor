/**
 * @file html-projection.ts
 * @description HTML 块级内容安全清洗与可视化挂件渲染。
 * 针对 Markdown 文档中的原生 HTML 块（HTMLBlock/HTMLTag），通过严格的白名单清洗器
 * 剔除 XSS 危险标签与脚本，并渲染为沙箱化安全的视觉挂件。
 */

import type { EditorState, Range } from "@codemirror/state";
import { Decoration, EditorView } from "@codemirror/view";
import { getWysiwygDiagnostics } from "../diagnostics.ts";
import {
  HTML_WHITELIST_VERSION,
  isEmptySanitizedHtml,
  sanitizeHtmlBlockDetailed,
  type SanitizedHtmlBlock,
} from "../markdown/html-sanitize.ts";
import type { MarkdownRangeRecord, SourceRange } from "../markdown/range-types.ts";
import { HtmlBlockWidget, type HtmlBlockWidgetValue } from "./widgets/html-block-widget.ts";

const HTML_SANITIZE_CACHE_LIMIT = 128;
const sanitizeCache = new Map<string, SanitizedHtmlBlock>();

/**
 * 判断指定记录是否为可进行 HTML 视觉投影的完整解析块。
 */
export function isProjectableHtml(record: MarkdownRangeRecord): boolean {
  return record.kind === "html" && record.parserCoverage === "complete";
}

/**
 * 构建 HTML 块的安全 Replace 挂件装饰。
 */
export function buildHtmlLayoutDecorations(
  record: MarkdownRangeRecord,
  selected: boolean,
  state: EditorState,
): readonly Range<Decoration>[] {
  if (!isProjectableHtml(record)) {
    return [];
  }
  const value = buildHtmlWidgetValue(record, selected, state);
  const replacementTo = trailingLineBreakEnd(record, state);
  return [
    Decoration.replace({
      widget: new HtmlBlockWidget(value),
      inclusive: false,
      block: true,
      wysiwygRecordId: record.id,
      wysiwygRole: "html-widget",
    }).range(record.fullRange.from, replacementTo),
  ];
}

export function buildHtmlAtomicRanges(
  record: MarkdownRangeRecord,
  _selected: boolean,
): readonly Range<Decoration>[] {
  if (!isProjectableHtml(record)) {
    return [];
  }
  return [
    Decoration.mark({
      wysiwygRecordId: record.id,
      wysiwygRole: "html-widget-atomic",
    }).range(record.fullRange.from, record.fullRange.to),
  ];
}

export function getHtmlProtectedRanges(record: MarkdownRangeRecord): readonly SourceRange[] {
  return isProjectableHtml(record) ? [record.fullRange] : [];
}

export const htmlProjectionTheme = EditorView.baseTheme({
  ".cm-md-html-block-widget": {
    display: "block",
  },
  ".cm-md-html-block-widget--selected": {
    outline: "2px solid var(--theme-selection, Highlight)",
    outlineOffset: "2px",
  },
  ".cm-md-html-block-widget__placeholder": {
    display: "block",
    padding: "0.5rem",
    border: "1px solid var(--theme-border, currentColor)",
    color: "var(--theme-muted, currentColor)",
  },
});

export function clearHtmlSanitizeCache(): void {
  sanitizeCache.clear();
}

export function getHtmlSanitizeCacheSize(): number {
  return sanitizeCache.size;
}

function buildHtmlWidgetValue(
  record: MarkdownRangeRecord,
  selected: boolean,
  state: EditorState,
): HtmlBlockWidgetValue {
  const diagnostics = getWysiwygDiagnostics(state);
  if (record.parserCoverage !== "complete") {
    return {
      recordId: record.id,
      sanitizedHtml: "",
      placeholder: "HTML block is still being parsed; edit the original source instead.",
      selected,
      diagnostics,
    };
  }

  const result = getSanitizedHtml(record, state);
  return {
    recordId: record.id,
    sanitizedHtml: result.html,
    placeholder:
      result.hasUnsupportedBlockTag || isEmptySanitizedHtml(result.html)
        ? "Unsupported or unsafe HTML block; edit the original source instead."
        : null,
    selected,
    diagnostics,
  };
}

function getSanitizedHtml(record: MarkdownRangeRecord, state: EditorState): SanitizedHtmlBlock {
  const key = `${HTML_WHITELIST_VERSION}:${record.sourceFingerprint}`;
  const cached = sanitizeCache.get(key);
  if (cached) {
    return cached;
  }

  const result = sanitizeHtmlBlockDetailed(
    state.sliceDoc(record.fullRange.from, record.fullRange.to),
  );
  sanitizeCache.set(key, result);
  if (sanitizeCache.size > HTML_SANITIZE_CACHE_LIMIT) {
    const oldest = sanitizeCache.keys().next().value;
    if (oldest !== undefined) {
      sanitizeCache.delete(oldest);
    }
  }
  return result;
}

function trailingLineBreakEnd(record: MarkdownRangeRecord, state: EditorState): number {
  return record.fullRange.to < state.doc.length &&
    state.sliceDoc(record.fullRange.to, record.fullRange.to + 1) === "\n"
    ? record.fullRange.to + 1
    : record.fullRange.to;
}
