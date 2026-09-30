import { describe, expect, it } from "vitest";
import {
  displayColumnAt,
  displayWidth,
  graphemeCount,
  graphemeIndexAtDisplayColumn,
  graphemeToOffset,
  offsetToGrapheme,
  segmentGraphemes,
} from "../src/buffer/graphemes.ts";

describe("graphemes", () => {
  it("segments ascii, CJK and emoji correctly", () => {
    expect(segmentGraphemes("a中b")).toEqual(["a", "中", "b"]);
    expect(segmentGraphemes("👍")).toEqual(["👍"]);
    expect(graphemeCount("👨‍👩‍👧‍👦")).toBe(1);
    expect(graphemeCount("e\u0301")).toBe(1); // e + 组合重音 = 1 grapheme
  });

  it("measures display width with CJK double-width semantics", () => {
    expect(displayWidth("a")).toBe(1);
    expect(displayWidth("中")).toBe(2);
    expect(displayWidth("a中b")).toBe(4);
    expect(displayWidth("👨‍👩‍👧‍👦")).toBe(2);
  });

  it("converts grapheme index to code-unit offset and back", () => {
    const line = "a中👍b"; // a@0, 中@1, 👍@2-3(代理对), b@4
    expect(graphemeToOffset(line, 0)).toBe(0);
    expect(graphemeToOffset(line, 2)).toBe(2);
    expect(graphemeToOffset(line, 3)).toBe(4);
    expect(graphemeToOffset(line, 4)).toBe(5);
    expect(offsetToGrapheme(line, 2)).toBe(2);
    expect(offsetToGrapheme(line, 3)).toBe(2); // 落在代理对内部 → 吸附到该 grapheme
    expect(offsetToGrapheme(line, 5)).toBe(4);
    expect(offsetToGrapheme(line, 99)).toBe(4);
  });

  it("computes display column for a grapheme index", () => {
    expect(displayColumnAt("a中b", 0)).toBe(0);
    expect(displayColumnAt("a中b", 1)).toBe(1);
    expect(displayColumnAt("a中b", 2)).toBe(3); // 中 占 2 列
    expect(displayColumnAt("a中b", 3)).toBe(4);
  });

  it("snaps a display column inside a wide grapheme to its start", () => {
    const line = "a中b";
    expect(graphemeIndexAtDisplayColumn(line, 0)).toBe(0);
    expect(graphemeIndexAtDisplayColumn(line, 1)).toBe(1);
    expect(graphemeIndexAtDisplayColumn(line, 2)).toBe(1); // 落在"中"内部 → 吸附其起点
    expect(graphemeIndexAtDisplayColumn(line, 3)).toBe(2);
    expect(graphemeIndexAtDisplayColumn(line, 99)).toBe(3);
  });
});
