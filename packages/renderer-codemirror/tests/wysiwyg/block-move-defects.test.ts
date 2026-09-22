import { EditorSelection, EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { markdown } from "@codemirror/lang-markdown";
import { M1_MARKDOWN_EXTENSIONS } from "../../src/markdown/extensions.ts";
import { markdownRangeIndexField } from "../../src/markdown/range-index.ts";
import { editorModeField } from "../../src/mode.ts";
import { readBlockRanges, type BlockRange } from "../../src/wysiwyg/block-move.ts";

/**
 * S3 / D-3 阶段 A：`block-move` 缺陷的**复现优先**用例（P5 先锁行为再改）。
 *
 * 铁律：每条先写复现用例，在**未修复代码上必须 FAIL**（这是复现证据）；阶段 B 修复后转绿，
 * 且既有 `block-move.test.ts` 不回退。未能复现的条目**只记录不修改**。
 *
 * 缺陷清单来源：Architect 共识评审 pass-1/pass-2 对 `block-move.ts` 的六条静态推断（B1–B6）。
 */

function blocksOf(doc: string): readonly BlockRange[] {
  const state = EditorState.create({
    doc,
    selection: EditorSelection.cursor(0),
    extensions: [
      markdown({ extensions: M1_MARKDOWN_EXTENSIONS, addKeymap: false }),
      editorModeField,
      markdownRangeIndexField,
    ],
  });
  return readBlockRanges(state);
}

function depths(doc: string): readonly number[] {
  return blocksOf(doc).map((block) => block.depth ?? 0);
}

describe("B1 🔴 列表层级推导：不得硬编码「2 列 = 1 级」", () => {
  /**
   * 缺陷：`readBlockRanges` 用 `Math.floor(markdownColumnWidth(marker[1]) / 2)`
   * （`block-move.ts:90`）把层级硬编码成 2 列一级。
   *
   * CommonMark 的层级取决于**父级 marker 的内容列**：`- ` 内容列 = 2；`1. ` = 3；`10. ` = 4。
   * 故 depth 应由「祖先 marker 内容列栈」推导，而非固定列宽。
   */
  it("B1-1 🔴 两位数有序列表 `10. `（内容列 4）：4 列缩进子项应为 depth 1，现算法给出 2", () => {
    expect(depths("10. 项目\n    1. 子项"), "父 marker 内容列 = 4，子项缩进 4 列 = 一级").toEqual([
      0, 1,
    ]);
  });

  it("B1-2 无序列表 `- `（内容列 2）：2 列缩进子项为 depth 1（回归锁，现状正确）", () => {
    expect(depths("- 项目\n  - 子项")).toEqual([0, 1]);
  });

  it("B1-3 🔴 单位数有序列表 `1. `（内容列 3）三层嵌套：应为 [0,1,2]，现算法第 3 层算错", () => {
    // 现算法：floor(3/2)=1 ✅、floor(6/2)=3 ❌（应为 2）
    expect(depths("1. 甲\n   1. 乙\n      1. 丙")).toEqual([0, 1, 2]);
  });

  it("B1-4 无序列表三层嵌套层级连续递增（回归锁，现状正确）", () => {
    expect(depths("- 一\n  - 二\n    - 三")).toEqual([0, 1, 2]);
  });
});

describe("B3 引用块内嵌列表的块粒度", () => {
  /**
   * 缺陷推断：`> - x` 不匹配 marker regex（要求 marker 位于 `^(\s*)`），被 `quote`
   * record 的 `fullRange` 覆盖判定吞掉 → 整个引用退化成一块。
   *
   * 预期：与顶层列表行粒度**一致**（列表行独立成块），或明确记录为**有意行为**。
   */
  it("B3-1 引用块内嵌列表不应让块粒度退化为整块引用", () => {
    const blocks = blocksOf("> - 甲\n> - 乙");
    // 顶层列表行为逐行成块；引用内列表若退化为整块，则块数 < 2
    expect(
      blocks.length,
      `引用内列表块粒度退化为整块引用（blocks=${JSON.stringify(blocks)}）`,
    ).toBeGreaterThanOrEqual(2);
  });
});

describe("B6 Setext 标题不得被并入段落块", () => {
  it("B6-1 `标题\\n===` 应独立成块，不与后续段落合并", () => {
    const blocks = blocksOf("标题\n===\n\n正文");
    const first = blocks[0];
    expect(first?.name, "setext 标题应有自己的 record kind").not.toBe("paragraph");
  });
});

describe("M11 readBlockRanges 模块级缓存：文档变更后必须失效", () => {
  /**
   * M11 把 `readBlockRanges` 改为按 index/doc 身份缓存（因其被纳入专注模式的每键热路径，
   * 而内部是 O(lines × records)）。缓存的**首要风险是陈旧命中** —— 若失效条件不正确，
   * 块操作会基于过期范围移动/删除，产生静默数据损坏。
   *
   * 因此断言两件事：
   *  1) 同一 state 重复调用返回**同一引用**（缓存确实命中，否则优化无效）；
   *  2) dispatch 文档变更后调用返回**新结果**（缓存确实失效）。
   */
  it("同一 state 连续两次读取 → 缓存命中（同一引用，优化才有效）", () => {
    const state = EditorState.create({
      doc: "第一段\n\n第二段",
      selection: EditorSelection.cursor(0),
      extensions: [
        markdown({ extensions: M1_MARKDOWN_EXTENSIONS, addKeymap: false }),
        editorModeField,
        markdownRangeIndexField,
      ],
    });
    const first = readBlockRanges(state);
    const second = readBlockRanges(state);
    expect(second).toBe(first);
  });

  it("🔴 文档变更后 → 缓存必须失效（不得返回陈旧块范围）", () => {
    const base = EditorState.create({
      doc: "第一段\n\n第二段",
      selection: EditorSelection.cursor(0),
      extensions: [
        markdown({ extensions: M1_MARKDOWN_EXTENSIONS, addKeymap: false }),
        editorModeField,
        markdownRangeIndexField,
      ],
    });
    // 先填缓存
    const before = readBlockRanges(base);
    expect(before.length).toBeGreaterThan(0);

    // 变更文档：新增一个「新段」
    const changed = base.update({
      changes: { from: 0, to: 0, insert: "新段\n\n" },
      selection: EditorSelection.cursor(0),
    }).state;
    const after = readBlockRanges(changed);

    // 陈旧命中的判别信号：文档内容已变，但结果对象与 before 恒等
    expect(after, "缓存不得在文档变更后返回同一引用").not.toBe(before);
    expect(changed.doc.toString()).not.toBe(base.doc.toString());
    // 且首块内容必须反映变更后的文档（新增段落成为首块）
    expect(after[0]?.from).toBe(0);
  });
});
