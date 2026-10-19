/**
 * AC6 / AC7 契约测试（**测试先行**）：缩放与平移的纯函数。
 *
 * 契约来源：`.omx/plans/prd-mermaid-diagram-viewer.md` §4.4.5 与
 * `.omx/plans/test-spec-mermaid-diagram-viewer.md` AC6/AC7：
 * - 默认 `fit = "width"`（适应宽度），双击复位到同一值；
 * - 滚轮缩放以**光标为中心**（光标下的内容点保持不动）；
 * - 缩放范围下限 = contain 比例（整图可见）、上限 = 800%（以 SVG 1:1 为 100%）；
 * - 平移限位在图范围 + `marginRatio` 余量内（防止把图拖丢）。
 *
 * 注：断言一律写成显式 matcher（不用内部调用 `expect` 的 helper），以满足 `vitest/expect-expect` 规则。
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_ZOOM_PAN_LIMITS,
  clampTransform,
  computeContainScale,
  computeFitWidthScale,
  createInitialTransform,
  panBy,
  resolveScaleRange,
  zoomAtPoint,
  type ContentSize,
  type ViewportSize,
} from "../../src/media-viewer/zoom-pan.ts";

const VIEWPORT: ViewportSize = { width: 1000, height: 500 };
const CONTENT: ContentSize = { width: 400, height: 400 };
/** 浮点比较精度。 */
const DIGITS = 9;

describe("缩放基准计算", () => {
  it("contain 比例 = min(宽比, 高比)", () => {
    expect(computeContainScale(VIEWPORT, CONTENT)).toBeCloseTo(1.25, DIGITS);
  });

  it("适应宽度比例 = 视口宽 / 内容宽", () => {
    expect(computeFitWidthScale(VIEWPORT, CONTENT)).toBeCloseTo(2.5, DIGITS);
  });

  it("内容尺寸为 0 时退化为 1，不产生 Infinity/NaN", () => {
    expect(computeContainScale(VIEWPORT, { width: 0, height: 0 })).toBe(1);
    expect(computeFitWidthScale(VIEWPORT, { width: 0, height: 10 })).toBe(1);
  });

  it("缩放范围：下限 = contain 比例；上限 = max(800%, 适应宽度比例)", () => {
    const range = resolveScaleRange(VIEWPORT, CONTENT);
    expect(range.minScale).toBeCloseTo(1.25, DIGITS);
    expect(range.maxScale).toBeCloseTo(8, DIGITS);
  });

  it("极小内容时上限被抬到适应宽度比例，保证初始视图可表示", () => {
    const tiny = { width: 50, height: 50 };
    const range = resolveScaleRange(VIEWPORT, tiny);
    expect(range.maxScale).toBeGreaterThanOrEqual(computeFitWidthScale(VIEWPORT, tiny));
  });
});

describe("初始视图", () => {
  it("fit = width 时铺满宽度且垂直居中", () => {
    const transform = createInitialTransform(VIEWPORT, CONTENT, "width");
    expect(transform.scale).toBeCloseTo(2.5, DIGITS);
    expect(transform.x).toBeCloseTo(0, DIGITS);
    expect(transform.y).toBeCloseTo((500 - 400 * 2.5) / 2, DIGITS);
  });

  it("fit = contain 时整图可见且居中", () => {
    const transform = createInitialTransform(VIEWPORT, CONTENT, "contain");
    expect(transform.scale).toBeCloseTo(1.25, DIGITS);
    expect(transform.x).toBeCloseTo((1000 - 400 * 1.25) / 2, DIGITS);
    expect(transform.y).toBeCloseTo((500 - 400 * 1.25) / 2, DIGITS);
  });

  it("初始视图满足平移限位（不会被 clamp 改变）", () => {
    const transform = createInitialTransform(VIEWPORT, CONTENT, "width");
    expect(clampTransform(transform, VIEWPORT, CONTENT)).toEqual(transform);
  });
});

describe("以光标为中心缩放", () => {
  const initial = createInitialTransform(VIEWPORT, CONTENT, "contain");
  const pointer = { x: 500, y: 250 };

  it("光标下的内容点保持不动", () => {
    const before = {
      x: (pointer.x - initial.x) / initial.scale,
      y: (pointer.y - initial.y) / initial.scale,
    };
    const zoomed = zoomAtPoint(initial, pointer, 2, VIEWPORT, CONTENT);
    expect((pointer.x - zoomed.x) / zoomed.scale).toBeCloseTo(before.x, DIGITS);
    expect((pointer.y - zoomed.y) / zoomed.scale).toBeCloseTo(before.y, DIGITS);
  });

  it("缩放因子受上限约束（800%）", () => {
    const zoomed = zoomAtPoint(initial, pointer, 1000, VIEWPORT, CONTENT);
    expect(zoomed.scale).toBeCloseTo(DEFAULT_ZOOM_PAN_LIMITS.maxScale, DIGITS);
  });

  it("缩放因子受下限约束（contain 比例，不会缩到整图不可见）", () => {
    const zoomed = zoomAtPoint(initial, pointer, 0.001, VIEWPORT, CONTENT);
    expect(zoomed.scale).toBeCloseTo(computeContainScale(VIEWPORT, CONTENT), DIGITS);
  });

  it("缩放结果始终满足限位", () => {
    const zoomed = zoomAtPoint(initial, { x: 0, y: 0 }, 4, VIEWPORT, CONTENT);
    expect(clampTransform(zoomed, VIEWPORT, CONTENT)).toEqual(zoomed);
  });
});

describe("平移", () => {
  const initial = createInitialTransform(VIEWPORT, CONTENT, "contain");

  it("正常范围内按位移量平移", () => {
    const moved = panBy(initial, 30, -20, VIEWPORT, CONTENT);
    expect(moved.x).toBeCloseTo(initial.x + 30, DIGITS);
    expect(moved.y).toBeCloseTo(initial.y - 20, DIGITS);
  });

  it("极端拖拽被限位（图不会被拖出视口）", () => {
    const far = panBy(initial, 100000, 100000, VIEWPORT, CONTENT);
    const size = { width: CONTENT.width * far.scale, height: CONTENT.height * far.scale };
    const marginX = DEFAULT_ZOOM_PAN_LIMITS.marginRatio * Math.min(VIEWPORT.width, size.width);
    const marginY = DEFAULT_ZOOM_PAN_LIMITS.marginRatio * Math.min(VIEWPORT.height, size.height);
    expect(far.x).toBeCloseTo(VIEWPORT.width - marginX, DIGITS);
    expect(far.y).toBeCloseTo(VIEWPORT.height - marginY, DIGITS);
    const back = panBy(initial, -100000, -100000, VIEWPORT, CONTENT);
    expect(back.x).toBeCloseTo(marginX - size.width, DIGITS);
    expect(back.y).toBeCloseTo(marginY - size.height, DIGITS);
  });

  it("限位范围不可满足时（极端余量）退化为区间中点，保持确定性", () => {
    const limits = { maxScale: 8, marginRatio: 5 };
    const bigContent = { width: 2000, height: 1000 };
    const moved = panBy({ scale: 1, x: 0, y: 0 }, 100000, 100000, VIEWPORT, bigContent, limits);
    const marginX = 5 * Math.min(VIEWPORT.width, bigContent.width);
    const marginY = 5 * Math.min(VIEWPORT.height, bigContent.height);
    expect(moved.x).toBe((marginX - bigContent.width + (VIEWPORT.width - marginX)) / 2);
    expect(moved.y).toBe((marginY - bigContent.height + (VIEWPORT.height - marginY)) / 2);
  });
});
