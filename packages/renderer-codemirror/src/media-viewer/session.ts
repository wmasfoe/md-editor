/**
 * @file session.ts
 * @description 媒体查看器的**会话逻辑**（与 DOM 解耦，故 node 可测）：变换状态、重复 open 守卫、
 * 监听注册/注销、键盘归属（Escape 只关浮层、`Mod+K` 互斥）、拖拽与滚轮缩放。
 *
 * 为什么把会话与 DOM 适配拆开：
 * - 生命周期是历史上最容易出错的部分（CM6 在 `WidgetType.compare()` 为真时会复用 DOM 并丢弃旧实例，
 *   旧实例的 `destroy` **不会被调用** ⇒ "实例持有句柄"必然泄漏）；
 * - 若把这段逻辑写在真实 DOM 代码里，node 环境无法直测，只能靠 e2e 盲测；
 * - 因此这里用 `MediaViewerOverlayPort` 抽象出少量语义动作，生产端用真实 DOM 实现（`browser.ts`），
 *   测试端用记录型 fake（`tests/media-viewer/support/recording-overlay.ts`），两边共用同一套逻辑。
 *
 * 契约来源：`.omx/plans/prd-mermaid-diagram-viewer.md` §0.1/§4.4.4 与 test-spec 的 AC5/AC6/AC16/AC18。
 */
import {
  DEFAULT_ZOOM_PAN_LIMITS,
  clampTransform,
  createInitialTransform,
  panBy,
  zoomAtPoint,
  type ContentSize,
  type ViewerTransform,
  type ViewportSize,
  type ZoomPanLimits,
} from "./zoom-pan.ts";

export type MediaViewerContent =
  | { readonly kind: "image"; readonly src: string; readonly alt: string }
  /**
   * `svg` 必须是**生产者已消毒过的**标记（本项目为 mermaid 在 `securityLevel: "strict"` 下的产
   * 出，且已经过 `rewriteSvgIds`）。本模块会把它当 DOM 节点注入（而非 `<img>`，以保证
   * `foreignObject` 继承页面 CSS 变量与字体），因此**不接受**来自不可信输入的原始 SVG 字符串。
   */
  | { readonly kind: "svg"; readonly svg: string; readonly label: string };

export interface MediaViewerZoomPan {
  /** 上限（以内容 1:1 为 100%）；下限恒为 contain 比例。 */
  readonly maxScale?: number;
  /** 平移限位余量。 */
  readonly marginRatio?: number;
}

export interface MediaViewerKeyEvent {
  readonly key: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  preventDefault(): void;
}

export interface MediaViewerWheelEvent {
  readonly deltaY: number;
  readonly clientX: number;
  readonly clientY: number;
  preventDefault(): void;
}

export interface MediaViewerPointerEvent {
  readonly clientX: number;
  readonly clientY: number;
}

/** 浮层端口：只声明会话逻辑真正需要的语义动作。 */
export interface MediaViewerOverlayPort {
  /** 应用变换（`translate(x, y) scale(s)` + `transform-origin: 0 0`）。 */
  setTransform(transform: ViewerTransform): void;
  /** 拖拽中视觉（`cursor: grabbing` 一类）。 */
  setDragging(dragging: boolean): void;
  measureViewport(): ViewportSize;
  measureContent(): ContentSize;
  focus(): void;
  destroy(): void;
}

/** 文档级键盘端口（**捕获相**注册；注销必须成对，且实现持持有唯一监听者）。 */
export interface MediaViewerKeyboardPort {
  add(listener: (event: MediaViewerKeyEvent) => void): void;
  /** 注销当前监听（无需传回 listener：实现自己持有它，与适配层实现一致）。 */
  remove(): void;
}

export interface MediaViewerSessionOptions {
  /** 初始视图：`"width"`（默认，适应宽度）/ `"contain"`（整图可见，图片路径沿用）。 */
  readonly fit: "contain" | "width";
  readonly zoomPan: false | MediaViewerZoomPan;
  readonly takeFocus: boolean;
  /** 请求进入源码编辑（浮层**已关闭**后才调用，保证光标落点稳定）。 */
  readonly onRequestEdit?: (() => void) | undefined;
  /** 关闭后的焦点归还（由适配层注入）。 */
  readonly restoreFocus?: (() => void) | undefined;
  /** 关闭完成回调（适配层用于清理宿主侧登记）。 */
  readonly onClose?: (() => void) | undefined;
}

export interface MediaViewerSessionHandle {
  close(options?: { readonly restoreFocus?: boolean }): void;
}

export interface MediaViewerSession {
  readonly handle: MediaViewerSessionHandle;
  handleKeyDown(event: MediaViewerKeyEvent): boolean;
  handleWheel(event: MediaViewerWheelEvent): void;
  handlePointerDown(event: MediaViewerPointerEvent): void;
  handlePointerMove(event: MediaViewerPointerEvent): void;
  handlePointerUp(): void;
  handleDoubleClick(): void;
  handleResize(): void;
  requestEdit(): void;
  readonly closed: boolean;
}

/** 滚轮缩放灵敏度（指数映射，保证连续缩放平滑且与方向无关的对称性）。 */
const WHEEL_ZOOM_SENSITIVITY = 0.0015;

/** 静态模式的恒等变换（不改变元素几何）。 */
const IDENTITY_TRANSFORM: ViewerTransform = Object.freeze({ scale: 1, x: 0, y: 0 });

function resolveLimits(zoomPan: MediaViewerZoomPan): ZoomPanLimits {
  return {
    maxScale: zoomPan.maxScale ?? DEFAULT_ZOOM_PAN_LIMITS.maxScale,
    marginRatio: zoomPan.marginRatio ?? DEFAULT_ZOOM_PAN_LIMITS.marginRatio,
  };
}

/**
 * 创建查看器会话。
 *
 * 键盘归属（对应 PRD §0.1）：
 * - `Escape`：**只关浮层**（`preventDefault`，与图片路径迁移前的捕获相实现同构）——HeadlessUI 的
 *   Escape 门是 `!defaultPrevented` 且注册在 window 冒泡相，因此“栈式”在机制上不成立；
 * - `Mod+K`：**互斥**——先关闭自身且**不** `preventDefault`，让桌面命令面板（window 冒泡相、
 *   不检查 `defaultPrevented`）照常打开。命令面板 `z-[70]` 低于浮层 `1000`，因此“面板盖在浮层上”
 *   不可能成立；互斥是唯一自洽语义。
 */
export function createMediaViewerSession(
  overlay: MediaViewerOverlayPort,
  keyboard: MediaViewerKeyboardPort,
  options: MediaViewerSessionOptions,
): MediaViewerSession {
  const limits = options.zoomPan === false ? null : resolveLimits(options.zoomPan);
  const zoomPanEnabled = limits !== null;
  let closed = false;
  /**
   * 静态模式（`zoomPan: false`，图片路径）**不施加任何变换**：sizing 完全由 CSS 拥有
   * （`.cm-md-media-viewer__media--image` 的 `max-width/max-height + object-fit` 加舞台 flex 居中）。
   * 若会话也去 setTransform，就是两套 sizing 权威叠加——图片会被二次缩放并整体偏移；
   * 而且图片在 `load` 之前自然尺寸尚未就绪（测量回退到占位尺寸）会使错位更严重。
   * 静态模式下的 resize 同样为 no-op（无需重新 fit）。
   */
  let transform: ViewerTransform = zoomPanEnabled
    ? createInitialTransform(
        overlay.measureViewport(),
        overlay.measureContent(),
        options.fit,
        limits ?? DEFAULT_ZOOM_PAN_LIMITS,
      )
    : IDENTITY_TRANSFORM;
  let dragging = false;
  let dragStart: {
    readonly x: number;
    readonly y: number;
    readonly transform: ViewerTransform;
  } | null = null;

  if (zoomPanEnabled) {
    overlay.setTransform(transform);
  }
  if (options.takeFocus) {
    overlay.focus();
  }

  const resetTransform = (): void => {
    if (!zoomPanEnabled) {
      return;
    }
    transform = createInitialTransform(
      overlay.measureViewport(),
      overlay.measureContent(),
      options.fit,
      limits ?? DEFAULT_ZOOM_PAN_LIMITS,
    );
    overlay.setTransform(transform);
  };

  const close = (closeOptions?: { readonly restoreFocus?: boolean }): void => {
    if (closed) {
      return;
    }
    closed = true;
    dragging = false;
    dragStart = null;
    keyboard.remove();
    overlay.destroy();
    options.onClose?.();
    if (closeOptions?.restoreFocus !== false) {
      options.restoreFocus?.();
    }
  };

  const onKeyDown = (event: MediaViewerKeyEvent): boolean => {
    if (event.key === "Escape") {
      event.preventDefault();
      close({ restoreFocus: true });
      return true;
    }
    const isModK = (event.metaKey || event.ctrlKey) && (event.key === "k" || event.key === "K");
    if (isModK) {
      // 互斥：关掉查看器，把事件留给命令面板（不 preventDefault、不 stopPropagation）。
      // 注：这里**不做平台判定**（接受 Meta 或 Ctrl）：非本平台键会“关查看器但不打开面板”，
      // 属无害噪声；宁可保持跨平台宽松，也不引入平台检测这一新的注入面。
      close({ restoreFocus: true });
      return false;
    }
    return false;
  };

  keyboard.add(onKeyDown);

  return {
    handle: {
      close: (closeOptions) => close(closeOptions),
    },
    get closed() {
      return closed;
    },
    handleKeyDown: (event) => onKeyDown(event),
    handleWheel: (event) => {
      if (closed) {
        return;
      }
      if (!zoomPanEnabled) {
        return;
      }
      event.preventDefault();
      const factor = Math.exp(-event.deltaY * WHEEL_ZOOM_SENSITIVITY);
      transform = zoomAtPoint(
        transform,
        { x: event.clientX, y: event.clientY },
        factor,
        overlay.measureViewport(),
        overlay.measureContent(),
        limits ?? DEFAULT_ZOOM_PAN_LIMITS,
      );
      overlay.setTransform(transform);
    },
    handlePointerDown: (event) => {
      if (closed || !zoomPanEnabled) {
        return;
      }
      dragging = true;
      dragStart = { x: event.clientX, y: event.clientY, transform };
      overlay.setDragging(true);
    },
    handlePointerMove: (event) => {
      if (closed || !dragging || dragStart === null) {
        return;
      }
      transform = panBy(
        dragStart.transform,
        event.clientX - dragStart.x,
        event.clientY - dragStart.y,
        overlay.measureViewport(),
        overlay.measureContent(),
        limits ?? DEFAULT_ZOOM_PAN_LIMITS,
      );
      overlay.setTransform(transform);
    },
    handlePointerUp: () => {
      if (!dragging) {
        return;
      }
      dragging = false;
      dragStart = null;
      overlay.setDragging(false);
    },
    handleDoubleClick: () => {
      if (closed || !zoomPanEnabled) {
        return;
      }
      resetTransform();
    },
    handleResize: () => {
      if (closed || !zoomPanEnabled) {
        // 静态模式：sizing 归 CSS，viewport 变化无需重新 fit，也不得施加变换
        return;
      }
      if (options.fit === "width") {
        // 适应宽度：视口变化即重新铺满
        resetTransform();
        return;
      }
      // 整图可见（contain）：**保留**用户当前的缩放与平移，仅按新视口重新限位
      // （此前无条件 resetTransform 会在窗口尺寸变化时丢掉用户的缩放与位置）
      transform = clampTransform(
        transform,
        overlay.measureViewport(),
        overlay.measureContent(),
        limits ?? DEFAULT_ZOOM_PAN_LIMITS,
      );
      overlay.setTransform(transform);
    },
    requestEdit: () => {
      if (closed) {
        return;
      }
      // 先关浮层、再请求编辑 ⇒ 光标落点在浮层移除后确定
      close({ restoreFocus: true });
      options.onRequestEdit?.();
    },
  };
}
