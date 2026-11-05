/**
 * @file html-projection.ts
 * @description HTML 块级内容安全清洗与所见即所得双态投影。
 *
 * 遵循 Obsidian / Typora 范式的原位暴露架构（Caret-driven Reveal）：
 * - 非激活态（光标在外部）：清洗后作为安全的整行块级替换挂件（HtmlBlockWidget）呈现；
 * - 激活态（光标在内部）：解除块级挂件替换，原位展示原生 HTML 源码并应用等宽样式；
 * - 快捷键支持：按 Mod-Enter 或 Escape 可快速收起并退出当前 HTML 块。
 */

import { Prec, type EditorState, type Range, Transaction } from "@codemirror/state";
import { Decoration, EditorView, keymap } from "@codemirror/view";
import { getWysiwygDiagnostics } from "../../diagnostics.ts";
import {
  HTML_WHITELIST_VERSION,
  isEmptySanitizedHtml,
  sanitizeHtmlBlockDetailed,
  type SanitizedHtmlBlock,
} from "../../markdown/html-sanitize.ts";
import { markdownRangeIndexField } from "../../markdown/range-index.ts";
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
 * 构建 HTML 块的布局装饰：
 * - 激活态：原位展示原生 HTML 源码行（附加等宽修饰）；
 * - 非激活态：整行替换为安全清洗后的 HtmlBlockWidget 挂件。
 */
export function buildHtmlLayoutDecorations(
  record: MarkdownRangeRecord,
  active: boolean,
  selected: boolean,
  state: EditorState,
): readonly Range<Decoration>[] {
  if (!isProjectableHtml(record)) {
    return [];
  }
  if (active && !selected) {
    // 激活态且未被整块原子选中：原位展示原始 HTML 源码供直接原生输入编辑
    const decorations: Range<Decoration>[] = [];
    const startLine = state.doc.lineAt(record.fullRange.from);
    const endLine = state.doc.lineAt(record.fullRange.to);
    for (let l = startLine.number; l <= endLine.number; l++) {
      const line = state.doc.line(l);
      decorations.push(
        Decoration.line({
          class: "cm-md-html-source-line",
          wysiwygRecordId: record.id,
          wysiwygRole: "html-source-line",
        }).range(line.from),
      );
    }
    return decorations;
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

/**
 * 构建 HTML 块的原子范围（仅在非激活态或原子选中态生效，保证挂件整体作为原子单元被选择/跳过）。
 */
export function buildHtmlAtomicRanges(
  record: MarkdownRangeRecord,
  active: boolean,
  selected: boolean,
): readonly Range<Decoration>[] {
  if (!isProjectableHtml(record) || (active && !selected)) {
    return [];
  }
  return [
    Decoration.mark({
      wysiwygRecordId: record.id,
      wysiwygRole: "html-widget-atomic",
    }).range(record.fullRange.from, record.fullRange.to),
  ];
}

/**
 * 获取受保护范围（未激活或原子选中态保护挂件范围，激活且未选中态允许原生编辑修改）。
 */
export function getHtmlProtectedRanges(
  record: MarkdownRangeRecord,
  active: boolean,
  selected: boolean,
): readonly SourceRange[] {
  return isProjectableHtml(record) && (!active || selected) ? [record.fullRange] : [];
}

/**
 * HTML 源码就地编辑快捷键：
 * - Mod-Enter / Escape：退出源码编辑，光标移动到该块下方并重新折叠渲染。
 */
export const htmlSourceKeymap = Prec.highest(
  keymap.of([
    {
      key: "Mod-Enter",
      run: (view) => {
        const index = view.state.field(markdownRangeIndexField, false);
        if (!index) {
          return false;
        }
        const head = view.state.selection.main.head;
        const record = index.at(head).find((r) => r.kind === "html");
        if (!record) {
          return false;
        }
        const target = Math.min(record.fullRange.to + 1, view.state.doc.length);
        view.dispatch({
          selection: { anchor: target },
          scrollIntoView: true,
          annotations: Transaction.addToHistory.of(false),
        });
        view.focus();
        return true;
      },
    },
    {
      key: "Escape",
      run: (view) => {
        const index = view.state.field(markdownRangeIndexField, false);
        if (!index) {
          return false;
        }
        const head = view.state.selection.main.head;
        const record = index.at(head).find((r) => r.kind === "html");
        if (!record) {
          return false;
        }
        const target = Math.min(record.fullRange.to + 1, view.state.doc.length);
        view.dispatch({
          selection: { anchor: target },
          scrollIntoView: true,
          annotations: Transaction.addToHistory.of(false),
        });
        view.focus();
        return true;
      },
    },
  ]),
);

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
  ".cm-md-html-block-widget__placeholder": {
    display: "block",
    padding: "0.5rem 0.75rem",
    border: "1px solid var(--theme-border, #d8dee4)",
    borderRadius: "var(--theme-radius-base, 6px)",
    color: "var(--theme-muted, #6e7781)",
    fontSize: "0.82rem",
    background: "var(--theme-code-bg, rgba(0, 0, 0, 0.02))",
  },
  ".cm-md-html-source-line": {
    fontFamily: "var(--theme-mono-font, ui-monospace, monospace)",
    fontSize: "0.9em",
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
      from: record.fullRange.from,
      to: record.fullRange.to,
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
    from: record.fullRange.from,
    to: record.fullRange.to,
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
