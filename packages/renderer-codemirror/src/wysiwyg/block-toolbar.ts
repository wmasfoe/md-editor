import { Facet, type EditorState, type Extension } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { readBlockRanges, type BlockRange } from "./block-move.ts";
import { blockWidgetCoveredRanges, projectionStateChanged } from "./projection-state.ts";
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

/**
 * 构建块工具栏 / 折叠控件的行装饰集。
 *
 * 导出供单测：该函数对 state 纯函数化（不触 DOM，widget 只在 `toDOM` 时才需 DOM），
 * 因此可在 node 环境下锁定「块 widget 覆盖行不得挂行装饰」这一契约。
 */
export function blockDecorationsFromRanges(
  state: EditorState,
  blocks: readonly BlockRange[],
): DecorationSet {
  // 块 widget 覆盖的源范围 —— 判据来自**投影层拥有的渲染契约**（`spec.block === true` 且跨文本），
  // 不再用块工具栏自己的 kind 名单（该名单已随本次迁移删除）。
  // 真实缺陷：旧名单只含 4 个 kind，漏掉 setext 标题 / 引用定义 / 脚注定义（三者同为
  // 整块 replace widget），于是在块 widget 同位置挂 `Decoration.line` 与 replace 装饰冲突
  // → 幻影行 / 块消失（与专注模式同一类错误，同一判据修复）。
  const widgetCoveredRanges = blockWidgetCoveredRanges(state);
  // blocks 与覆盖范围均按 from 升序 ⇒ 单调游标 O(blocks + ranges)，不用逐块 some()
  let widgetIndex = 0;
  const isWidgetCovered = (pos: number): boolean => {
    while (
      widgetIndex < widgetCoveredRanges.length &&
      (widgetCoveredRanges[widgetIndex] as { to: number }).to <= pos
    ) {
      widgetIndex += 1;
    }
    const range = widgetCoveredRanges[widgetIndex];
    return range !== undefined && range.from <= pos;
  };

  const decorations = blocks.flatMap((block) => {
    // 整块 widget 渲染的块不挂行装饰（行级 line 装饰与整块 replace 装饰冲突）
    if (isWidgetCovered(block.from)) {
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
    // 失效契约与专注模式**同一份**：投影派生值（块 widget 覆盖范围）必须随投影变化重算，
    // 否则解析覆盖率刷新这类「无 doc/selection/viewport 变化」的投影重建会留下陈旧装饰集，
    // 使行装饰与块 widget 同位置共存（幻影行回归）。
    if (
      update.docChanged ||
      update.selectionSet ||
      update.viewportChanged ||
      projectionStateChanged(update)
    ) {
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
