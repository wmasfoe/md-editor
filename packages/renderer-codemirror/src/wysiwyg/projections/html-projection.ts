/**
 * @file html-projection.ts
 * @description HTML 块级内容安全清洗与所见即所得双态投影。
 *
 * - 非激活态：清洗后作为整行块级替换挂件（HtmlBlockWidget）呈现；
 * - 单击 / 方向键：原子选中整块，不展开源码；
 * - 双击、编辑按钮或选中态 Mod-Enter：在父文档里原位展开源码；
 * - 源码态 Mod-Enter / Escape：折叠预览。块贴在文末时，光标落到虚拟空行，不改文档。
 * - 注释块同样用 Mod-Enter / Escape 把光标移出，且不改文档。行首键入 `<!--` 会把
 *   HTML 块重新解析成 CommentBlock；若这时不接住按键，浏览器的 Mod-Enter 会插入换行，
 *   下一次撤销撤掉的是这行空行，而不是刚键入的文本。
 */

import {
  EditorSelection,
  Prec,
  type EditorState,
  type Range,
  Transaction,
} from "@codemirror/state";
import { Decoration, EditorView, keymap, WidgetType } from "@codemirror/view";
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
import { needsVirtualTrailingLine } from "../editing/virtual-trailing-line.ts";
import { HtmlBlockWidget, type HtmlBlockWidgetValue } from "../widgets/html-block-widget.ts";
import {
  clearWysiwygAtomSelectionEffect,
  setVirtualTrailingLineActiveEffect,
  virtualTrailingLineActiveField,
} from "../state/types.ts";

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
    // 激活态且未被整块原子选中：原位展示原始 HTML 源码，并加上块容器提示。
    return buildHtmlSourceDecorations(record, state);
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
 * HTML 源码快捷键：
 * - 整块选中时 Mod-Enter 进入源码；
 * - 源码态 Mod-Enter / Escape 折叠。文末没有块外位置时落到虚拟空行，文档不变；
 * - 光标在注释块内时，同样移出该块，避免浏览器默认的 Mod-Enter 写入撤销栈。
 */
export const htmlSourceKeymap = Prec.highest(
  keymap.of([
    {
      key: "Mod-Enter",
      run: (view) => {
        const record = htmlRecordForSelection(view);
        if (record) {
          if (isExactHtmlAtomSelection(view.state, record)) {
            return revealHtmlSource(view, record);
          }
          if (isHtmlSourceOpen(view.state, record)) {
            return collapseHtmlSource(view, record);
          }
        }
        const comment = commentExitRecord(view);
        return comment ? collapseHtmlSource(view, comment) : false;
      },
    },
    {
      key: "Escape",
      run: (view) => {
        const record = htmlRecordForSelection(view);
        if (
          record &&
          !isExactHtmlAtomSelection(view.state, record) &&
          isHtmlSourceOpen(view.state, record)
        ) {
          return collapseHtmlSource(view, record);
        }
        const comment = commentExitRecord(view);
        return comment ? collapseHtmlSource(view, comment) : false;
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
  ".cm-md-html-block-widget:hover .cm-md-html-block-widget__toolbar, .cm-md-html-block-widget--selected .cm-md-html-block-widget__toolbar":
    {
      display: "flex",
    },
  ".cm-md-html-block-widget__content a": {
    cursor: "pointer",
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
    backgroundColor: "var(--theme-code-bg, rgba(0, 0, 0, 0.03))",
    boxShadow: "inset 2px 0 0 var(--theme-border, rgba(0, 0, 0, 0.2))",
  },
  ".cm-md-html-source-banner": {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "0.5rem",
    padding: "0.15rem 0.4rem 0.3rem",
    border: "1px solid var(--theme-border, rgba(0, 0, 0, 0.12))",
    borderBottom: "none",
    borderRadius: "var(--theme-radius-base, 6px) var(--theme-radius-base, 6px) 0 0",
    background: "var(--theme-surface, #ffffff)",
    color: "var(--theme-muted, #6e7781)",
    fontFamily: "var(--theme-font, sans-serif)",
    fontSize: "11px",
    lineHeight: "1.4",
    userSelect: "none",
  },
  ".cm-md-html-source-banner__hint": {
    fontFamily: "var(--theme-mono-font, ui-monospace, monospace)",
  },
  ".cm-md-html-comment": {
    color: "var(--theme-muted, #6e7781)",
    fontFamily: "var(--theme-mono-font, ui-monospace, monospace)",
    fontSize: "0.92em",
  },
});

/** HTML 注释保持为弱化源码行，不进入预览挂件。 */
export function buildCommentLayoutDecorations(
  record: MarkdownRangeRecord,
  state: EditorState,
): readonly Range<Decoration>[] {
  return sourceLineDecorations(record, state, "cm-md-html-comment", "html-comment");
}

class HtmlSourceBannerWidget extends WidgetType {
  constructor(readonly from: number) {
    super();
  }

  override eq(other: HtmlSourceBannerWidget): boolean {
    return this.from === other.from;
  }

  override toDOM(view: EditorView): HTMLElement {
    const document = view.dom.ownerDocument;
    const banner = document.createElement("div");
    banner.className = "cm-md-html-source-banner";
    const label = document.createElement("span");
    label.textContent = "HTML";
    const hint = document.createElement("span");
    hint.className = "cm-md-html-source-banner__hint";
    hint.textContent = "Esc";
    banner.append(label, hint);
    banner.addEventListener("mousedown", (event) => {
      if (event.button !== 0) {
        return;
      }
      event.preventDefault();
      view.dispatch({
        selection: EditorSelection.cursor(Math.min(this.from, view.state.doc.length)),
        scrollIntoView: true,
      });
      view.focus();
    });
    return banner;
  }

  override ignoreEvent(event: Event): boolean {
    return event.type === "mousedown";
  }
}

function buildHtmlSourceDecorations(
  record: MarkdownRangeRecord,
  state: EditorState,
): readonly Range<Decoration>[] {
  const startLine = state.doc.lineAt(record.fullRange.from);
  return [
    Decoration.widget({
      widget: new HtmlSourceBannerWidget(record.fullRange.from),
      block: true,
      side: -1,
      wysiwygRecordId: record.id,
      wysiwygRole: "html-source-banner",
    }).range(startLine.from),
    ...sourceLineDecorations(record, state, "cm-md-html-source-line", "html-source-line"),
  ];
}

function sourceLineDecorations(
  record: MarkdownRangeRecord,
  state: EditorState,
  className: string,
  role: string,
): readonly Range<Decoration>[] {
  const decorations: Range<Decoration>[] = [];
  const startLine = state.doc.lineAt(record.fullRange.from);
  // `to` 是排他端点。贴在行首时 lineAt(to) 会落到下一行，源码行只画到块内容所在行。
  const endOffset = Math.max(record.fullRange.from, record.fullRange.to - 1);
  const endLine = state.doc.lineAt(Math.min(endOffset, state.doc.length));
  for (let lineNumber = startLine.number; lineNumber <= endLine.number; lineNumber += 1) {
    const line = state.doc.line(lineNumber);
    decorations.push(
      Decoration.line({
        class: className,
        wysiwygRecordId: record.id,
        wysiwygRole: role,
      }).range(line.from),
    );
  }
  return decorations;
}

function htmlRecordForSelection(view: EditorView): MarkdownRangeRecord | null {
  const index = view.state.field(markdownRangeIndexField, false);
  if (!index) {
    return null;
  }
  const selection = view.state.selection.main;
  const exact = index.records.find(
    (record) =>
      isProjectableHtml(record) &&
      record.fullRange.from === selection.from &&
      record.fullRange.to === selection.to,
  );
  if (exact) {
    return exact;
  }
  const headRecord = index.at(selection.head).find((record) => isProjectableHtml(record));
  return headRecord ?? null;
}

/**
 * 光标或选区落在注释块内时返回该块。虚拟空行已经停在文末时返回 null，
 * 让 Escape 继续交给虚拟空行自己的快捷键。
 */
function commentExitRecord(view: EditorView): MarkdownRangeRecord | null {
  const index = view.state.field(markdownRangeIndexField, false);
  if (!index) {
    return null;
  }
  const head = view.state.selection.main.head;
  const record = index.at(head).find((candidate) => candidate.nodeName === "CommentBlock");
  if (!record) {
    return null;
  }
  // 整段选中注释没有挂件，按“正在编辑”处理，直接移出，而不是当成原子选中再展开。
  if (isExactHtmlAtomSelection(view.state, record) || isHtmlSourceOpen(view.state, record)) {
    return record;
  }
  return null;
}

function isExactHtmlAtomSelection(state: EditorState, record: MarkdownRangeRecord): boolean {
  const selection = state.selection.main;
  return (
    !selection.empty &&
    selection.from === record.fullRange.from &&
    selection.to === record.fullRange.to
  );
}

function isHtmlSourceOpen(state: EditorState, record: MarkdownRangeRecord): boolean {
  const selection = state.selection.main;
  if (isExactHtmlAtomSelection(state, record)) {
    return false;
  }
  // 虚拟空行停在 doc.length，和贴 EOF 的 HTML 闭区间重合。这时预览仍然折叠。
  if (
    selection.empty &&
    selection.head === state.doc.length &&
    record.fullRange.to >= state.doc.length &&
    state.field(virtualTrailingLineActiveField, false) === true
  ) {
    return false;
  }
  if (selection.empty) {
    return selection.head >= record.fullRange.from && selection.head <= record.fullRange.to;
  }
  return selection.from < record.fullRange.to && selection.to > record.fullRange.from;
}

function revealHtmlSource(view: EditorView, record: MarkdownRangeRecord): boolean {
  view.dispatch({
    selection: EditorSelection.cursor(record.fullRange.from),
    effects: [
      clearWysiwygAtomSelectionEffect.of(null),
      setVirtualTrailingLineActiveEffect.of(false),
    ],
    scrollIntoView: true,
    annotations: Transaction.addToHistory.of(false),
    userEvent: "select",
  });
  view.focus();
  return true;
}

function collapseHtmlSource(view: EditorView, record: MarkdownRangeRecord): boolean {
  const docLength = view.state.doc.length;
  const atDocumentEnd = record.fullRange.to >= docLength;
  // 光标停在文末不等于要点亮虚拟空行：注释块不在虚拟行的块类型里，文末根本没有虚拟行可显示。
  // 这时若仍置为激活，虚拟行的高优先级键位会吞掉 Enter / Backspace / Delete，用户被困在文末。
  // 先用折叠后的光标位置推算，激活与否以“虚拟行此刻会不会出现”为准。
  const cursor = atDocumentEnd ? docLength : record.fullRange.to + 1;
  const armVirtualLine = atDocumentEnd && needsVirtualTrailingLine(view.state);
  view.dispatch({
    selection: EditorSelection.cursor(cursor),
    effects: [
      clearWysiwygAtomSelectionEffect.of(null),
      setVirtualTrailingLineActiveEffect.of(armVirtualLine),
    ],
    scrollIntoView: true,
    annotations: Transaction.addToHistory.of(false),
    userEvent: "select",
  });
  view.focus();
  return true;
}

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
