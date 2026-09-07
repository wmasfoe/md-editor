import { describe, expect, it } from "vitest";
import {
  calculateParallaxOffset,
  clamp,
  interpolate,
  sceneIsActiveFromRect,
  sceneProgressFromRect,
} from "../lib/parallax";

describe("calculateParallaxOffset", () => {
  it("computes linear offset with speed multiplier", () => {
    expect(calculateParallaxOffset(100, 0.2)).toBe(20);
    expect(calculateParallaxOffset(200, -0.1)).toBe(-20);
    expect(calculateParallaxOffset(0, 0.5)).toBe(0);
  });

  it("clamps offset to min and max boundaries", () => {
    expect(calculateParallaxOffset(1000, 0.5, -50, 50)).toBe(50);
    expect(calculateParallaxOffset(1000, -0.5, -50, 50)).toBe(-50);
  });
});

describe("clamp", () => {
  it("keeps values inside the inclusive range", () => {
    expect(clamp(3, 0, 10)).toBe(3);
    expect(clamp(-4, 0, 10)).toBe(0);
    expect(clamp(12, 0, 10)).toBe(10);
  });
});

describe("interpolate", () => {
  it("maps a value across input and output ranges", () => {
    expect(interpolate(0.25, [0, 1], [0, 100])).toBe(25);
    expect(interpolate(450, [0, 450], [14, 0])).toBe(0);
    expect(interpolate(0, [0, 450], [14, 0])).toBe(14);
  });

  it("clamps to the output range by default", () => {
    expect(interpolate(-10, [0, 1], [0, 10])).toBe(0);
    expect(interpolate(2, [0, 1], [0, 10])).toBe(10);
  });

  it("can skip output clamping", () => {
    expect(interpolate(2, [0, 1], [0, 10], false)).toBe(20);
  });

  it("returns the first output when the input range is empty", () => {
    expect(interpolate(5, [3, 3], [8, 20])).toBe(8);
  });
});

describe("sceneProgressFromRect", () => {
  it("is 0 when the scene top is flush with the viewport top", () => {
    expect(sceneProgressFromRect(0, 2000, 800)).toBe(0);
  });

  it("is 1 when the remaining travel has been consumed", () => {
    expect(sceneProgressFromRect(-1200, 2000, 800)).toBe(1);
  });

  it("interpolates through the sticky travel", () => {
    expect(sceneProgressFromRect(-600, 2000, 800)).toBe(0.5);
  });

  it("returns 1 when the scene is not taller than the viewport", () => {
    expect(sceneProgressFromRect(0, 700, 800)).toBe(1);
    expect(sceneProgressFromRect(40, 800, 800)).toBe(1);
  });

  it("clamps values before the scene pins and after it leaves", () => {
    expect(sceneProgressFromRect(120, 2000, 800)).toBe(0);
    expect(sceneProgressFromRect(-1800, 2000, 800)).toBe(1);
  });
});

describe("sceneIsActiveFromRect", () => {
  it("is false before the scene reaches the viewport top", () => {
    expect(sceneIsActiveFromRect(80, 2000, 800)).toBe(false);
  });

  it("is true while the tall scene covers the viewport", () => {
    expect(sceneIsActiveFromRect(0, 2000, 800)).toBe(true);
    expect(sceneIsActiveFromRect(-600, 2000, 800)).toBe(true);
  });

  it("is false after the scene has left the viewport", () => {
    expect(sceneIsActiveFromRect(-1300, 2000, 800)).toBe(false);
  });
});
