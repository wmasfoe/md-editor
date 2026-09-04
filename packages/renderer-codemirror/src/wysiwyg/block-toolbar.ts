import { Facet, type EditorState, type Extension } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { ATOMIC_WIDGET_KINDS, readBlockRanges, type BlockRange } from "./block-move.ts";
import {
  foldToggleTheme,
  foldableToggleAt,
  rangeIsFolded,
  toggleFold,
  type FoldToggleRange,
} from "./fold-toggle.ts";

/**
 * 块工具栏与折叠控件：
 *
 * 遵循 Typora 纯粹 Markdown 写作哲学与第一性原理：
 * - 普通段落（Paragraph）100% 纯文本，首行不挂载任何 Widget；
 *   彻底消除负边距（-4.5rem）、DOM 污染与行内格式化上下文（IFC）破坏，
 *   使整段所有行的行盒和选区表现 100% 绝对平齐同构；
 * - 仅可折叠行（标题 Heading 与嵌套列表 List item）挂载轻量 FoldToggleWidget，
 *   在左侧 Gutter 渲染 ▾/▸ 折叠按钮，其净流宽为 0，不推挤正文文本。
 */

export interface BlockToolbarOptions {
  /** 自定义文案(保留兼容接口) */
  readonly addBlockLabel?: string;
  readonly dragBlockLabel?: string;
}

/** 文案覆盖 facet(保留兼容接口) */
export const blockToolbarLabelsFacet = Facet.define<BlockToolbarOptions, BlockToolbarOptions>({
  combine: (values) => Object.assign({}, ...values),
});

/** 折叠按钮 Widget(仅在可折叠行挂载) */
class FoldToggleWidget extends WidgetType {
  private readonly blockFrom: number;
  private readonly fold: FoldToggleRange;
  private readonly foldCollapsed: boolean;

  constructor(blockFrom: number, fold: FoldToggleRange, foldCollapsed: boolean) {
    super();
    this.blockFrom = blockFrom;
    this.fold = fold;
    this.foldCollapsed = foldCollapsed;
  }

  eq(other: FoldToggleWidget): boolean {
    return (
      other instanceof FoldToggleWidget &&
      other.blockFrom === this.blockFrom &&
      other.fold.lineFrom === this.fold.lineFrom &&
      other.fold.kind === this.fold.kind &&
      other.foldCollapsed === this.foldCollapsed
    );
  }

  ignoreEvent(): boolean {
    return false;
  }

  toDOM(view: EditorView): HTMLElement {
    const document = view.dom.ownerDocument;
    const fold = document.createElement("button");
    fold.type = "button";
    fold.className = "cm-md-fold-toggle";
    fold.dataset.collapsed = String(this.foldCollapsed);
    fold.setAttribute("aria-expanded", String(!this.foldCollapsed));
    fold.setAttribute("aria-label", this.foldCollapsed ? "展开" : "折叠");
    fold.title = this.foldCollapsed ? "展开" : "折叠";
    fold.tabIndex = -1;
    fold.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    fold.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleFold(view, this.blockFrom, this.fold.kind);
    });
    return fold;
  }
}

function blockDecorationsFromRanges(
  state: EditorState,
  blocks: readonly BlockRange[],
): DecorationSet {
  const decorations = blocks.flatMap((block) => {
    // 原子 widget 块(分割线等)不挂行装饰:行级 line 装饰与整块 replace 装饰冲突
    if (ATOMIC_WIDGET_KINDS.has(block.name)) {
      return [];
    }

    const lineDeco = Decoration.line({
      attributes: {
        "data-block-from": String(block.from),
        ...(block.depth !== undefined ? { "data-list-depth": String(block.depth) } : {}),
      },
    }).range(block.from);

    // 仅可折叠行(标题/有子项列表)挂载折叠按钮，普通段落彻底零 DOM 挂件
    const fold = foldableToggleAt(state, block.from);
    if (!fold) {
      return [lineDeco];
    }

    return [
      lineDeco,
      Decoration.widget({
        side: -1,
        widget: new FoldToggleWidget(block.from, fold, rangeIsFolded(state, fold)),
      }).range(block.from),
    ];
  });
  return Decoration.set(decorations, true);
}

class BlockToolbarViewPlugin {
  decorations: DecorationSet;

  constructor(view: EditorView) {
    this.decorations = blockDecorationsFromRanges(view.state, readBlockRanges(view.state));
  }

  update(update: ViewUpdate): void {
    if (update.docChanged || update.selectionSet || update.viewportChanged) {
      this.decorations = blockDecorationsFromRanges(update.state, readBlockRanges(update.state));
    }
  }
}

/** 块工具栏主题(保留空对象保障外部兼容) */
export const blockToolbarTheme = EditorView.baseTheme({});

/** 块工具栏/折叠扩展(挂渲染层) */
export const blockToolbarExtension: Extension[] = [
  ViewPlugin.define<BlockToolbarViewPlugin>((view) => new BlockToolbarViewPlugin(view), {
    decorations: (plugin) => plugin.decorations,
  }),
  blockToolbarTheme,
  foldToggleTheme,
];
