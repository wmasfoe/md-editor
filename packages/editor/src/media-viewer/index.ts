/**
 * @file index.ts
 * @description 媒体查看器（Media Viewer）公开入口。
 *
 * 该模块承载"编辑器内媒体（图片 / Mermaid SVG）放大查看"的稳定能力：
 * - 纯函数数学（`zoom-pan`）、id 隔离（`svg-id`）、自持样式（`styles`）可在 node 直测；
 * - 会话逻辑（`session`）与 DOM 解耦，浏览器适配在 `browser`。
 *
 * 设计约束见 `.omx/plans/prd-mermaid-diagram-viewer.md` §4.4：样式的载体、生命周期所有权、
 * 键盘归属（Escape 只关浮层 / `Mod+K` 互斥）都在此模块内闭环，调用方只注入内容与回调。
 */
export {
  closeMediaViewerFor,
  openMediaViewer,
  type MediaViewerHandle,
  type MediaViewerOptions,
} from "./browser.ts";
export {
  createMediaViewerSession,
  type MediaViewerContent,
  type MediaViewerKeyEvent,
  type MediaViewerKeyboardPort,
  type MediaViewerOverlayPort,
  type MediaViewerPointerEvent,
  type MediaViewerSession,
  type MediaViewerSessionHandle,
  type MediaViewerSessionOptions,
  type MediaViewerWheelEvent,
  type MediaViewerZoomPan,
} from "./session.ts";
export {
  createMediaViewerRegistry,
  type MediaViewerRegistry,
  type ViewerHandleLike,
} from "./registry.ts";
export {
  ensureViewerStyleElement,
  VIEWER_CSS,
  VIEWER_STYLE_ELEMENT_ID,
  type ViewerStyleElement,
  type ViewerStylePort,
} from "./styles.ts";
export {
  collectSvgIds,
  findDanglingReferences,
  findLeakedIdTokens,
  rewriteSvgIds,
  type SvgIdRewriteResult,
} from "./svg-id.ts";
export {
  DEFAULT_ZOOM_PAN_LIMITS,
  clampTransform,
  computeContainScale,
  computeFitWidthScale,
  createInitialTransform,
  panBy,
  resolveScaleRange,
  zoomAtPoint,
  type ContentSize,
  type ViewerTransform,
  type ViewportSize,
  type ZoomPanLimits,
} from "./zoom-pan.ts";
