/**
 * @file zoom-pan.ts
 * @description 媒体查看器缩放/平移的**纯函数**数学层（不接触 DOM，故可在 node 环境直测）。
 *
 * 契约来源：`.omx/plans/prd-mermaid-diagram-viewer.md` §4.4.5 与 AC6/AC7。
 * 约定：
 * - 内容元素使用 `transform: translate(x, y) scale(s)` 且 `transform-origin: 0 0`；
 *   内容点 `(cx, cy)` 映射到视口点 `(x + cx*s, y + cy*s)`；
 * - 缩放区间下限为 contain 比例（整图至少能看全），上限为 `maxScale`（默认 800%）；
 * - 平移限位保证内容与视口至少有 `marginRatio` 的重叠，避免把图拖丢。
 */

export interface ViewportSize {
  readonly width: number;
  readonly height: number;
}

export interface ContentSize {
  readonly width: number;
  readonly height: number;
}

export interface ViewerTransform {
  readonly scale: number;
  readonly x: number;
  readonly y: number;
}

export interface ZoomPanLimits {
  /** 缩放上限（以内容 1:1 为 100%）。 */
  readonly maxScale: number;
  /** 平移限位余量（相对视口与内容的较小者）。 */
  readonly marginRatio: number;
}

export const DEFAULT_ZOOM_PAN_LIMITS: ZoomPanLimits = Object.freeze({
  maxScale: 8,
  marginRatio: 0.1,
});

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

/** contain 比例：整图刚好完整可见（下限）。 */
export function computeContainScale(viewport: ViewportSize, content: ContentSize): number {
  if (!isPositiveFinite(content.width) || !isPositiveFinite(content.height)) {
    return 1;
  }
  return Math.min(viewport.width / content.width, viewport.height / content.height);
}

/** 适应宽度比例：铺满视口宽度（默认初始视图）。 */
export function computeFitWidthScale(viewport: ViewportSize, content: ContentSize): number {
  if (!isPositiveFinite(content.width)) {
    return 1;
  }
  return viewport.width / content.width;
}

/**
 * 解析缩放区间。
 * 上限取 `max(limits.maxScale, 适应宽度比例)`：极小图在宽视口下"适应宽度"的比例可能超过 800%，
 * 此时必须抬高上限，否则初始视图无法表示（会立刻被 clamp 改掉）。
 */
export function resolveScaleRange(
  viewport: ViewportSize,
  content: ContentSize,
  limits: ZoomPanLimits = DEFAULT_ZOOM_PAN_LIMITS,
): { readonly minScale: number; readonly maxScale: number } {
  const minScale = computeContainScale(viewport, content);
  const fitWidthScale = computeFitWidthScale(viewport, content);
  return { minScale, maxScale: Math.max(limits.maxScale, fitWidthScale) };
}

/** 平移限位：内容与视口至少保持 `marginRatio` 重叠；范围不可满足时退化为居中（确定性）。 */
export function clampTransform(
  transform: ViewerTransform,
  viewport: ViewportSize,
  content: ContentSize,
  limits: ZoomPanLimits = DEFAULT_ZOOM_PAN_LIMITS,
): ViewerTransform {
  const width = content.width * transform.scale;
  const height = content.height * transform.scale;
  const marginX = limits.marginRatio * Math.min(viewport.width, width);
  const marginY = limits.marginRatio * Math.min(viewport.height, height);
  const minX = marginX - width;
  const maxX = viewport.width - marginX;
  const minY = marginY - height;
  const maxY = viewport.height - marginY;
  return {
    scale: transform.scale,
    x: minX > maxX ? (minX + maxX) / 2 : clamp(transform.x, minX, maxX),
    y: minY > maxY ? (minY + maxY) / 2 : clamp(transform.y, minY, maxY),
  };
}

/** 初始视图：`fit = "width"`（默认）铺满宽度，`fit = "contain"` 整图可见；均居中并满足限位。 */
export function createInitialTransform(
  viewport: ViewportSize,
  content: ContentSize,
  fit: "contain" | "width",
  limits: ZoomPanLimits = DEFAULT_ZOOM_PAN_LIMITS,
): ViewerTransform {
  const range = resolveScaleRange(viewport, content, limits);
  const desired = fit === "width" ? computeFitWidthScale(viewport, content) : range.minScale;
  const scale = clamp(desired, range.minScale, range.maxScale);
  return clampTransform(
    {
      scale,
      x: (viewport.width - content.width * scale) / 2,
      y: (viewport.height - content.height * scale) / 2,
    },
    viewport,
    content,
    limits,
  );
}

/** 以光标为中心缩放：保持光标下的内容点不动（随后仍受限位约束）。 */
export function zoomAtPoint(
  transform: ViewerTransform,
  pointer: { readonly x: number; readonly y: number },
  scaleFactor: number,
  viewport: ViewportSize,
  content: ContentSize,
  limits: ZoomPanLimits = DEFAULT_ZOOM_PAN_LIMITS,
): ViewerTransform {
  const range = resolveScaleRange(viewport, content, limits);
  const nextScale = clamp(transform.scale * scaleFactor, range.minScale, range.maxScale);
  const safeScale = isPositiveFinite(transform.scale) ? transform.scale : 1;
  const contentX = (pointer.x - transform.x) / safeScale;
  const contentY = (pointer.y - transform.y) / safeScale;
  return clampTransform(
    { scale: nextScale, x: pointer.x - contentX * nextScale, y: pointer.y - contentY * nextScale },
    viewport,
    content,
    limits,
  );
}

/** 按位移平移（随后受限位约束）。 */
export function panBy(
  transform: ViewerTransform,
  deltaX: number,
  deltaY: number,
  viewport: ViewportSize,
  content: ContentSize,
  limits: ZoomPanLimits = DEFAULT_ZOOM_PAN_LIMITS,
): ViewerTransform {
  return clampTransform(
    { scale: transform.scale, x: transform.x + deltaX, y: transform.y + deltaY },
    viewport,
    content,
    limits,
  );
}
