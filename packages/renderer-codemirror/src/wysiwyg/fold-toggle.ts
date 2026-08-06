import { foldable, foldEffect, foldedRanges, unfoldEffect } from "@codemirror/language";
import type { EditorState, Extension } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { markdownRangeIndexField } from "../markdown/range-index.ts";
import type { MarkdownRangeRecord } from "../markdown/range-types.ts";

/**
 * M5 折叠:标题/列表项行首折叠按钮(▾/▸),点击折叠/展开内容区。
 *
 * 折叠机制复用 CM6 官方 fold(foldEffect/unfoldEffect/foldedRanges):
 * markdown 默认 foldService 已提供 heading(ATX/Setext)与"有子项
 * list item"的折叠范围(单测已验证);kind 判断走 range-index records
 * (不读语法树判断类型,与投影模式下的既有铁律一致)。
 */

type FoldToggleKind = "heading" | "list";

interface FoldToggleRange {
  readonly from: number;
  readonly to: number;
  readonly lineFrom: number;
  readonly kind: FoldToggleKind;
}

export interface FoldToggleLabels {
  readonly collapseHeading: string;
  readonly expandHeading: string;
  readonly collapseListItem: string;
  readonly expandListItem: string;
}

const HEADING_KINDS = new Set(["heading-atx", "heading-setext"]);
const LIST_ITEM_KINDS = new Set(["list-item-ordered", "list-item-unordered", "task"]);

const DEFAULT_LABELS: FoldToggleLabels = {
  collapseHeading: "折叠标题",
  expandHeading: "展开标题",
  collapseListItem: "折叠列表项",
  expandListItem: "展开列表项",
};

function kindForRecord(record: MarkdownRangeRecord): FoldToggleKind | null {
  if (HEADING_KINDS.has(record.kind)) {
    return "heading";
  }
  if (LIST_ITEM_KINDS.has(record.kind)) {
    return "list";
  }
  return null;
}

/**
 * 遍历 range-index 的结构块记录,收集可折叠范围(仅 heading/列表项行,
 * 且官方 foldable 返回范围——无子项的列表项自然被排除)。
 */
function foldToggleRanges(state: EditorState): readonly FoldToggleRange[] {
  const index = state.field(markdownRangeIndexField);
  const ranges: FoldToggleRange[] = [];
  const seen = new Set<number>();
  for (const record of index.records) {
    const kind = kindForRecord(record);
    if (!kind) {
      continue;
    }
    const lineFrom = state.doc.lineAt(record.fullRange.from).from;
    if (seen.has(lineFrom)) {
      continue;
    }
    seen.add(lineFrom);
    const line = state.doc.lineAt(lineFrom);
    const range = foldable(state, line.from, line.to);
    if (!range) {
      continue;
    }
    ranges.push({ from: range.from, to: range.to, lineFrom, kind });
  }
  return ranges;
}

function rangeIsFolded(state: EditorState, range: FoldToggleRange): boolean {
  let folded = false;
  foldedRanges(state).between(range.from, range.to, (from, to) => {
    if (from === range.from && to === range.to) {
      folded = true;
    }
  });
  return folded;
}

function toggleFold(view: EditorView, lineFrom: number, kind: FoldToggleKind): boolean {
  const range = foldToggleRanges(view.state).find(
    (candidate) => candidate.lineFrom === lineFrom && candidate.kind === kind,
  );
  if (!range) {
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

class FoldToggleWidget extends WidgetType {
  constructor(
    readonly range: FoldToggleRange,
    readonly collapsed: boolean,
    readonly labels: FoldToggleLabels,
  ) {
    super();
  }

  eq(other: FoldToggleWidget): boolean {
    return (
      this.range.lineFrom === other.range.lineFrom &&
      this.range.kind === other.range.kind &&
      this.collapsed === other.collapsed
    );
  }

  ignoreEvent(): boolean {
    return false;
  }

  toDOM(view: EditorView): HTMLElement {
    const button = view.dom.ownerDocument.createElement("button");
    const heading = this.range.kind === "heading";
    const label = heading
      ? this.collapsed
        ? this.labels.expandHeading
        : this.labels.collapseHeading
      : this.collapsed
        ? this.labels.expandListItem
        : this.labels.collapseListItem;
    button.type = "button";
    button.className = "cm-md-fold-toggle";
    button.dataset.collapsed = String(this.collapsed);
    button.setAttribute("aria-expanded", String(!this.collapsed));
    button.setAttribute("aria-label", label);
    button.title = label;
    // 图标走 CSS ::before(▾/▸),textContent 保持空:不污染 .cm-line
    // 文本流(718c75f 教训)
    button.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleFold(view, this.range.lineFrom, this.range.kind);
    });
    return button;
  }
}

function foldToggleDecorations(state: EditorState, labels: FoldToggleLabels): DecorationSet {
  const decorations = foldToggleRanges(state).flatMap((range) => {
    const collapsed = rangeIsFolded(state, range);
    return [
      Decoration.line({
        attributes: { "data-fold-collapsed": String(collapsed) },
      }).range(range.lineFrom),
      Decoration.widget({
        // 行首位:-2 是块工具栏(更左),折叠按钮 -1 在其右侧、紧贴文本
        side: -1,
        widget: new FoldToggleWidget(range, collapsed, labels),
      }).range(range.lineFrom),
    ];
  });
  return Decoration.set(decorations, true);
}

class FoldToggleViewPlugin {
  decorations: DecorationSet;

  constructor(
    view: EditorView,
    readonly labels: FoldToggleLabels,
  ) {
    this.decorations = foldToggleDecorations(view.state, labels);
  }

  update(update: ViewUpdate): void {
    if (
      update.docChanged ||
      update.transactions.some((transaction) => transaction.effects.length > 0)
    ) {
      this.decorations = foldToggleDecorations(update.state, this.labels);
    }
  }
}

/** 折叠按钮主题:低透明度,行 hover 高亮;▾/▸ 图标由伪元素渲染 */
export const foldToggleTheme = EditorView.baseTheme({
  ".cm-md-fold-toggle": {
    background: "transparent",
    border: "0",
    color: "inherit",
    cursor: "pointer",
    display: "inline-block",
    marginInlineEnd: "0.3em",
    opacity: "0.35",
    padding: "0 0.15em",
  },
  ".cm-line:hover > .cm-md-fold-toggle": {
    opacity: "1",
  },
  ".cm-md-fold-toggle::before": {
    content: '"▾"',
  },
  '.cm-md-fold-toggle[data-collapsed="true"]::before': {
    content: '"▸"',
  },
});

/** 折叠扩展(挂渲染层;范围与状态复用 CM6 fold) */
export const foldToggleExtension: Extension[] = [
  ViewPlugin.define<FoldToggleViewPlugin>(
    (view) => new FoldToggleViewPlugin(view, DEFAULT_LABELS),
    {
      decorations: (plugin) => plugin.decorations,
    },
  ),
  foldToggleTheme,
];
