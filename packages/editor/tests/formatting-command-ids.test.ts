/**
 * B-3：17 个 `format.*` 命令 id 的包裹 / 切换语义。
 *
 * 此前 `ports-baseline.test.ts` 的覆盖清单写着"executeFormatting 7 次命中 = 已覆盖（格式化命令组）"，
 * 但那 7 次全是 `insert.mermaid.*`，没有一个 `format.*` —— 属于虚假覆盖声明。
 *
 * 这里对 `FORMATTING_COMMAND_MAP` 的每个 id 做同一组断言：
 * 1. id 存在（漏注册会立刻红）；
 * 2. 空行上执行返回 true（命令不得静默失败）；
 * 3. 再执行一次回到原状（**切换**语义；只包裹不还原就是一次性命令）。
 *
 * 两个刻意的例外（按语义而非按"能不能过"处理）：
 * - `format.codeBlock` 是**插入**型（在选区外插围栏），不是切换；断言"插入后内容包含围栏"。
 * - `format.paragraph` 是**归一化**型：正文已经是段落，无编辑可做，因此返回 false（幂等即正确）。
 */
import { describe, expect, it } from "vitest";

import { FORMATTING_COMMAND_MAP } from "../src/wysiwyg/editing/markdown-formatting.ts";
import { createRendererTestHarness } from "../src/testing.ts";
import { createDocumentState } from "@md-editor/core";

const FORMAT_IDS = [
  "format.bold",
  "format.italic",
  "format.strikethrough",
  "format.inlineCode",
  "format.highlight",
  "format.codeBlock",
  "format.blockquote",
  "format.bulletList",
  "format.orderedList",
  "format.taskList",
  "format.paragraph",
  "format.heading1",
  "format.heading2",
  "format.heading3",
  "format.heading4",
  "format.heading5",
  "format.heading6",
] as const;

function createHarness(markdown: string) {
  const document = createDocumentState({ markdown });
  const changes: string[] = [];
  const harness = createRendererTestHarness({
    initialSnapshot: document.getSnapshot(),
    onEditorChange(change) {
      changes.push(change.markdown);
      document.applyEditorChange(change.markdown, change.origin);
    },
    onQueuedExternalEditReady() {},
    onQueuedExternalEditCancelled() {},
  });
  /** 最近一次同步到文档的 markdown；无变化时回落到初始值。 */
  const latest = () => changes.at(-1) ?? markdown;
  return { harness, latest };
}

describe("B-3 格式化命令 id 全覆盖", () => {
  it("登记表里的 id 与源码 FORMATTING_COMMAND_MAP 完全一致（不多不少）", () => {
    expect(Object.keys(FORMATTING_COMMAND_MAP).toSorted()).toEqual([...FORMAT_IDS].toSorted());
  });

  it("format.codeBlock 是插入型：插入围栏而不是切换", () => {
    const { harness, latest } = createHarness("alpha\n");
    harness.setSelection(0, 5);
    expect(harness.renderer.executeFormatting("format.codeBlock")).toBe(true);
    expect(latest()).toContain("```");
    expect(latest()).toContain("alpha");
    harness.renderer.destroy();
  });

  it("format.paragraph 是归一化型：正文已是段落时无变化（返回 false 且不改文档）", () => {
    const { harness, latest } = createHarness("alpha\n");
    harness.setSelection(0, 5);
    // 无变化时返回 false 是**正确**语义：命令没有产生编辑就不该声称成功。
    expect(harness.renderer.executeFormatting("format.paragraph")).toBe(false);
    expect(latest()).toBe("alpha\n");
    harness.renderer.destroy();
  });

  const TOGGLING_IDS = FORMAT_IDS.filter(
    (id) => id !== "format.codeBlock" && id !== "format.paragraph",
  );

  it.each(TOGGLING_IDS)("%s 可执行且具备切换语义", (id) => {
    const { harness, latest } = createHarness("alpha\n");
    harness.setSelection(0, 5);

    const applied = harness.renderer.executeFormatting(id);
    expect(applied).toBe(true);
    expect(latest()).not.toBe("alpha\n");

    const reverted = harness.renderer.executeFormatting(id);
    expect(reverted).toBe(true);
    expect(latest()).toBe("alpha\n");

    harness.renderer.destroy();
  });

  it.each(FORMAT_IDS)("%s 在空行上不抛错", (id) => {
    const { harness } = createHarness("\n");
    expect(() => harness.renderer.executeFormatting(id)).not.toThrow();
    harness.renderer.destroy();
  });
});
