import { Facet, type EditorState, type Extension } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import {
  ATOMIC_WIDGET_KINDS,
  addBlockBelow,
  moveBlock,
  readBlockRanges,
  type BlockRange,
} from "./block-move.ts";
import {
  foldToggleTheme,
  foldableToggleAt,
  rangeIsFolded,
  toggleFold,
  type FoldToggleRange,
} from "./fold-toggle.ts";
import { setHeadingLevel } from "./head-level-control.ts";

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
  /** 该块的可折叠范围(仅 heading/有子项 list item;null = 不可折叠) */
  private readonly fold: FoldToggleRange | null;
  /** 折叠状态(渲染时);eq 比较它,折叠/展开后按钮才能刷新 ▾/▸ */
  private readonly foldCollapsed: boolean;

  constructor(
    blockFrom: number,
    labels: { addBlock: string; dragBlock: string },
    fold: FoldToggleRange | null,
    foldCollapsed: boolean,
  ) {
    super();
    this.blockFrom = blockFrom;
    this.labels = labels;
    this.fold = fold;
    this.foldCollapsed = foldCollapsed;
  }

  eq(other: BlockToolbarWidget): boolean {
    return (
      other instanceof BlockToolbarWidget &&
      other.blockFrom === this.blockFrom &&
      other.fold?.lineFrom === this.fold?.lineFrom &&
      other.fold?.kind === this.fold?.kind &&
      other.foldCollapsed === this.foldCollapsed
    );
  }

  ignoreEvent(): boolean {
    return false;
  }

  toDOM(view: EditorView): HTMLElement {
    const document = view.dom.ownerDocument;
    const toolbar = document.createElement("span");
    toolbar.className = "cm-md-block-toolbar";
    toolbar.dataset.blockFrom = String(this.blockFrom);

    const more = document.createElement("button");
    more.type = "button";
    more.className = "cm-md-block-more";
    more.title = "块操作";
    more.setAttribute("aria-label", "块操作");
    more.setAttribute("aria-haspopup", "menu");
    more.setAttribute("aria-expanded", "false");
    // 不进入 Tab 顺序(鼠标辅助);图标用 CSS ::before 显示,
    // textContent 保持空(718c75f 铁律:不污染 .cm-line 文本流)
    more.tabIndex = -1;
    more.addEventListener("pointerdown", (event) => {
      startPointerBlockDrag(view, this.blockFrom, more, event);
    });
    more.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleBlockMenu(view, toolbar, more, this.blockFrom, this.fold);
    });
    toolbar.append(more);

    // 折叠按钮(仅可折叠块显示):并入工具栏,避免行首控件过多
    // 挤占 gutter(原独立 widget 在窄 gutter 下会溢出文本区)
    if (this.fold) {
      const collapsed = rangeIsFolded(view.state, this.fold);
      const fold = document.createElement("button");
      fold.type = "button";
      fold.className = "cm-md-fold-toggle";
      fold.dataset.collapsed = String(collapsed);
      fold.setAttribute("aria-expanded", String(!collapsed));
      fold.setAttribute("aria-label", collapsed ? "展开" : "折叠");
      fold.title = collapsed ? "展开" : "折叠";
      fold.tabIndex = -1;
      fold.addEventListener("mousedown", (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
      fold.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        toggleFold(view, this.blockFrom, this.fold!.kind);
      });
      toolbar.append(fold);
    }

    return toolbar;
  }
}

/** 落点数据:目标块 + 插入侧 + 可选列表深度(横向偏移换算) */
interface DropTarget {
  readonly from: number;
  readonly side: "before" | "after";
  readonly depth?: number;
}

/** ⋮ 菜单状态(挂 DOM,toolbar 为键) */
interface BlockMenuUi {
  readonly menu: HTMLElement;
  readonly onDocPointerDown: (event: PointerEvent) => void;
  readonly onDocKeyDown: (event: KeyboardEvent) => void;
}

const blockMenuUi = new WeakMap<HTMLElement, BlockMenuUi>();

function closeBlockMenu(toolbar: HTMLElement, more: HTMLElement | null): void {
  const ui = blockMenuUi.get(toolbar);
  if (!ui) {
    return;
  }
  ui.menu.remove();
  more?.setAttribute("aria-expanded", "false");
  toolbar.ownerDocument.removeEventListener("pointerdown", ui.onDocPointerDown, true);
  toolbar.ownerDocument.removeEventListener("keydown", ui.onDocKeyDown, true);
  blockMenuUi.delete(toolbar);
}

function menuItem(
  document: Document,
  icon: string,
  label: string,
  className: string,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `cm-md-menu-item ${className}`;
  button.setAttribute("role", "menuitem");
  // 菜单是行首浮层(absolute),文字不进入 .cm-line 文本流,
  // 故 textContent 可用(718c75f 铁律只约束行内按钮)
  button.textContent = label;
  if (icon) {
    const iconEl = document.createElement("span");
    iconEl.className = "cm-md-menu-icon";
    iconEl.textContent = icon;
    button.prepend(iconEl);
  }
  return button;
}

function menuSeparator(document: Document): HTMLElement {
  const separator = document.createElement("span");
  separator.className = "cm-md-menu-separator";
  separator.setAttribute("role", "separator");
  return separator;
}

/** 打开/关闭 ⋮ 菜单(方案 B 收敛入口:添加块/折叠/级别切换) */
function toggleBlockMenu(
  view: EditorView,
  toolbar: HTMLElement,
  more: HTMLElement,
  blockFrom: number,
  fold: FoldToggleRange | null,
): void {
  if (blockMenuUi.has(toolbar)) {
    closeBlockMenu(toolbar, more);
    return;
  }
  const document = view.dom.ownerDocument;
  const menu = document.createElement("span");
  menu.className = "cm-md-block-menu";
  menu.contentEditable = "false";
  menu.setAttribute("role", "menu");

  // 块操作组:添加块(原 + 号按钮收敛于此)
  const addItem = menuItem(document, "＋", "添加块", "cm-md-menu-add");
  addItem.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    closeBlockMenu(toolbar, more);
    addBlockBelow(view, blockFrom);
  });
  menu.append(addItem);

  // 折叠/展开(仅可折叠块)
  if (fold) {
    const collapsed = rangeIsFolded(view.state, fold);
    const foldItem = menuItem(
      document,
      collapsed ? "▸" : "▾",
      collapsed ? "展开" : "折叠",
      "cm-md-menu-fold",
    );
    foldItem.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      closeBlockMenu(toolbar, more);
      toggleFold(view, blockFrom, fold.kind);
    });
    menu.append(foldItem);
  }

  // 标题级别组(仅标题行;复用 head-level-control 的 marker 重写)
  if (fold?.kind === "heading") {
    menu.append(menuSeparator(document));
    const labels = ["H1", "H2", "H3", "H4", "H5", "H6", "正文"];
    for (const label of labels) {
      const level = label === "正文" ? null : Number(label.slice(1));
      const item = menuItem(document, "", label, "cm-md-menu-level");
      item.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        closeBlockMenu(toolbar, more);
        setHeadingLevel(view, blockFrom, level);
      });
      menu.append(item);
    }
  }

  toolbar.append(menu);
  more.setAttribute("aria-expanded", "true");
  // 外部 pointerdown 关闭(捕获阶段;菜单内点击已 stopPropagation)
  const onDocPointerDown = (event: PointerEvent): void => {
    const target = event.target instanceof Node ? event.target : null;
    if (target && toolbar.contains(target)) {
      return;
    }
    closeBlockMenu(toolbar, more);
  };
  // Escape 关闭
  const onDocKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeBlockMenu(toolbar, more);
    }
  };
  document.addEventListener("pointerdown", onDocPointerDown, true);
  document.addEventListener("keydown", onDocKeyDown, true);
  blockMenuUi.set(toolbar, { menu, onDocPointerDown, onDocKeyDown });
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

/** 指示线/ghost 是 view.dom 的 absolute 子元素:定位必须用相对
 *  view.dom 的坐标(客户端坐标直接赋值会在编辑器不在视口左缘时错位,
 *  桌面 App 侧边栏/分栏场景必现)。 */
function toViewCoords(
  view: EditorView,
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  const viewRect = view.dom.getBoundingClientRect();
  return { x: clientX - viewRect.left, y: clientY - viewRect.top };
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
  const ghostPos = toViewCoords(view, event.clientX, event.clientY);
  ghost.style.left = `${ghostPos.x + 12}px`;
  ghost.style.top = `${ghostPos.y + 12}px`;
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
    // 方案 A:指示线横跨编辑区(从 view.dom 左缘 0 到目标行文本右缘),
    // 左端 10px 圆点锚定(theme ::before);不再从文本起点开始,
    // 避免"偏右/没到头"的视觉(用户反馈)
    const viewRect = view.dom.getBoundingClientRect();
    const lineRight = rect.right - viewRect.left;
    ui.indicator.style.left = "0px";
    ui.indicator.style.width = `${Math.max(1, lineRight)}px`;
    ui.indicator.style.top = `${(target.side === "before" ? rect.top : rect.bottom) - viewRect.top}px`;
    ui.indicator.dataset.show = "true";
  }
  const ghostPos = toViewCoords(view, event.clientX, event.clientY);
  ui.ghost.style.left = `${ghostPos.x + 12}px`;
  ui.ghost.style.top = `${ghostPos.y + 12}px`;
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

  // 拖拽开始时关闭该块的 ⋮ 菜单(菜单挂在本 toolbar 内)
  const toolbar = handle.closest<HTMLElement>(".cm-md-block-toolbar");
  if (toolbar) {
    const more = toolbar.querySelector<HTMLElement>(".cm-md-block-more");
    closeBlockMenu(toolbar, more);
  }

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
  state: EditorState,
  blocks: readonly BlockRange[],
  labels: { addBlock: string; dragBlock: string },
): DecorationSet {
  const decorations = blocks.flatMap((block) => {
    // 原子 widget 块(分割线等)不挂工具栏:行级 line 装饰与整块 replace 装饰冲突
    if (ATOMIC_WIDGET_KINDS.has(block.name)) {
      return [];
    }
    return [
      Decoration.line({
        attributes: {
          "data-block-from": String(block.from),
          ...(block.depth !== undefined ? { "data-list-depth": String(block.depth) } : {}),
        },
      }).range(block.from),
      Decoration.widget({
        // 行首最外层 widget(side:-2),标题 H 控件等若用 side:-1 不会互相覆盖
        side: -2,
        widget: (() => {
          const fold = foldableToggleAt(state, block.from);
          return new BlockToolbarWidget(
            block.from,
            labels,
            fold,
            fold !== null && rangeIsFolded(state, fold),
          );
        })(),
      }).range(block.from),
    ];
  });
  return Decoration.set(decorations, true);
}

class BlockToolbarViewPlugin {
  private readonly labels: { addBlock: string; dragBlock: string };
  decorations: DecorationSet;

  constructor(view: EditorView) {
    this.labels = resolveLabels(view.state);
    this.decorations = blockDecorationsFromRanges(
      view.state,
      readBlockRanges(view.state),
      this.labels,
    );
  }

  update(update: ViewUpdate): void {
    if (update.docChanged || update.selectionSet || update.viewportChanged) {
      this.decorations = blockDecorationsFromRanges(
        update.state,
        readBlockRanges(update.state),
        this.labels,
      );
    }
  }
}

/** 块工具栏主题:默认低透明度,行 hover 高亮;拖拽手柄 grab 光标 */
export const blockToolbarTheme = EditorView.baseTheme({
  ".cm-md-block-toolbar": {
    display: "inline-flex",
    gap: "2px",
    // 用 rem(固定)而非 em:em 会随块字号缩放,标题行(1.85em+)负边距
    // 可达 100px+,超出编辑器左 gutter 溢出视口;-4.5rem(锚 ≈16px)是
    // 安全下限:负边距继续加大使工具栏贴视口左缘(x≤8)会触发 CM6 对
    // 负 margin 行首 widget 的坐标测量 bug(点击块首行光标落错行,
    // G005 回归;锚 ≥16 时安全)
    marginInlineStart: "-4.5rem",
    marginInlineEnd: "0.2rem",
    opacity: "0.15",
    verticalAlign: "middle",
    position: "relative",
    background: "var(--theme-surface, #fff)",
    border: "1px solid var(--theme-border)",
    borderRadius: "999px",
    padding: "2px 4px",
  },
  ".cm-line:hover > .cm-md-block-toolbar, .cm-md-block-toolbar:focus-within": {
    opacity: "1",
  },
  ".cm-md-block-toolbar > button": {
    background: "transparent",
    border: "0",
    borderRadius: "4px",
    color: "inherit",
    cursor: "pointer",
    lineHeight: "1",
    padding: "0",
  },
  ".cm-md-block-toolbar > button:hover": {
    background: "var(--theme-primary-selected, rgba(9, 105, 218, 0.12))",
    color: "var(--theme-accent, inherit)",
  },
  // 占位:保持 toolbar 总宽度充足(CM6 行测量对行首 widget 总宽度敏感,
  // 宽度塌陷会导致 posAtCoords 垂直偏移一行,G005 回归;实测 ≥~40px 安全)
  ".cm-md-block-toolbar > .cm-md-block-more": {
    width: "22px",
    height: "20px",
    opacity: "0",
  },
  ".cm-line:hover > .cm-md-block-toolbar > .cm-md-block-more, .cm-md-block-more[aria-expanded='true']":
    {
      opacity: "0.75",
    },
  ".cm-md-block-more[aria-expanded='true']": {
    background: "var(--theme-primary-selected, rgba(9, 105, 218, 0.12))",
    color: "var(--theme-accent, inherit)",
  },
  ".cm-md-block-toolbar > .cm-md-block-more::before": {
    // content 值必须是"带引号的 CSS 字面量"(CM6 baseTheme 构建器
    // 丢弃无引号 content 值,伪元素不渲染,3e2ae09)
    content: '"⋮"',
    fontSize: "14px",
    lineHeight: "1",
  },
  // 菜单浮层(行首下方)
  ".cm-md-block-menu": {
    position: "absolute",
    left: "0",
    top: "calc(100% + 6px)",
    zIndex: "20",
    background: "var(--theme-surface, var(--theme-bg, #ffffff))",
    border: "1px solid var(--theme-border, currentColor)",
    borderRadius: "8px",
    boxShadow: "0 8px 28px rgba(0, 0, 0, 0.12)",
    display: "flex",
    flexDirection: "column",
    minWidth: "150px",
    padding: "5px",
    textAlign: "left",
  },
  ".cm-md-menu-item": {
    background: "transparent",
    border: "0",
    borderRadius: "5px",
    color: "inherit",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    fontFamily: "inherit",
    fontSize: "13px",
    gap: "8px",
    lineHeight: "1.6",
    padding: "6px 10px",
    textAlign: "left",
  },
  ".cm-md-menu-item:hover": {
    background: "var(--theme-primary-selected, rgba(9, 105, 218, 0.12))",
    color: "var(--theme-accent, inherit)",
  },
  ".cm-md-menu-icon": {
    color: "var(--theme-muted, currentColor)",
    fontSize: "13px",
    textAlign: "center",
    width: "14px",
  },
  ".cm-md-menu-separator": {
    background: "var(--theme-border, currentColor)",
    height: "1px",
    margin: "5px 8px",
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
    // 方案 A:线两端加 2px 圆角,质感更精致
    borderRadius: "2px",
  },
  // 方案 A 左端锚点圆点:10px 圆,2px 表面色描边(任意背景可辨);
  // 圆点中心对齐线起点(left 0),避免滚动容器裁剪负坐标
  ".cm-md-block-drop-indicator::before": {
    // content 值必须是"带引号的 CSS 字面量"(CM6 baseTheme 构建器
    // 丢弃无引号 content 值,伪元素不渲染,3e2ae09)
    content: '""',
    position: "absolute",
    left: "0",
    top: "50%",
    transform: "translateY(-50%)",
    width: "10px",
    height: "10px",
    borderRadius: "50%",
    background: "var(--theme-accent, #4c8dff)",
    boxShadow: "0 0 0 2px var(--theme-surface, var(--theme-bg, #ffffff))",
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
  // 折叠按钮由本工具栏渲染(可折叠块),主题一并提供
  foldToggleTheme,
];
