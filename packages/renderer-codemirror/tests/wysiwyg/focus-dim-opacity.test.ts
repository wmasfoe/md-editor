import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { focusDimOpacityFacet, resolveDimOpacity } from "../../src/wysiwyg/focus-mode.ts";

/**
 * code-review LOW「DEFAULT_DIM_OPACITY 走可配通道」的回归锁：
 *  - 默认 0.38（无 facet 输入时）
 *  - facet 注入生效（中值直通）
 *  - 按 spec 区间 **[0.30, 0.50] 硬夹**（超界输入不得破坏 dim 语义）
 */
/** 无 facet 输入时省略（默认路径），否则注入指定值 */
function stateWithFacet(value?: number): EditorState {
  return EditorState.create({
    doc: "正文",
    extensions: value === undefined ? [] : [focusDimOpacityFacet.of(value)],
  });
}

describe("focus dim 强度可配通道（focusDimOpacityFacet）", () => {
  it("无 facet 输入 → 默认 0.38", () => {
    expect(resolveDimOpacity(stateWithFacet())).toBe(0.38);
  });

  it("facet 注入中值直通（0.45）", () => {
    expect(resolveDimOpacity(stateWithFacet(0.45))).toBe(0.45);
  });

  it("🔴 超上界 → 硬夹 0.50（spec 区间上沿）", () => {
    expect(resolveDimOpacity(stateWithFacet(0.9))).toBe(0.5);
  });

  it("🔴 低于下界 → 硬夹 0.30（spec 区间下沿）", () => {
    expect(resolveDimOpacity(stateWithFacet(0.1))).toBe(0.3);
  });
});
