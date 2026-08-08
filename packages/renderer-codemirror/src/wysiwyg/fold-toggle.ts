import { foldable, foldEffect, foldedRanges, unfoldEffect } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdownRangeIndexField } from "../markdown/range-index.ts";
import type { MarkdownRangeRecord } from "../markdown/range-types.ts";

/**
 * M5 折叠逻辑(渲染由 block-toolbar 的按钮承担):
 * 标题/列表项行首折叠按钮(▾/▸),点击折叠/展开内容区。
 *
 * 折叠机制复用 CM6 官方 fold(foldEffect/unfoldEffect/foldedRanges):
 * markdown 默认 foldService 已提供 heading(ATX/Setext)与"有子项
 * list item"的折叠范围(单测已验证);kind 判断走 range-index records
 * (不读语法树判断类型,与投影模式下的既有铁律一致)。
 */

export type FoldToggleKind = "heading" | "list";

export interface FoldToggleRange {
  readonly from: number;
  readonly to: number;
  readonly lineFrom: number;
  readonly kind: FoldToggleKind;
}

const HEADING_KINDS = new Set(["heading-atx", "heading-setext"]);
const LIST_ITEM_KINDS = new Set(["list-item-ordered", "list-item-unordered", "task"]);

function kindForRecord(record: MarkdownRangeRecord): FoldToggleKind | null {
  if (HEADING_KINDS.has(record.kind)) {
    return "heading";
  }
  if (LIST_ITEM_KINDS.has(record.kind)) {
    return "list";
  }
  return null;
}

/** 该行是否可折叠;返回折叠范围(仅 heading/有子项 list item) */
export function foldableToggleAt(state: EditorState, lineFrom: number): FoldToggleRange | null {
  const index = state.field(markdownRangeIndexField);
  let kind: FoldToggleKind | null = null;
  for (const record of index.records) {
    if (state.doc.lineAt(record.fullRange.from).from !== lineFrom) {
      continue;
    }
    const recordKind = kindForRecord(record);
    if (recordKind) {
      kind = recordKind;
      break;
    }
  }
  if (!kind) {
    return null;
  }
  const line = state.doc.lineAt(lineFrom);
  const range = foldable(state, line.from, line.to);
  if (!range) {
    return null;
  }
  return { from: range.from, to: range.to, lineFrom, kind };
}

/** 折叠范围是否已折叠 */
export function rangeIsFolded(state: EditorState, range: FoldToggleRange): boolean {
  let folded = false;
  foldedRanges(state).between(range.from, range.to, (from, to) => {
    if (from === range.from && to === range.to) {
      folded = true;
    }
  });
  return folded;
}

/** 切换折叠状态(已折叠则展开,否则折叠) */
export function toggleFold(view: EditorView, lineFrom: number, kind: FoldToggleKind): boolean {
  const range = foldableToggleAt(view.state, lineFrom);
  if (!range || range.kind !== kind) {
    return false;
  }
  view.dispatch({
    effects: rangeIsFolded(view.state, range)
      ? unfoldEffect.of({ from: range.from, to: range.to })
      : foldEffect.of({ from: range.from, to: range.to }),
  });
  view.focus();
  return true;
}

/** 折叠按钮主题(按钮由 block-toolbar 渲染,样式复用;三角用 CSS border 绘制) */
export const foldToggleTheme = EditorView.baseTheme({
  ".cm-md-fold-toggle": {
    background: "transparent",
    border: "0",
    color: "inherit",
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    // 尺寸用 rem 固定:em 会随块字号缩放(标题行 1.85em 时 1em≈31px,
    // 0c5ea48 教训),行首控件一律 rem;0.85rem 轻量
    marginInlineEnd: "0.1rem",
    opacity: "0.4",
    padding: "0",
    width: "0.85rem",
    height: "0.85rem",
  },
  ".cm-md-block-toolbar:hover .cm-md-fold-toggle": {
    opacity: "1",
  },
  // 展开态:向下三角;折叠态:向右三角(轻量,不依赖字符字形)
  ".cm-md-fold-toggle::before": {
    content: "",
    display: "block",
    width: "0",
    height: "0",
    borderLeft: "3.5px solid transparent",
    borderRight: "3.5px solid transparent",
    borderTop: "5px solid currentColor",
  },
  '.cm-md-fold-toggle[data-collapsed="true"]::before': {
    borderTop: "3.5px solid transparent",
    borderBottom: "3.5px solid transparent",
    borderLeft: "5px solid currentColor",
  },
});
