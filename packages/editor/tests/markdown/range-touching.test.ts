/**
 * T-1…T-3：`MarkdownRangeIndex.touching()` 的闭区间语义，以及**全局契约锁定**——
 * `overlapping()` 对同样的贴边查询必须仍然不命中（防止未来有人把两者合并）。
 */
import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { M1_MARKDOWN_EXTENSIONS } from "../../src/markdown/extensions.ts";
import { markdownRangeIndexField } from "../../src/markdown/range-index.ts";

function indexOf(doc: string) {
  const state = EditorState.create({
    doc,
    extensions: [markdown({ extensions: M1_MARKDOWN_EXTENSIONS }), markdownRangeIndexField],
  });
  const index = state.field(markdownRangeIndexField);
  const bold = index.byKind("bold")[0];
  expect(bold).toBeDefined();
  return { index, bold: bold! };
}

describe("MarkdownRangeIndex.touching", () => {
  it("T-1: 命中记录首尾外侧的贴边区间", () => {
    const { index, bold } = indexOf("Head\n\nxx **bold** yy\n");

    const leftEdge = index.touching(bold.fullRange.from - 2, bold.fullRange.from);
    const rightEdge = index.touching(bold.fullRange.to, bold.fullRange.to + 2);

    expect(leftEdge.some((record) => record.id === bold.id)).toBe(true);
    expect(rightEdge.some((record) => record.id === bold.id)).toBe(true);
  });

  it("T-2: 折叠光标在记录外 1 个字符时不命中", () => {
    const { index, bold } = indexOf("Head\n\nxx **bold** yy\n");

    const outside = index.touching(bold.fullRange.from - 1, bold.fullRange.from - 1);

    expect(outside.some((record) => record.id === bold.id)).toBe(false);
  });

  it("T-3: overlapping() 对贴边查询仍不命中（锁定全局激活契约未被回改）", () => {
    const { index, bold } = indexOf("Head\n\nxx **bold** yy\n");

    const leftEdge = index.overlapping(bold.fullRange.from - 2, bold.fullRange.from);
    const rightEdge = index.overlapping(bold.fullRange.to, bold.fullRange.to + 2);

    expect(leftEdge.some((record) => record.id === bold.id)).toBe(false);
    expect(rightEdge.some((record) => record.id === bold.id)).toBe(false);
    // 严格内部交叠仍然命中（证明该契约本身没有退化）。
    expect(
      index
        .overlapping(bold.fullRange.from + 1, bold.fullRange.to - 1)
        .some((record) => record.id === bold.id),
    ).toBe(true);
  });
});
