import type { EditorState, Extension } from "@codemirror/state";
import { StateEffect, StateField } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { markdownRangeIndexField } from "../markdown/range-index.ts";

/**
 * M5 标题 H 控件:光标落在 ATX 标题行时,行首显示当前级别按钮
 * (H1-H6),点击展开下拉列表(段落 + H1-H6),选择后重写行首 marker。
 *
 * kind 判定走 range-index records(不读语法树,铁律);marker 重写
 * 用行文本正则(保留行首缩进);只支持 ATX 标题(setext 只有 1/2 级,
 * 与竞品行为对齐)。
 */

interface ActiveHeading {
  readonly lineFrom: number;
  readonly level: number;
}

const setOpenHeading = StateEffect.define<number | null>();

const openHeadingField = StateField.define<number | null>({
  create: () => null,
  update(value, transaction) {
    let next = value;
    if (transaction.docChanged && next !== null) {
      next = transaction.changes.mapPos(next, 1);
    }
    for (const effect of transaction.effects) {
      if (effect.is(setOpenHeading)) {
        next = effect.value;
      }
    }
    return next;
  },
});

/** 光标在单个 ATX 标题行内时返回标题信息(含行首 marker 层级) */
function activeHeading(state: EditorState): ActiveHeading | null {
  if (state.readOnly || state.selection.ranges.length !== 1) {
    return null;
  }
  const selection = state.selection.main;
  const line = state.doc.lineAt(selection.head);
  if (selection.from < line.from || selection.to > line.to) {
    return null;
  }
  const records = state.field(markdownRangeIndexField).at(line.from);
  if (!records.some((record) => record.kind === "heading-atx")) {
    return null;
  }
  // fenced code 内以 # 开头的行不会是 heading-atx record(解析器已确认),
  // 这里只需从行文本取实际级别
  const match = /^(\s*)(#{1,6})(\s+)/u.exec(line.text);
  if (!match) {
    return null;
  }
  return { lineFrom: line.from, level: match[2].length };
}

/**
 * 计算行首 ATX marker 的重写编辑:level 1-6 换为对应 # 前缀,
 * level null 转段落(删除 marker + 分隔空白)。保留行首缩进。
 * 返回 null 表示该行不是 ATX 标题行。
 */
export function headingMarkerEdit(
  lineText: string,
  level: number | null,
): { readonly from: number; readonly to: number; readonly insert: string } | null {
  const match = /^(\s*)(#{1,6})(\s+)/u.exec(lineText);
  if (!match) {
    return null;
  }
  const markerFrom = match[1].length;
  const markerTo = markerFrom + match[2].length + match[3].length;
  return {
    from: markerFrom,
    to: markerTo,
    insert: level === null ? "" : `${"#".repeat(level)} `,
  };
}

/** 重写行首 marker:level 1-6 换为对应 # 前缀,level null 转段落(删除 marker) */
export function setHeadingLevel(view: EditorView, lineFrom: number, level: number | null): boolean {
  const line = view.state.doc.lineAt(lineFrom);
  const edit = headingMarkerEdit(line.text, level);
  if (!edit) {
    return false;
  }
  view.dispatch({
    changes: { from: lineFrom + edit.from, to: lineFrom + edit.to, insert: edit.insert },
    userEvent: "input.heading-level",
  });
  view.focus();
  return true;
}

function controlButton(document: Document, className: string, label: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.contentEditable = "false";
  button.draggable = false;
  button.setAttribute("aria-label", label);
  button.addEventListener("mousedown", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  return button;
}

class HeadingLevelWidget extends WidgetType {
  constructor(
    readonly heading: ActiveHeading,
    readonly open: boolean,
  ) {
    super();
  }

  eq(other: HeadingLevelWidget): boolean {
    return (
      other.heading.lineFrom === this.heading.lineFrom &&
      other.heading.level === this.heading.level &&
      other.open === this.open
    );
  }

  ignoreEvent(): boolean {
    return false;
  }

  toDOM(view: EditorView): HTMLElement {
    const document = view.dom.ownerDocument;
    const control = document.createElement("span");
    const levelLabel = `H${this.heading.level}`;
    control.className = "cm-md-heading-level-control";
    control.contentEditable = "false";

    const toggle = controlButton(document, "cm-md-heading-level-button", `标题级别 ${levelLabel}`);
    toggle.dataset.headingLevel = levelLabel;
    toggle.textContent = levelLabel;
    toggle.title = "标题级别";
    toggle.setAttribute("aria-expanded", String(this.open));
    toggle.setAttribute("aria-haspopup", "listbox");
    toggle.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      view.dispatch({
        effects: setOpenHeading.of(this.open ? null : this.heading.lineFrom),
      });
      view.focus();
    });
    control.append(toggle);

    if (!this.open) {
      return control;
    }

    const list = document.createElement("span");
    list.className = "cm-md-heading-level-list";
    list.contentEditable = "false";
    list.setAttribute("aria-label", "标题级别");
    list.setAttribute("role", "listbox");

    const options: ReadonlyArray<{ level: number | null; label: string }> = [
      { level: null, label: "段落" },
      ...Array.from({ length: 6 }, (_, index) => ({
        level: index + 1,
        label: `H${index + 1}`,
      })),
    ];
    for (const option of options) {
      const button = controlButton(document, "cm-md-heading-level-option", option.label);
      button.dataset.headingLevel = option.level === null ? "paragraph" : `H${option.level}`;
      button.setAttribute("aria-selected", String(option.label === levelLabel));
      button.setAttribute("role", "option");
      // 图标/文本走 textContent 即可:按钮在列表浮层里,不在 .cm-line 文本流
      button.textContent = option.label;
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        view.dispatch({ effects: setOpenHeading.of(null) });
        setHeadingLevel(view, this.heading.lineFrom, option.level);
      });
      list.append(button);
    }
    control.append(list);
    return control;
  }
}

function headingDecorations(view: EditorView): DecorationSet {
  if (!view.hasFocus) {
    return Decoration.none;
  }
  const heading = activeHeading(view.state);
  if (!heading) {
    return Decoration.none;
  }
  const open = view.state.field(openHeadingField) === heading.lineFrom;
  return Decoration.set([
    Decoration.line({ class: "cm-md-heading-editing" }).range(heading.lineFrom),
    Decoration.widget({
      // 与块工具栏同区(-2),排在其右侧;fold-toggle 在 -1(更靠文本)
      side: -2,
      widget: new HeadingLevelWidget(heading, open),
    }).range(heading.lineFrom),
  ]);
}

class HeadingLevelViewPlugin {
  decorations: DecorationSet;
  private readonly handlePointerDown: (event: PointerEvent) => unknown;

  constructor(readonly view: EditorView) {
    this.decorations = headingDecorations(view);
    this.handlePointerDown = (event) => {
      if (view.state.field(openHeadingField) === null) {
        return;
      }
      const target =
        event.target instanceof Element
          ? event.target
          : event.target instanceof Node
            ? event.target.parentElement
            : null;
      const control = target?.closest(".cm-md-heading-level-control");
      if (control && view.dom.contains(control)) {
        return;
      }
      view.dispatch({ effects: setOpenHeading.of(null) });
    };
    view.dom.ownerDocument.addEventListener("pointerdown", this.handlePointerDown, true);
  }

  update(update: ViewUpdate): void {
    if (
      update.docChanged ||
      update.selectionSet ||
      update.focusChanged ||
      update.transactions.some((transaction) => transaction.effects.length > 0)
    ) {
      this.decorations = headingDecorations(update.view);
    }
  }

  destroy(): void {
    this.view.dom.ownerDocument.removeEventListener("pointerdown", this.handlePointerDown, true);
  }
}

/** 标题 H 控件主题:紧凑标签按钮,列表浮层横排 */
export const headingLevelControlTheme = EditorView.baseTheme({
  ".cm-md-heading-level-control": {
    contentEditable: "false",
    display: "inline-flex",
    alignItems: "center",
    marginInlineEnd: "0.3em",
    position: "relative",
  },
  ".cm-md-heading-level-button": {
    background: "transparent",
    border: "0",
    borderRadius: "3px",
    color: "inherit",
    cursor: "pointer",
    fontFamily: "inherit",
    fontSize: "0.72em",
    fontWeight: "600",
    lineHeight: "1",
    opacity: "0.5",
    padding: "0.15em 0.3em",
  },
  ".cm-line:hover > .cm-md-heading-level-control .cm-md-heading-level-button": {
    opacity: "1",
  },
  ".cm-md-heading-level-button:hover": {
    background: "rgba(127, 127, 127, 0.18)",
    opacity: "1",
  },
  ".cm-md-heading-level-list": {
    background: "var(--background, #ffffff)",
    border: "1px solid rgba(127, 127, 127, 0.4)",
    borderRadius: "4px",
    boxShadow: "0 2px 8px rgba(0, 0, 0, 0.12)",
    display: "inline-flex",
    gap: "2px",
    left: "0",
    padding: "3px",
    position: "absolute",
    top: "100%",
    zIndex: "10",
  },
  ".cm-md-heading-level-option": {
    background: "transparent",
    border: "0",
    borderRadius: "3px",
    color: "inherit",
    cursor: "pointer",
    fontFamily: "inherit",
    fontSize: "0.78em",
    lineHeight: "1",
    padding: "0.35em 0.5em",
  },
  ".cm-md-heading-level-option:hover": {
    background: "rgba(127, 127, 127, 0.18)",
  },
  '.cm-md-heading-level-option[aria-selected="true"]': {
    fontWeight: "700",
  },
});

/** 标题 H 控件扩展:聚焦 + 光标在 ATX 标题行时显示级别切换 */
export const headingLevelControlExtension: Extension[] = [
  openHeadingField,
  ViewPlugin.define<HeadingLevelViewPlugin>((view) => new HeadingLevelViewPlugin(view), {
    decorations: (plugin) => plugin.decorations,
  }),
  EditorView.domEventHandlers({
    keydown(event, view) {
      if (event.key !== "Escape" || view.state.field(openHeadingField) === null) {
        return false;
      }
      view.dispatch({ effects: setOpenHeading.of(null) });
      event.preventDefault();
      return true;
    },
  }),
  headingLevelControlTheme,
];
