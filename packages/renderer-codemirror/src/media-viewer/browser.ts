/**
 * @file browser.ts
 * @description 媒体查看器的**浏览器适配层**：真实 DOM 构建、样式注入、键盘/指针接线、
 * 手柄登记与销毁。会话逻辑在 `session.ts`（node 可测），本文件只做"把语义端口接到真实 DOM"。
 *
 * 契约来源：`.omx/plans/prd-mermaid-diagram-viewer.md` §0.1/§4.4.4。
 * 关键实现约束（每条都对应一次评审结论）：
 * - 浮层挂在 `document.body` ⇒ 样式必须**无祖先前缀**且由模块自持注入（宿主样式表前缀永不命中）；
 * - SVG 内容必须**先经 `rewriteSvgIds` 隔离 id** 再注入（否则浮层 `<style>` 为文档级作用域，
 *   会泄漏回正文 SVG 并丢失字体/填充）；
 * - 手柄按 **host DOM** 键控（模块级 `WeakMap`）：CM6 复用 DOM 时会丢弃旧 widget 实例且**不调用其
 *   `destroy`**，实例字段持手柄必然泄漏；
 * - 键盘监听注册在 `document` 的**捕获相**：Escape 只关浮层（HeadlessUI 的 Escape 门是
 *   `!preventedDefault` 且注册在 window 冒泡相 ⇒ "栈式"机制上不成立）；`Mod+K` 关自身但不消费事件。
 */
import {
  createMediaViewerSession,
  type MediaViewerContent,
  type MediaViewerHandle,
  type MediaViewerZoomPan,
  type MediaViewerKeyEvent,
} from "./session.ts";
import {
  ensureViewerStyleElement,
  type ViewerStyleElement,
  type ViewerStylePort,
} from "./styles.ts";
import { rewriteSvgIds } from "./svg-id.ts";
import type { ViewerTransform } from "./zoom-pan.ts";

export interface MediaViewerOptions {
  readonly document: Document;
  /** 手柄的 owner 键（widget 的容器 DOM）：`closeMediaViewerFor(host)` 与重复 open 守卫都按它。 */
  readonly host: HTMLElement;
  readonly content: MediaViewerContent;
  /** 初始视图：图表默认 `"width"`（适应宽度），图片沿用 `"contain"`。 */
  readonly fit: "contain" | "width";
  readonly zoomPan: false | MediaViewerZoomPan;
  /** 打开时是否接管焦点（图片与图表均为 true：浮层是模态，不接管会让键入改到背后文档）。 */
  readonly takeFocus: boolean;
  /** 视口观测注入点（缺省用 `ResizeObserver`，再退化为 window resize）。 */
  readonly observeViewport?: ((target: Element, onResize: () => void) => () => void) | undefined;
  readonly onRequestEdit?: (() => void) | undefined;
  /** 关闭后焦点归还（由调用方注入，通常 `() => view.focus()`）。 */
  readonly restoreFocus?: (() => void) | undefined;
}

/** 模块级 host 键控登记表（唯一所有权来源）。 */
const handlesByHost = new WeakMap<HTMLElement, MediaViewerHandle>();

/** 构造样式注入端口（唯一需要类型断言的地方：`head.append` 接受 `Node`）。 */
function createStylePort(doc: Document): ViewerStylePort {
  return {
    getElementById: (id) => doc.getElementById(id) as ViewerStyleElement | null,
    createStyleElement: () => doc.createElement("style"),
    appendToHead: (node) => {
      doc.head.append(node as unknown as Node);
    },
  };
}

/** 内容节点的"未缩放基准尺寸"：必须与当前 transform 无关，否则缩放/平移会自我叠加。 */
function measureIntrinsicSize(node: Element): { readonly width: number; readonly height: number } {
  if (node instanceof SVGSVGElement) {
    const viewBox = node.viewBox?.baseVal;
    if (viewBox && viewBox.width > 0 && viewBox.height > 0) {
      return { width: viewBox.width, height: viewBox.height };
    }
  }
  if (node instanceof HTMLImageElement && node.naturalWidth > 0 && node.naturalHeight > 0) {
    return { width: node.naturalWidth, height: node.naturalHeight };
  }
  const rect = node.getBoundingClientRect();
  return { width: Math.max(rect.width, 1), height: Math.max(rect.height, 1) };
}

interface OverlayParts {
  readonly root: HTMLDivElement;
  readonly stage: HTMLDivElement;
  readonly media: Element;
}

function buildOverlay(
  doc: Document,
  content: MediaViewerContent,
  zoomPanEnabled: boolean,
  onEditRequest: (() => void) | undefined,
): OverlayParts {
  const root = doc.createElement("div");
  root.className = "cm-md-media-viewer";
  if (zoomPanEnabled) {
    root.classList.add("cm-md-media-viewer--zoom-pan");
  }
  // dialog 语义（否则"把焦点移进无 role 的 div"本身是新的模态缺口）
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-label", content.kind === "svg" ? content.label : content.alt);
  root.tabIndex = -1;

  const stage = doc.createElement("div");
  stage.className = "cm-md-media-viewer__stage";
  root.append(stage);

  let media: Element;
  if (content.kind === "svg") {
    // id 隔离在注入前完成：前缀唯一化 + 全部引用改写（含无空格根选择器与内联 style 值）
    const isolated = rewriteSvgIds(content.svg, `mv-${Math.random().toString(36).slice(2, 8)}-`);
    stage.innerHTML = isolated.svg;
    media = stage.querySelector("svg") ?? stage;
    media.classList.add("cm-md-media-viewer__media", "cm-md-media-viewer__media--svg");
  } else {
    const image = doc.createElement("img");
    image.className = "cm-md-media-viewer__media cm-md-media-viewer__media--image";
    image.src = content.src;
    image.alt = content.alt;
    image.draggable = false;
    stage.append(image);
    media = image;
  }

  const closeButton = doc.createElement("button");
  closeButton.type = "button";
  closeButton.className = "cm-md-media-viewer__close";
  closeButton.setAttribute("aria-label", "关闭");
  closeButton.title = "关闭";
  closeButton.tabIndex = -1;
  closeButton.textContent = "✕";
  root.append(closeButton);

  if (onEditRequest) {
    const editButton = doc.createElement("button");
    editButton.type = "button";
    editButton.className = "cm-md-media-viewer__edit";
    editButton.setAttribute("aria-label", "编辑源码");
    editButton.title = "编辑源码";
    editButton.tabIndex = -1;
    editButton.textContent = "编辑源码";
    root.append(editButton);
  }

  doc.body.append(root);
  return { root, stage, media };
}

interface KeyboardBinding {
  readonly native: (event: KeyboardEvent) => void;
  dispose(): void;
}

function bindDocumentKeyDown(
  doc: Document,
  listener: (event: MediaViewerKeyEvent) => unknown,
): KeyboardBinding {
  const native = (event: KeyboardEvent): void => {
    listener({
      key: event.key,
      metaKey: event.metaKey,
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
      preventDefault: () => event.preventDefault(),
    });
  };
  // 捕获相：先于 HeadlessUI 的 window 冒泡相门（其判据是 !event.defaultPrevented）
  doc.addEventListener("keydown", native, true);
  return {
    native,
    dispose: () => doc.removeEventListener("keydown", native, true),
  };
}

/** 打开查看器：重复 open 先关旧句柄（防幽灵浮层），并把新句柄登记到 host 名下。 */
export function openMediaViewer(options: MediaViewerOptions): MediaViewerHandle {
  const { document: doc, host } = options;
  closeMediaViewerFor(host);
  ensureViewerStyleElement(createStylePort(doc));

  const { root, stage, media } = buildOverlay(
    doc,
    options.content,
    options.zoomPan !== false,
    options.onRequestEdit,
  );
  const contentSize = measureIntrinsicSize(media);
  const closeButton = root.querySelector<HTMLButtonElement>(".cm-md-media-viewer__close");
  const editButton = root.querySelector<HTMLButtonElement>(".cm-md-media-viewer__edit");

  let disposeObserver: (() => void) | null = null;
  let detached = false;
  // 声明必须在会话构造**之前**：键盘端口的 `add` 在构造期同步调用（否则命中 TDZ）
  let keyboard: KeyboardBinding | null = null;
  const styledMedia = media as Element & { style: CSSStyleDeclaration };

  const session = createMediaViewerSession(
    {
      setContent: () => {
        /* 内容在 buildOverlay 内一次构建完成；会话不再改写内容 */
      },
      setTransform: (transform: ViewerTransform) => {
        // 只写 transform 属性（不拼接 style 字符串，避免多次调用后无界增长）
        styledMedia.style.transform = `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`;
      },
      setDragging: (dragging: boolean) => {
        root.classList.toggle("cm-md-media-viewer--dragging", dragging);
      },
      measureViewport: () => {
        const rect = root.getBoundingClientRect();
        return { width: Math.max(rect.width, 1), height: Math.max(rect.height, 1) };
      },
      measureContent: () => contentSize,
      focus: () => root.focus(),
      destroy: () => {
        if (detached) {
          return;
        }
        detached = true;
        disposeObserver?.();
        disposeObserver = null;
        keyboard?.dispose();
        keyboard = null;
        root.remove();
      },
      get mounted() {
        return !detached;
      },
    },
    {
      add: (listener) => {
        keyboard = bindDocumentKeyDown(doc, listener);
      },
      remove: () => {
        keyboard?.dispose();
        keyboard = null;
      },
    },
    {
      content: options.content,
      fit: options.fit,
      zoomPan: options.zoomPan,
      takeFocus: options.takeFocus,
      onRequestEdit: options.onRequestEdit,
      restoreFocus: options.restoreFocus,
      onClose: () => {
        handlesByHost.delete(host);
      },
    },
  );

  closeButton?.addEventListener("click", () => session.handle.close({ restoreFocus: true }));
  editButton?.addEventListener("click", () => session.requestEdit());
  root.addEventListener("click", (event) => {
    if (event.target === root) {
      session.handle.close({ restoreFocus: true });
    }
  });
  root.addEventListener("wheel", (event) => {
    session.handleWheel({
      deltaY: event.deltaY,
      clientX: event.clientX,
      clientY: event.clientY,
      preventDefault: () => event.preventDefault(),
    });
  });
  root.addEventListener("pointerdown", (event) => {
    session.handlePointerDown({ clientX: event.clientX, clientY: event.clientY });
  });
  root.addEventListener("pointermove", (event) => {
    session.handlePointerMove({ clientX: event.clientX, clientY: event.clientY });
  });
  root.addEventListener("pointerup", () => session.handlePointerUp());
  root.addEventListener("pointercancel", () => session.handlePointerUp());
  root.addEventListener("dblclick", () => session.handleDoubleClick());
  // 舞台空白区域拖拽时不要选中文本
  stage.addEventListener("dragstart", (event) => event.preventDefault());

  const observe =
    options.observeViewport ??
    (typeof ResizeObserver === "undefined"
      ? null
      : (target: Element, onResize: () => void) => {
          const observer = new ResizeObserver(() => onResize());
          observer.observe(target);
          return () => observer.disconnect();
        });
  if (observe) {
    disposeObserver = observe(root, () => session.handleResize());
  }

  handlesByHost.set(host, session.handle);
  return session.handle;
}

/** 关闭 registry 中属于该 host 的浮层；未登记时为无操作（幂等）。 */
export function closeMediaViewerFor(host: HTMLElement): void {
  handlesByHost.get(host)?.close({ restoreFocus: false });
}
