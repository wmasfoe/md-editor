import type { EditorState, Range } from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import { closeMediaViewerFor, openMediaViewer } from "@md-editor/renderer-codemirror";
import type { MarkdownRangeRecord } from "@md-editor/renderer-codemirror";
import { renderMermaidSvg } from "./mermaid-loader.ts";
import type { MermaidMetadata } from "./mermaid-types.ts";

/** 指针位移阈值（px）：超过即视为拖拽，不打开查看器（避免“想拖选区却弹浮层”）。 */
const OPEN_DRAG_THRESHOLD_PX = 4;

/**
 * 渲染完成后的 SVG 字符串，按 **DOM** 键控。
 *
 * 为什么不放实例字段：CM6 在 `WidgetType.compare()` 为真时走 DOM 复用分支并**丢弃旧实例**
 * （旧实例的 `destroy` 不会被调用），实例字段的状态会随之丢失；DOM 键控与仓库既有惯例一致
 * （`widgetDomState` / `cleanupByDom` 同类）。
 *
 * 为什么存字符串：点击「放大查看」时需**同步**取用已渲染结果交给浮层。若浮层自己再渲染一次，
 * 缓存键（`theme:code`）会 miss（浮层维度不同）⇒ 打开瞬间空白；克隆同一份字符串则零延迟、
 * 零二次渲染，且 id 隔离交给浮层侧统一处理。
 */
const renderedSvgByDom = new WeakMap<HTMLElement, string>();

function scheduleHeightMeasure(view: EditorView, key: string): void {
  view.requestMeasure({
    read(v) {
      const stateObj = (v as unknown as { viewState?: { mustMeasureContent?: boolean } }).viewState;
      if (stateObj) {
        stateObj.mustMeasureContent = true;
      }
    },
    key,
  });
}

/** 把光标送进 mermaid 块的源码正文（第一行 fence 之后），进入就地编辑态。 */
function enterSourceEdit(view: EditorView, anchorPos: number): void {
  const doc = view.state.doc;
  const firstLine = doc.lineAt(Math.min(anchorPos, doc.length));
  const targetPos = Math.min(firstLine.to + 1, doc.length);
  view.dispatch({
    selection: { anchor: targetPos },
    scrollIntoView: true,
  });
  view.focus();
}

/**
 * Mermaid 块级图表渲染 Widget（Typora 式所见即所得原位切换）。
 *
 * v7 交互契约（鼠标/键盘有意分离，详见 docs/agent/architecture/markdown_syntax_plugin_architecture.md §6.3）：
 * - **单击块体 = 只读查看**：打开共享媒体查看器（适应宽度 + 滚轮缩放 + 拖拽平移 + 双击复位），
 *   不修改选区、不展开源码；判定在 `click` 阶段（`detail === 1` + 位移阈值 + 目标非工具栏按钮）；
 * - **编辑入口显式化**：块内悬浮工具栏「编辑源码」与浮层内「编辑源码」；
 * - **键盘仍按 Typora 习惯**：光标/方向键进入块（含块边界）即原位暴露源码（由渲染核心的激活判定
 *   对空选区做闭区间包含实现，本文件不再自己 dispatch 选区）；
 * - **加载/失败态**：SVG 未就绪时「放大查看」禁用且单击不打开；失败卡片单击 = 进入源码编辑
 *   （无图可看时编辑是唯一有意义动作，卡片文案保持自洽）。
 */
export class MermaidBlockWidget extends WidgetType {
  constructor(
    readonly recordId: string,
    readonly code: string,
    readonly anchorPos: number,
  ) {
    super();
  }

  eq(other: MermaidBlockWidget): boolean {
    return this.recordId === other.recordId && this.code === other.code;
  }

  toDOM(view: EditorView): HTMLElement {
    const doc = view.dom.ownerDocument;
    // 外层包装承载悬浮工具栏：滚动层有 overflow-x:auto，绝对定位的工具栏若放在层内会被裁剪
    const wrapper = doc.createElement("div");
    wrapper.className = "cm-md-mermaid-block";
    wrapper.setAttribute("data-record-id", this.recordId);

    const container = doc.createElement("div");
    container.className = "cm-md-mermaid-container";
    container.setAttribute("role", "graphics-document");
    container.setAttribute("aria-label", "Mermaid Diagram");
    container.setAttribute("data-record-id", this.recordId);

    const toolbar = doc.createElement("div");
    toolbar.className = "cm-md-mermaid-toolbar";

    const viewerButton = doc.createElement("button");
    viewerButton.type = "button";
    viewerButton.className = "cm-md-mermaid-toolbar__viewer";
    viewerButton.setAttribute("aria-label", "放大查看图表");
    viewerButton.title = "放大查看";
    viewerButton.textContent = "⤢";
    // 文档内可聚焦控件一律 tabIndex=-1（结构护栏 focusable-controls-convention 会逐文件校验字面量）
    viewerButton.tabIndex = -1;
    viewerButton.disabled = true;

    const editButton = doc.createElement("button");
    editButton.type = "button";
    editButton.className = "cm-md-mermaid-toolbar__edit";
    editButton.setAttribute("aria-label", "编辑图表源码");
    editButton.title = "编辑源码";
    editButton.textContent = "编辑源码";
    editButton.tabIndex = -1;

    toolbar.append(viewerButton, editButton);
    wrapper.append(container, toolbar);

    const isDark = doc.documentElement.classList.contains("dark");

    // 渲染加载中骨架屏占位
    container.innerHTML = `<div class="cm-md-mermaid-loading"><div class="cm-md-mermaid-loading__spinner"></div><span>正在渲染图表...</span></div>`;

    const renderError = (errorMsg: string): void => {
      container.innerHTML = "";
      container.classList.add("cm-md-mermaid--has-error");
      viewerButton.disabled = true;
      renderedSvgByDom.delete(container);

      const errorCard = doc.createElement("div");
      errorCard.className = "cm-md-mermaid-error";

      const title = doc.createElement("div");
      title.className = "cm-md-mermaid-error__title";
      title.textContent = "Mermaid 图表解析错误";

      const msg = doc.createElement("pre");
      msg.className = "cm-md-mermaid-error__message";
      msg.textContent = errorMsg;

      const hint = doc.createElement("div");
      hint.className = "cm-md-mermaid-error__hint";
      hint.textContent = "点击卡片进入源码编辑";

      errorCard.append(title, msg, hint);
      container.append(errorCard);
    };

    // 异步拉取并渲染 SVG
    void renderMermaidSvg(this.code, isDark)
      .then(({ svg, error }) => {
        if (error) {
          renderError(error);
        } else {
          container.innerHTML = "";
          container.classList.remove("cm-md-mermaid--has-error");
          container.innerHTML = svg;
          renderedSvgByDom.set(container, svg);
          viewerButton.disabled = false;
        }
        scheduleHeightMeasure(view, `mermaid-${this.recordId}`);
      })
      .catch((err) => {
        const errorMsg = err instanceof Error ? err.message : String(err);
        renderError(`模块加载失败: ${errorMsg}`);
        scheduleHeightMeasure(view, `mermaid-${this.recordId}`);
      });

    // 点击语义：只读查看（不改选区、不进入源码态）
    let pointerDownAt: { readonly x: number; readonly y: number } | null = null;
    let dragDistance = 0;

    container.addEventListener("mousedown", (event) => {
      // 阻止默认选区/焦点副作用；**不再** dispatch 选区（这是“单击即掉进源码”的原主因）
      event.preventDefault();
      event.stopPropagation();
    });

    container.addEventListener("pointerdown", (event) => {
      pointerDownAt = { x: event.clientX, y: event.clientY };
      dragDistance = 0;
    });

    container.addEventListener("pointermove", (event) => {
      if (!pointerDownAt) {
        return;
      }
      dragDistance = Math.max(
        dragDistance,
        Math.hypot(event.clientX - pointerDownAt.x, event.clientY - pointerDownAt.y),
      );
    });

    container.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.detail !== 1 || dragDistance > OPEN_DRAG_THRESHOLD_PX) {
        return;
      }
      const svg = renderedSvgByDom.get(container);
      if (!svg) {
        // 有意例外：无图可看时（渲染失败）单击即进入源码编辑，与卡片文案自洽
        enterSourceEdit(view, this.anchorPos);
        return;
      }
      openMediaViewer({
        document: doc,
        host: wrapper,
        content: { kind: "svg", svg, label: "Mermaid 图表" },
        fit: "width",
        zoomPan: {},
        takeFocus: true,
        onRequestEdit: () => enterSourceEdit(view, this.anchorPos),
        restoreFocus: () => view.focus(),
      });
    });

    viewerButton.addEventListener("mousedown", (event) => event.stopPropagation());
    viewerButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const svg = renderedSvgByDom.get(container);
      if (!svg) {
        return;
      }
      openMediaViewer({
        document: doc,
        host: wrapper,
        content: { kind: "svg", svg, label: "Mermaid 图表" },
        fit: "width",
        zoomPan: {},
        takeFocus: true,
        onRequestEdit: () => enterSourceEdit(view, this.anchorPos),
        restoreFocus: () => view.focus(),
      });
    });

    editButton.addEventListener("mousedown", (event) => event.stopPropagation());
    editButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      enterSourceEdit(view, this.anchorPos);
    });

    return wrapper;
  }

  override destroy(dom: HTMLElement): void {
    if (!dom || typeof dom.querySelector !== "function") {
      return;
    }
    // 浮层句柄按 host DOM 键控：CM6 复用 DOM 时会丢弃旧实例且不调其 destroy ⇒ 必须按 DOM 关闭
    closeMediaViewerFor(dom);
    const view =
      EditorView.findFromDOM(dom) ??
      (typeof dom.closest === "function" && dom.closest(".cm-editor")
        ? EditorView.findFromDOM(dom.closest(".cm-editor") as HTMLElement)
        : null);
    if (view) {
      scheduleHeightMeasure(view, `mermaid-destroy-${this.recordId}`);
    }
  }

  override get estimatedHeight(): number {
    return 180;
  }

  /** 块体内部事件不交给 CM6（否则点击会按坐标把光标放到块边界 → 触发激活态）。 */
  override ignoreEvent(_event: Event): boolean {
    return true;
  }
}

/**
 * 构建 Mermaid 图表的 WYSIWYG 布局装饰。
 */
export function buildMermaidLayoutDecorations(
  record: MarkdownRangeRecord,
  _state: EditorState,
  context?: { active: boolean; selected: boolean },
): readonly Range<Decoration>[] {
  const meta = (record.metadata?.mermaid ??
    (record as unknown as Record<string, unknown>).mermaid) as MermaidMetadata | undefined;

  if (!meta) {
    return [];
  }

  const active = context?.active ?? false;
  const decorations: Range<Decoration>[] = [];

  if (active) {
    // 激活态：原位展开原始多行 Markdown 源码供直接输入编辑
    if (meta.openingMarkerRange) {
      decorations.push(
        Decoration.mark({
          class: "cm-md-marker cm-md-marker--mermaid",
          wysiwygRecordId: record.id,
          wysiwygRole: "mermaid-marker",
        }).range(meta.openingMarkerRange.from, meta.openingMarkerRange.to),
      );
    }
    if (meta.closingMarkerRange) {
      decorations.push(
        Decoration.mark({
          class: "cm-md-marker cm-md-marker--mermaid",
          wysiwygRecordId: record.id,
          wysiwygRole: "mermaid-marker",
        }).range(meta.closingMarkerRange.from, meta.closingMarkerRange.to),
      );
    }
  } else {
    // 非激活态：整块替换为渲染出的 Mermaid SVG 矢量图表
    decorations.push(
      Decoration.replace({
        widget: new MermaidBlockWidget(record.id, meta.code, record.fullRange.from),
        inclusive: false,
        block: true,
        wysiwygRecordId: record.id,
        wysiwygRole: "mermaid-block-widget",
      }).range(record.fullRange.from, record.fullRange.to),
    );
  }

  return decorations;
}
