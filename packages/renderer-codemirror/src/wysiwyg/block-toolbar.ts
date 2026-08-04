import { Facet, type Extension } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { addBlockBelow, moveBlock, readBlockRanges, type BlockRange } from "./block-move.ts";

/**
 * 块工具栏与拖拽(对齐竞品 WYSIWYG 编辑器的块操作,自研实现):
 *
 * - 每块行首挂 BlockToolbarWidget(side:-2):"添加块(+)"按钮 + 六点拖拽手柄;
 *   默认低透明度,所在行 hover 时高亮(不干扰正文);
 * - "+" 点击 → 块下方插入空行(addBlockBelow,插入菜单由宿主层扩展);
 * - 六点手柄:HTML5 drag 在部分 WebView 不可靠,pointer 事件为主通道——
 *   pointerdown(位移超阈值判定拖拽开始)→ pointermove 计算落点
 *   (落点线 + 横向偏移换算列表深度)→ pointerup 执行 moveBlock;
 * - 拖拽期间显示 ghost(跟随指针的块摘要)与落点指示线。
 *
 * 块范围与移动事务复用 block-move.ts 的纯文本逻辑。
 */

/** 拖拽开始前的最小位移阈值(px),区分点击与拖拽 */
const POINTER_DRAG_THRESHOLD = 4;
/** 横向偏移换算列表深度的像素步长(对齐竞品) */
const DEPTH_PIXEL_STEP = 22;

export interface BlockToolbarOptions {
  /** 自定义文案(默认中文) */
  readonly addBlockLabel?: string;
  readonly dragBlockLabel?: string;
}

const DEFAULT_LABELS = {
  addBlock: "添加块",
  dragBlock: "拖拽块",
};

/** 文案覆盖 facet(宿主可注入多语言;构造时读取一次) */
export const blockToolbarLabelsFacet = Facet.define<BlockToolbarOptions, BlockToolbarOptions>({
  combine: (values) => Object.assign({}, ...values),
});

function resolveLabels(state: {
  facet(facet: typeof blockToolbarLabelsFacet): BlockToolbarOptions;
}): { addBlock: string; dragBlock: string } {
  const options = state.facet(blockToolbarLabelsFacet);
  return {
    addBlock: options.addBlockLabel ?? DEFAULT_LABELS.addBlock,
    dragBlock: options.dragBlockLabel ?? DEFAULT_LABELS.dragBlock,
  };
}

class BlockToolbarWidget extends WidgetType {
  private readonly blockFrom: number;
  private readonly labels: { addBlock: string; dragBlock: string };

  constructor(blockFrom: number, labels: { addBlock: string; dragBlock: string }) {
    super();
    this.blockFrom = blockFrom;
    this.labels = labels;
  }

  eq(other: BlockToolbarWidget): boolean {
    return other instanceof BlockToolbarWidget && other.blockFrom === this.blockFrom;
  }

  ignoreEvent(): boolean {
    return false;
  }

  toDOM(view: EditorView): HTMLElement {
    const document = view.dom.ownerDocument;
    const toolbar = document.createElement("span");
    toolbar.className = "cm-md-block-toolbar";
    toolbar.dataset.blockFrom = String(this.blockFrom);

    const add = document.createElement("button");
    add.type = "button";
    add.className = "cm-md-block-add";
    add.title = this.labels.addBlock;
    add.setAttribute("aria-label", this.labels.addBlock);
    add.textContent = "+";
    add.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      addBlockBelow(view, this.blockFrom);
    });

    const drag = document.createElement("span");
    drag.className = "cm-md-block-drag-handle";
    drag.setAttribute("role", "button");
    drag.setAttribute("aria-label", this.labels.dragBlock);
    drag.draggable = true;
    for (let index = 0; index < 6; index += 1) {
      const dot = document.createElement("span");
      dot.className = "cm-md-block-drag-dot";
      drag.append(dot);
    }
    drag.addEventListener("pointerdown", (event) => {
      startPointerBlockDrag(view, this.blockFrom, drag, event);
    });

    toolbar.append(add, drag);
    return toolbar;
  }
}

/** 落点数据:目标块 + 插入侧 + 可选列表深度(横向偏移换算) */
interface DropTarget {
  readonly from: number;
  readonly side: "before" | "after";
  readonly depth?: number;
}

function eventElement(event: Event): Element | null {
  return event.target instanceof Element
    ? event.target
    : event.target instanceof Node
      ? event.target.parentElement
      : null;
}

/** 根据指针位置计算落点:优先命中有 data-block-from 的行,否则按坐标找块 */
function dropTarget(event: MouseEvent, view: EditorView): DropTarget | null {
  const element = eventElement(event)?.closest<HTMLElement>("[data-block-from]");
  const from = Number(element?.dataset.blockFrom);
  if (Number.isInteger(from)) {
    const rect = element?.getBoundingClientRect();
    const side = rect && event.clientY < rect.top + rect.height / 2 ? "before" : "after";
    const currentDepth = Number(element?.dataset.listDepth);
    const pointerDepth =
      rect && Number.isInteger(currentDepth)
        ? Math.max(0, Math.round((event.clientX - rect.left - 22) / DEPTH_PIXEL_STEP))
        : undefined;
    return { depth: pointerDepth, from, side };
  }
  try {
    const position = view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (position === null) {
      return null;
    }
    const block = readBlockRanges(view.state).find(
      (candidate) => position >= candidate.from && position <= candidate.to,
    );
    return block ? { depth: block.depth, from: block.from, side: "after" } : null;
  } catch {
    return null;
  }
}

interface BlockDragUi {
  readonly indicator: HTMLElement;
  readonly ghost: HTMLElement;
}

const blockDragUi = new WeakMap<EditorView, BlockDragUi>();

function clearBlockDragUi(view: EditorView): void {
  const ui = blockDragUi.get(view);
  if (!ui) {
    return;
  }
  ui.indicator.remove();
  ui.ghost.remove();
  delete view.dom.dataset.blockDragging;
  blockDragUi.delete(view);
}

function startBlockDragUi(view: EditorView, sourceFrom: number, event: MouseEvent): void {
  clearBlockDragUi(view);
  const document = view.dom.ownerDocument;
  const source = view.dom.querySelector<HTMLElement>(`.cm-line[data-block-from="${sourceFrom}"]`);
  const indicator = document.createElement("span");
  const ghost = document.createElement("span");
  indicator.className = "cm-md-block-drop-indicator";
  indicator.dataset.show = "false";
  ghost.className = "cm-md-block-drag-ghost";
  ghost.textContent = source?.textContent?.trim() || "块";
  ghost.style.left = `${event.clientX + 12}px`;
  ghost.style.top = `${event.clientY + 12}px`;
  view.dom.append(indicator, ghost);
  view.dom.dataset.blockDragging = "true";
  blockDragUi.set(view, { indicator, ghost });
}

function updateBlockDragUi(view: EditorView, target: DropTarget, event: MouseEvent): void {
  const ui = blockDragUi.get(view);
  if (!ui) {
    return;
  }
  const element = view.dom.querySelector<HTMLElement>(`.cm-line[data-block-from="${target.from}"]`);
  const rect = element?.getBoundingClientRect();
  if (rect) {
    ui.indicator.style.left = `${rect.left}px`;
    ui.indicator.style.top = `${target.side === "before" ? rect.top : rect.bottom}px`;
    ui.indicator.style.width = `${rect.width}px`;
    ui.indicator.dataset.show = "true";
  }
  ui.ghost.style.left = `${event.clientX + 12}px`;
  ui.ghost.style.top = `${event.clientY + 12}px`;
}

/** pointer 拖拽状态机:阈值判定开始 → move 计算落点 → up 执行移动 */
function startPointerBlockDrag(
  view: EditorView,
  sourceFrom: number,
  handle: HTMLElement,
  event: PointerEvent,
): void {
  if (event.button !== 0) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();

  const document = view.dom.ownerDocument;
  const pointerId = event.pointerId;
  const originX = event.clientX;
  const originY = event.clientY;
  let dragging = false;

  const cleanup = (): void => {
    document.removeEventListener("pointermove", handlePointerMove, true);
    document.removeEventListener("pointerup", handlePointerUp, true);
    document.removeEventListener("pointercancel", handlePointerCancel, true);
    delete handle.dataset.dragging;
  };
  const handlePointerMove = (moveEvent: PointerEvent): void => {
    if (moveEvent.pointerId !== pointerId) {
      return;
    }
    if (!dragging) {
      const distance = Math.hypot(moveEvent.clientX - originX, moveEvent.clientY - originY);
      if (distance < POINTER_DRAG_THRESHOLD) {
        return;
      }
      dragging = true;
      handle.dataset.dragging = "true";
      startBlockDragUi(view, sourceFrom, moveEvent);
    }
    const target = dropTarget(moveEvent, view);
    if (target) {
      updateBlockDragUi(view, target, moveEvent);
    }
    moveEvent.preventDefault();
  };
  const handlePointerUp = (upEvent: PointerEvent): void => {
    if (upEvent.pointerId !== pointerId) {
      return;
    }
    cleanup();
    if (!dragging) {
      return;
    }
    const target = dropTarget(upEvent, view);
    if (target) {
      moveBlock(view, sourceFrom, target.from, target.side, target.depth);
    }
    clearBlockDragUi(view);
  };
  const handlePointerCancel = (): void => {
    cleanup();
    if (dragging) {
      clearBlockDragUi(view);
    }
  };

  document.addEventListener("pointermove", handlePointerMove, true);
  document.addEventListener("pointerup", handlePointerUp, true);
  document.addEventListener("pointercancel", handlePointerCancel, true);
}

function blockDecorationsFromRanges(
  blocks: readonly BlockRange[],
  labels: { addBlock: string; dragBlock: string },
): DecorationSet {
  const decorations = blocks.flatMap((block) => [
    Decoration.line({
      attributes: {
        "data-block-from": String(block.from),
        ...(block.depth !== undefined ? { "data-list-depth": String(block.depth) } : {}),
      },
    }).range(block.from),
    Decoration.widget({
      // 行首最外层 widget(side:-2),标题 H 控件等若用 side:-1 不会互相覆盖
      side: -2,
      widget: new BlockToolbarWidget(block.from, labels),
    }).range(block.from),
  ]);
  return Decoration.set(decorations, true);
}

class BlockToolbarViewPlugin {
  private readonly labels: { addBlock: string; dragBlock: string };
  decorations: DecorationSet;

  constructor(view: EditorView) {
    this.labels = resolveLabels(view.state);
    this.decorations = blockDecorationsFromRanges(readBlockRanges(view.state), this.labels);
  }

  update(update: ViewUpdate): void {
    if (update.docChanged || update.selectionSet || update.viewportChanged) {
      this.decorations = blockDecorationsFromRanges(readBlockRanges(update.state), this.labels);
    }
  }
}

/** 块工具栏主题:默认低透明度,行 hover 高亮;拖拽手柄 grab 光标 */
export const blockToolbarTheme = EditorView.baseTheme({
  ".cm-md-block-toolbar": {
    display: "inline-flex",
    gap: "0.15em",
    marginInlineStart: "-3.2em",
    marginInlineEnd: "0.45em",
    opacity: "0.15",
    verticalAlign: "middle",
  },
  ".cm-line:hover > .cm-md-block-toolbar, .cm-md-block-toolbar:focus-within": {
    opacity: "1",
  },
  ".cm-md-block-toolbar > button": {
    background: "transparent",
    border: "0",
    color: "inherit",
    cursor: "pointer",
    padding: "0 0.15em",
  },
  ".cm-md-block-toolbar > .cm-md-block-drag-handle": {
    cursor: "grab",
    display: "inline-flex",
  },
  ".cm-md-block-toolbar > .cm-md-block-drag-handle[data-dragging]": {
    cursor: "grabbing",
  },
  ".cm-md-block-drag-dot": {
    width: "2px",
    height: "2px",
    margin: "0 1px",
    background: "currentColor",
    borderRadius: "50%",
    display: "inline-block",
  },
  ".cm-md-block-drag-ghost": {
    position: "absolute",
    zIndex: "10",
    background: "var(--theme-surface)",
    border: "1px solid var(--theme-border-strong)",
    borderRadius: "4px",
    padding: "2px 8px",
    pointerEvents: "none",
    boxShadow: "var(--theme-shadow)",
    whiteSpace: "nowrap",
    maxWidth: "240px",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  ".cm-md-block-drop-indicator": {
    position: "absolute",
    zIndex: "9",
    height: "2px",
    background: "var(--theme-accent, #4c8dff)",
    pointerEvents: "none",
    display: "none",
  },
  ".cm-md-block-drop-indicator[data-show='true']": {
    display: "block",
  },
});

/** 块工具栏/拖拽扩展(挂渲染层;块范围与移动复用 block-move) */
export const blockToolbarExtension: Extension[] = [
  ViewPlugin.define<BlockToolbarViewPlugin>((view) => new BlockToolbarViewPlugin(view), {
    // update 由 ViewPlugin 自动调用插件实例的 update(update: ViewUpdate)
    decorations: (plugin) => plugin.decorations,
  }),
  blockToolbarTheme,
];
