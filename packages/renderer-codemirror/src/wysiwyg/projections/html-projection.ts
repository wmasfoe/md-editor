/**
 * @file html-projection.ts
 * @description HTML 块级内容安全清洗与可视化挂件渲染。
 * 针对 Markdown 文档中的原生 HTML 块（HTMLBlock/HTMLTag），通过严格的白名单清洗器
 * 剔除 XSS 危险标签与脚本，并渲染为沙箱化安全的视觉挂件。
 */

import type { EditorState, Range } from "@codemirror/state";
import { Decoration, EditorView } from "@codemirror/view";
import { getWysiwygDiagnostics } from "../../diagnostics.ts";
import {
  HTML_WHITELIST_VERSION,
  isEmptySanitizedHtml,
  sanitizeHtmlBlockDetailed,
  type SanitizedHtmlBlock,
} from "../../markdown/html-sanitize.ts";
import type { MarkdownRangeRecord, SourceRange } from "../../markdown/range-types.ts";
import { buildWholeLineBlockReplacement } from "../blocks/block-replacement.ts";
import { HtmlBlockWidget, type HtmlBlockWidgetValue } from "../widgets/html-block-widget.ts";

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
  // 整行块级替换必须走统一契约（不对称 Inclusivity），否则 CM6 会在 HTML 块上方合成幽灵空行。
  return buildWholeLineBlockReplacement({
    record,
    state,
    widget: new HtmlBlockWidget(value),
    role: "html-widget",
  });
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
    position: "relative",
    // 垂直间距禁止用 margin。CM6 高度图只量 border-box，margin 会让其后的点击偏行。
  },
  ".cm-md-html-block-widget--selected": {
    outline: "2px solid var(--theme-selection, var(--theme-primary, #0969da))",
    outlineOffset: "2px",
    borderRadius: "var(--theme-radius-base, 6px)",
  },
  ".cm-md-html-block-widget__toolbar": {
    display: "none",
    position: "absolute",
    top: "0.35rem",
    right: "0.35rem",
    zIndex: "10",
    gap: "0.35rem",
  },
  ".cm-md-html-block-widget:hover .cm-md-html-block-widget__toolbar": {
    display: "flex",
  },
  ".cm-md-html-block-widget--peek .cm-md-html-block-widget__toolbar": {
    display: "flex",
    position: "static",
    boxSizing: "border-box",
    width: "100%",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "0.28rem 0.65rem",
    borderTopLeftRadius: "var(--theme-radius-base, 6px)",
    borderTopRightRadius: "var(--theme-radius-base, 6px)",
    background: "var(--theme-code-gutter-bg, var(--theme-bg-muted, #f6f8fa))",
    border: "1px solid var(--theme-code-border, var(--theme-border, #d8dee4))",
    borderBottom: "1px solid var(--theme-border, rgba(0, 0, 0, 0.06))",
    color: "var(--theme-control-subtle, var(--theme-muted, #6e7781))",
    fontSize: "0.76rem",
    userSelect: "none",
  },
  ".cm-md-html-block-widget__badge": {
    fontFamily: "var(--theme-mono-font, ui-monospace, monospace)",
    fontSize: "0.76rem",
    fontWeight: "600",
    color: "var(--theme-title, var(--theme-text, currentColor))",
    letterSpacing: "0.02em",
  },
  ".cm-md-html-block-widget__actions": {
    display: "flex",
    alignItems: "center",
    gap: "0.35rem",
  },
  ".cm-md-html-block-widget__btn": {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "11px",
    lineHeight: "1.3",
    padding: "2px 8px",
    border: "1px solid var(--theme-border, rgba(0, 0, 0, 0.12))",
    borderRadius: "4px",
    background: "var(--theme-surface, #ffffff)",
    color: "var(--theme-control-subtle, var(--theme-muted, #666666))",
    cursor: "pointer",
    userSelect: "none",
    boxShadow: "0 1px 2px rgba(0, 0, 0, 0.04)",
    transition: "background 120ms ease, border-color 120ms ease, color 120ms ease",
  },
  ".cm-md-html-block-widget__btn:hover": {
    background: "var(--theme-bg-muted, #f6f8fa)",
    color: "var(--theme-text, currentColor)",
    borderColor: "var(--theme-border-strong, var(--theme-border, #afb8c1))",
  },
  ".cm-md-html-block-widget--peek .cm-md-html-block-widget__btn": {
    boxShadow: "none",
    border: "1px solid transparent",
    background: "transparent",
    padding: "2px 6px",
  },
  ".cm-md-html-block-widget--peek .cm-md-html-block-widget__btn--cancel:hover": {
    background: "var(--theme-primary-soft, rgba(0, 0, 0, 0.06))",
    color: "var(--theme-text, currentColor)",
  },
  ".cm-md-html-block-widget--peek .cm-md-html-block-widget__btn--commit": {
    background: "var(--theme-primary-soft, rgba(9, 105, 218, 0.08))",
    color: "var(--theme-primary, #0969da)",
    fontWeight: "500",
    border: "1px solid var(--theme-primary-soft, transparent)",
  },
  ".cm-md-html-block-widget--peek .cm-md-html-block-widget__btn--commit:hover": {
    background: "var(--theme-primary, #0969da)",
    color: "#ffffff",
    borderColor: "var(--theme-primary, #0969da)",
  },
  ".cm-md-html-block-widget__placeholder": {
    display: "block",
    padding: "0.5rem 0.75rem",
    border: "1px solid var(--theme-border, #d8dee4)",
    borderRadius: "var(--theme-radius-base, 6px)",
    color: "var(--theme-muted, #6e7781)",
    fontSize: "0.82rem",
    background: "var(--theme-code-bg, rgba(0, 0, 0, 0.02))",
  },
  ".cm-md-html-block-widget__notice": {
    display: "block",
    padding: "0.35rem 0.65rem",
    borderRadius: "4px",
    marginBottom: "0.25rem",
    background: "var(--theme-danger-bg, rgba(180, 35, 24, 0.08))",
    color: "var(--theme-danger-text, var(--theme-danger, #b42318))",
    fontSize: "0.78rem",
  },
  ".cm-md-html-block-widget__editor": {
    border: "1px solid var(--theme-code-border, var(--theme-border, #d8dee4))",
    borderTop: "none",
    borderBottomLeftRadius: "var(--theme-radius-base, 6px)",
    borderBottomRightRadius: "var(--theme-radius-base, 6px)",
    background: "var(--theme-code-bg, rgba(0, 0, 0, 0.02))",
    overflow: "hidden",
  },
  ".cm-md-html-block-widget__editor .cm-editor": {
    outline: "none",
    maxHeight: "420px",
    fontFamily: "var(--theme-mono-font, ui-monospace, monospace)",
    fontSize: "0.84rem",
  },
  ".cm-md-html-block-widget__editor .cm-scroller": {
    fontFamily: "inherit",
    lineHeight: "1.5",
  },
  ".cm-md-html-block-widget__editor .cm-gutters": {
    background: "var(--theme-code-gutter-bg, var(--theme-bg-muted, #f6f8fa))",
    color: "var(--theme-code-gutter-text, var(--theme-muted, #8c959f))",
    borderRight: "1px solid var(--theme-border, rgba(0, 0, 0, 0.06))",
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
  const rawHtml = state.sliceDoc(record.fullRange.from, record.fullRange.to);
  if (record.parserCoverage !== "complete") {
    return {
      recordId: record.id,
      sanitizedHtml: "",
      placeholder: "HTML block is still being parsed; edit the original source instead.",
      selected,
      diagnostics,
      rawHtml,
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
    rawHtml,
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
