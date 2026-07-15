import { describe, expect, it } from "vitest";
import {
  collectMarkSchemaNames,
  collectNodeSchemaNames,
  commonmarkKeepList,
  gfmKeepList,
  REMOVED_MARK_NAMES,
} from "../components/MilkdownEditor/inlineMarkerPreset";

/**
 * T2 — 核对 keep-list 重组正确性
 *
 * 快照单测：锁定重组后的 mark/node schema 键集。当 Milkdown 升级改变 bundle
 * 组成时，快照 diff 会告警，提示手动核对是否需要调整 keep-list。
 *
 * 预期：
 * - commonmark 保留所有节点（doc/paragraph/heading/hardbreak/blockquote/code_block/hr/image/
 *   bullet_list/ordered_list/list_item/text/html），只有 link mark
 * - gfm 保留所有节点（table/footnote_definition/task_list_item），没有 mark
 * - 4 个 inline mark（strong/emphasis/inlineCode/strike_through）在任意 keep-list 中都不出现
 */
describe("inlineMarkerPreset recomposition correctness", () => {
  it("T2.1 — commonmark keeps all nodes except text-level marks", () => {
    const nodes = collectNodeSchemaNames(commonmarkKeepList);
    const marks = collectMarkSchemaNames(commonmarkKeepList);

    // 快照：commonmark 的节点键集（collectNodeSchemaNames 内部已按字母序排列）
    // 注：docSchema 和 textSchema 由 Milkdown 内部自动注册，不在重组列表中
    expect(nodes).toMatchInlineSnapshot(`
      [
        "blockquote",
        "bullet_list",
        "code_block",
        "hardbreak",
        "heading",
        "hr",
        "html",
        "image",
        "list_item",
        "ordered_list",
        "paragraph",
      ]
    `);

    // 快照：commonmark 只保留 link mark，移除了 strong/emphasis/inlineCode
    // eslint-disable-next-line unicorn/no-array-sort
    expect([...marks].sort()).toMatchInlineSnapshot(`
      [
        "link",
      ]
    `);

    // 回归守护：4 个被移除的 mark 不得出现在重组后的 commonmark keep-list
    for (const removed of REMOVED_MARK_NAMES) {
      expect(marks).not.toContain(removed);
    }
  });

  it("T2.2 — gfm keeps all nodes and has no marks", () => {
    const nodes = collectNodeSchemaNames(gfmKeepList);
    const marks = collectMarkSchemaNames(gfmKeepList);

    // 快照：gfm 的节点键集（table 展开为细粒度子节点，footnote 包含 definition 和 reference）
    // eslint-disable-next-line unicorn/no-array-sort
    expect([...nodes].sort()).toMatchInlineSnapshot(`
      [
        "footnote_definition",
        "footnote_reference",
        "list_item",
        "table",
        "table_cell",
        "table_header",
        "table_header_row",
        "table_row",
      ]
    `);

    // gfm 不注册 mark（strikethrough 已在 commonmark keep-list 中被移除）
    expect(marks).toEqual([]);

    // 回归守护：4 个被移除的 mark 不得出现在 gfm keep-list
    for (const removed of REMOVED_MARK_NAMES) {
      expect(marks).not.toContain(removed);
    }
  });

  it("T2.3 — REMOVED_MARK_NAMES constant matches removal intent", () => {
    // 文档说明的 4 个被移除 mark：emphasis/strong/inlineCode/strikethrough
    // （ProseMirror schema key：inlineCode 驼峰，strike_through 下划线）
    expect(REMOVED_MARK_NAMES).toEqual(["emphasis", "strong", "inlineCode", "strike_through"]);
  });
});
