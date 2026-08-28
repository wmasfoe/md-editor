import { describe, expect, it } from "vitest";
import { calculateParallaxOffset } from "../lib/parallax";

describe("calculateParallaxOffset", () => {
  it("computes linear offset with speed multiplier", () => {
    expect(calculateParallaxOffset(100, 0.2)).toBe(20);
    expect(calculateParallaxOffset(200, -0.1)).toBe(-20);
    expect(calculateParallaxOffset(0, 0.5)).toBe(0);
  });

  it("clamps offset to min and max boundaries", () => {
    // 超过上限被裁剪
    expect(calculateParallaxOffset(1000, 0.5, -50, 50)).toBe(50);
    // 低于下限被裁剪
    expect(calculateParallaxOffset(1000, -0.5, -50, 50)).toBe(-50);
  });
});
