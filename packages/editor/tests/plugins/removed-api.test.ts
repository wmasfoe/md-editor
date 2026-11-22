import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { createDocumentState } from "@md-editor/core";
import { CodeMirrorEditor } from "../../src/react/index.ts";
import { createRendererTestHarness } from "../../src/testing.ts";

/**
 * G-6：已删除的语法插件入口不得复活。
 *
 * 两层都要守：
 * - 运行时：`renderer` 上没有 `use`；
 * - 类型层：写 `renderer.use` 必须编译错误（`@ts-expect-error` 消费它）。
 *   若有人把 `use` 加回来，指令变成未使用 → TS2578 → 测试失败（自证伪）。
 * 注意不能用 `Record<string, unknown>` 索引挂指令：索引访问合法，会产生 TS2578。
 */
describe("已删除的插件入口", () => {
  it("renderer 上没有 use()", () => {
    const document = createDocumentState({ markdown: "alpha\n" });
    const harness = createRendererTestHarness({
      initialSnapshot: document.getSnapshot(),
      onEditorChange() {},
      onQueuedExternalEditReady() {},
      onQueuedExternalEditCancelled() {},
    });
    expect((harness.renderer as unknown as Record<string, unknown>)["use"]).toBeUndefined();
  });

  it("类型层不再暴露 use()", () => {
    const document = createDocumentState({ markdown: "" });
    const harness = createRendererTestHarness({
      initialSnapshot: document.getSnapshot(),
      onEditorChange() {},
      onQueuedExternalEditReady() {},
      onQueuedExternalEditCancelled() {},
    });
    // @ts-expect-error —— use() 已删除；若它回来，这行会变成 TS2578
    const removedUse: unknown = harness.renderer.use;
    expect(removedUse).toBeUndefined();
  });

  it("renderer 上没有 syntaxPlugins 别名（运行时）", () => {
    const document = createDocumentState({ markdown: "" });
    const harness = createRendererTestHarness({
      initialSnapshot: document.getSnapshot(),
      onEditorChange() {},
      onQueuedExternalEditReady() {},
      onQueuedExternalEditCancelled() {},
    });
    expect(
      (harness.renderer as unknown as Record<string, unknown>)["syntaxPlugins"],
    ).toBeUndefined();
  });

  it("类型层不再暴露 syntaxPlugins 别名", () => {
    const documentState = createDocumentState({ markdown: "" });
    // @ts-expect-error —— syntaxPlugins 别名已删除（声明式插件只走 plugins）
    const legacy = createElement(CodeMirrorEditor, { syntaxPlugins: [], document: documentState });
    expect(legacy).toBeTruthy();
  });
});
