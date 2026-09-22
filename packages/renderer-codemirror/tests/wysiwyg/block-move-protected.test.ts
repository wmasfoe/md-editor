import { history, undo } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { EditorSelection, EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { M1_MARKDOWN_EXTENSIONS } from "../../src/markdown/extensions.ts";
import { markdownRangeIndexField } from "../../src/markdown/range-index.ts";
import { editorModeField } from "../../src/mode.ts";
import { WysiwygDiagnostics, provideWysiwygDiagnostics } from "../../src/diagnostics.ts";
import { wysiwygChangeProtection } from "../../src/wysiwyg/change-protection.ts";
import { codeBlockLineNumbersField } from "../../src/wysiwyg/code-block-projection.ts";
import {
  configureWysiwygProjectionFeatures,
  wysiwygProjectionField,
} from "../../src/wysiwyg/projection-state.ts";
import {
  addBlockBelow,
  deleteBlock,
  duplicateBlock,
  moveBlockUp,
} from "../../src/wysiwyg/block-move.ts";

/**
 * M8 / AC-H2：块操作单测**必须与 `wysiwygChangeProtection` 组装**。
 *
 * 假设 A3 被评审推翻：既有块操作测试未组装 change-protection，故
 * 「受保护事务被静默拒绝」这类 bug（H2/O3）**结构性不可见**。
 * 本文件补上组装后的回归锁：
 *
 *  - 首条用例是 **harness 自证**：无 `authorizeWysiwygProtectedChange` 注解的
 *    变更在本组装下确实被拒 —— 证明后续正向用例的绿**真的经过保护闸门**，
 *    而非「保护没生效所以怎么改都行」的假绿。
 *  - 其余四条覆盖 H2 补注解的四个 dispatch：moveBlock（经 moveBlockUp 走其
 *    `minimalDocumentChange` dispatch）、addBlockBelow、duplicateBlock、deleteBlock，
 *    目标块全部是 **protectedRanges 成员**（标题 / 围栏代码 / 引用）。
 *
 * 反证（修复前行为）：这四个操作对受保护块会被 transaction filter 静默拒绝
 * —— `view.dispatch` 不抛错、文档不变，调用方无从得知（评审 HIGH: O3/H2）。
 */

function createProtectedView(doc: string, cursor: number): EditorView {
  // 组装方式照抄 change-protection.test.ts 的 createHarness（权威范式）：
  // filter 在非授权分支会读 `wysiwygProjectionField.protectedRanges` —— 缺它会抛
  // 「Field is not present」，那正是自证用例抓到的问题。
  let state = EditorState.create({
    doc,
    selection: EditorSelection.cursor(cursor),
    extensions: [
      history(),
      markdown({ extensions: M1_MARKDOWN_EXTENSIONS }),
      provideWysiwygDiagnostics(new WysiwygDiagnostics()),
      editorModeField,
      markdownRangeIndexField,
      configureWysiwygProjectionFeatures(["tables", "blocks", "default-atoms", "headings"]),
      codeBlockLineNumbersField,
      wysiwygProjectionField,
      wysiwygChangeProtection,
    ],
  });
  return {
    get state() {
      return state;
    },
    dispatch(spec: Parameters<EditorState["update"]>[0] | ReturnType<EditorState["update"]>) {
      state = ("state" in spec && spec.state ? spec : state.update(spec as never)).state;
    },
    focus() {},
  } as unknown as EditorView;
}

/** 取指定内容的块起点（与 block-move.test.ts 同约定） */
function blockFrom(view: EditorView, contains: string): number {
  const lines = view.state.doc.toString().split("\n");
  const index = lines.findIndex((text) => text.includes(contains));
  expect(index, `文档中应存在包含 ${contains} 的行`).toBeGreaterThanOrEqual(0);
  return view.state.doc.line(index + 1).from;
}

describe("M8 / AC-H2：块操作 × wysiwygChangeProtection 组装", () => {
  it("🔴 harness 自证（真闸门）：无注解的表格变更被拒 —— 保护真的在场，防 A3 假绿", () => {
    const doc = "| a | b |\n| - | - |\n| c | d |\n\n正文";
    const view = createProtectedView(doc, 0);
    // 在单元格文本内插入（触碰 table provenance range），**不带**授权注解
    const at = doc.indexOf("| c |") + 2;
    view.dispatch({ changes: { from: at, insert: "X" } });
    expect(
      view.state.doc.toString(),
      "无注解 → transaction filter 必须拒绝；若通过，说明 harness 未组装保护，后续用例全为假绿",
    ).toBe(doc);
  });

  it("保护边界实录：标题正文非受保护原子（裸插入放行）—— 故标题/引用删除属 AC 平凡类，真闸门在 table/fence/html/footnote", () => {
    const doc = "# 标题\n\n正文";
    const view = createProtectedView(doc, 0);
    view.dispatch({ changes: { from: 0, insert: "X" } });
    expect(view.state.doc.toString(), "标题可直接输入（正常打字不被拦）").toContain("X# 标题");
  });

  it("🔴 deleteBlock：表格块（真受保护）删除成功 —— AC-H2 头号场景（修复前：静默拒绝）", () => {
    const doc = "前文\n\n| a | b |\n| - | - |\n| c | d |\n\n后文";
    const view = createProtectedView(doc, doc.indexOf("| c |") + 2);
    const deleted = deleteBlock(view);
    expect(deleted, "删除应被消费").toBe(true);
    const after = view.state.doc.toString();
    expect(after, "表格被移除（带注解 → 通过闸门）").not.toContain("| a | b |");
    expect(after, "相邻块不受损").toContain("前文");
    expect(after).toContain("后文");
  });

  it("moveBlockUp：标题块（protected）上移成功 —— 注解使变更通过闸门", () => {
    const doc = "段落甲\n\n# 标题\n\n段落乙";
    const cursor = doc.indexOf("# 标题") + 3;
    const view = createProtectedView(doc, cursor);
    const moved = moveBlockUp(view);
    expect(moved, "上移应被消费").toBe(true);
    const after = view.state.doc.toString();
    expect(after, "标题块与段落甲交换（修复前：静默拒绝、文档不变）").not.toBe(doc);
    expect(after.indexOf("# 标题"), "标题移动到段落甲之前").toBeLessThan(after.indexOf("段落甲"));
    expect(after, "内容守恒（块数不变，仅换位）").toContain("段落乙");
  });

  it("addBlockBelow：围栏代码块（protected）之后插块成功", () => {
    const doc = "```ts\nconst x = 1;\n```\n\n后续段落";
    const view = createProtectedView(doc, doc.indexOf("const x") + 2);
    const from = blockFrom(view, "```ts");
    const added = addBlockBelow(view, from);
    expect(added, "插入应被消费").toBe(true);
    const after = view.state.doc.toString();
    expect(after, "代码块结构保留").toContain("const x = 1;");
    expect(after.length, "修复前：对围栏代码块的插块被静默拒绝").toBeGreaterThan(doc.length);
  });

  it("duplicateBlock：围栏代码块（protected）复制成功", () => {
    const doc = "```js\nconst y = 2;\n```\n\n后文";
    const view = createProtectedView(doc, doc.indexOf("const y") + 2);
    const duplicated = duplicateBlock(view);
    expect(duplicated, "复制应被消费").toBe(true);
    const after = view.state.doc.toString();
    expect(
      (after.match(/const y = 2;/g) ?? []).length,
      "代码块出现两次（修复前：静默拒绝、仅一次）",
    ).toBe(2);
  });

  it("deleteBlock：标题块（protected）删除成功", () => {
    const doc = "# 待删标题\n\n保留段落";
    const view = createProtectedView(doc, doc.indexOf("# 待删标题") + 4);
    const deleted = deleteBlock(view);
    expect(deleted, "删除应被消费").toBe(true);
    const after = view.state.doc.toString();
    expect(after, "标题被移除（修复前：静默拒绝、标题仍在）").not.toContain("# 待删标题");
    expect(after, "相邻块不受损").toContain("保留段落");
  });

  it("deleteBlock：引用块（protected）删除成功（AC-H2 枚举四类之一）", () => {
    const doc = "前文\n\n> 被引内容\n\n后文";
    const view = createProtectedView(doc, doc.indexOf("> 被引内容") + 5);
    const deleted = deleteBlock(view);
    expect(deleted, "删除应被消费").toBe(true);
    expect(view.state.doc.toString(), "引用块被移除").not.toContain("> 被引内容");
  });

  it("O3 undo：删除受保护块后单次撤销恢复原文档（历史组不被受保护替换破坏）", () => {
    const doc = "# 可恢复标题\n\n保留段落";
    const view = createProtectedView(doc, doc.indexOf("# 可恢复标题") + 4);
    expect(deleteBlock(view), "删除被消费").toBe(true);
    expect(view.state.doc.toString()).not.toContain("# 可恢复标题");
    // 受保护注解的替换事务仍入历史；单次 undo 一步还原
    expect(undo(view), "撤销应成功").toBe(true);
    expect(view.state.doc.toString(), "撤销后逐字还原").toBe(doc);
  });
});
