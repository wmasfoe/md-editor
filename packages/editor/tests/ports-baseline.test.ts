/**
 * @file ports-baseline.test.ts
 * @description P0 ports 缺口补测。先做覆盖盘点，只补真正的缺口，不重写既有覆盖。
 *
 * ## 盘点结果（2026-11-21，`packages/editor/tests/**` 内的方法名命中数）
 *
 * | 端口 | 命中 | 结论 |
 * | --- | --- | --- |
 * | `applyExternalEdit` | 15 | 已覆盖（`renderer.test.ts` R5/R7/R9/R16 + R13/R14 组合期） |
 * | `isComposing` | 16 | 已覆盖（R13/R14/R21） |
 * | `undo` / `redo` | 65 | 已覆盖 |
 * | `setLanguage` / `setMarkdownLint` / `setCodeBlockLineNumbers` / `setInlineStyleMarkers` | 4–11 | 已覆盖 |
 * | `flushPendingEdits` | 5 | 已覆盖（表格单元格） |
 * | `executeFormatting` | 7（全为 `insert.mermaid.*`） | **17 个 `format.*` 见 `formatting-command-ids.test.ts`**（此前的"已覆盖"是虚假声明：那 7 次没有一个 `format.*`） |
 * | `deleteBlock` / `duplicateBlock` / `moveBlockUp` | 4–9 | 已覆盖（另见 `wysiwyg/block-move-protected.test.ts`） |
 * | **`moveBlockDown`** | **0** | **缺口 → 本文件** |
 * | **`acceptSuggestion` / `dismissSuggestion`** | **0** | **缺口 → 本文件** |
 * | **`getSelectionSnapshot`** | **2（未断言 shape）** | **缺口 → 本文件** |
 * | **`openFind` / `openReplace`** | **0** | **缺口 → 本文件** |
 */
import { describe, expect, it } from "vitest";
import { createDocumentState } from "@md-editor/core";
import { createRendererTestHarness, type RendererTestHarness } from "../src/testing.ts";

function createHarness(markdown: string): {
  harness: RendererTestHarness;
  changes: string[];
} {
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
  return { harness, changes };
}

describe("B-1 getSelectionSnapshot 的返回形状", () => {
  it("空选区时 from/to/text 一致且 head/anchor 相等", () => {
    const { harness } = createHarness("alpha beta\n");
    harness.setSelection(5);
    expect(harness.renderer.getSelectionSnapshot()).toEqual({
      from: 5,
      to: 5,
      text: "",
      head: 5,
      anchor: 5,
    });
  });

  it("跨行选区返回首尾与文本", () => {
    const { harness } = createHarness("alpha\nbeta\n");
    harness.setSelection(2, 8);
    const snapshot = harness.renderer.getSelectionSnapshot();
    expect(snapshot.from).toBe(2);
    expect(snapshot.to).toBe(8);
    expect(snapshot.text).toBe("pha\nbe");
    expect(snapshot.anchor).toBe(2);
    expect(snapshot.head).toBe(8);
  });

  it("多选区时报告主选区的 from/to", () => {
    const { harness } = createHarness("one\ntwo\nthree\n");
    harness.setSelections([
      { anchor: 0, head: 3 },
      { anchor: 8, head: 13 },
    ]);
    const snapshot = harness.renderer.getSelectionSnapshot();
    expect(snapshot.from).toBe(0);
    expect(snapshot.to).toBe(3);
    expect(snapshot.text).toBe("one");
  });
});

const suggestion = (from: number, to: number, text: string) => ({
  items: [{ from, to, text }],
  activeIndex: 0,
  from,
  to,
  text,
});

describe("B-5 建议接受 / 取消的生命周期", () => {
  it("没有建议时两者都返回 false 且不抛错", () => {
    const { harness } = createHarness("alpha beta\n");
    expect(harness.renderer.acceptSuggestion()).toBe(false);
    expect(harness.renderer.dismissSuggestion()).toBe(false);
    expect(harness.renderer.getSuggestion()).toBeNull();
  });

  it("dismiss 清除建议但不改文档", () => {
    const { harness } = createHarness("alpha beta\n");
    harness.renderer.showSuggestion(suggestion(5, 5, "gamma "));
    expect(harness.renderer.getSuggestion()).not.toBeNull();
    expect(harness.renderer.dismissSuggestion()).toBe(true);
    expect(harness.renderer.getSuggestion()).toBeNull();
    expect(harness.renderer.getSelectionSnapshot().text).toBe("");
  });

  it("accept 插入建议文本并清除建议", () => {
    const { harness, changes } = createHarness("alpha beta\n");
    harness.renderer.showSuggestion(suggestion(5, 5, "gamma "));
    expect(harness.renderer.acceptSuggestion()).toBe(true);
    expect(harness.renderer.getSuggestion()).toBeNull();
    // 基线：建议文本原样插入 from/to，不额外补空格（"alpha"|"gamma "|" beta"）。
    expect(changes.at(-1)).toBe("alphagamma  beta\n");
  });
});

describe("B-2 moveBlockDown（此前零覆盖）", () => {
  it("把当前块与下一块交换，并且可 undo", () => {
    const { harness, changes } = createHarness("alpha\n\nbeta\n\ngamma\n");
    // 光标落在第二块（beta）内。
    harness.setSelection(7);
    expect(harness.renderer.moveBlockDown()).toBe(true);
    expect(changes.at(-1)).toBe("alpha\n\ngamma\n\nbeta\n\n");
    expect(harness.renderer.undo()).toBe(true);
    expect(changes.at(-1)).toBe("alpha\n\nbeta\n\ngamma\n");
  });

  it("最后一块下移是 no-op（返回 false）", () => {
    const { harness, changes } = createHarness("alpha\n\nbeta\n");
    harness.setSelection(8);
    const before = changes.length;
    expect(harness.renderer.moveBlockDown()).toBe(false);
    expect(changes.length).toBe(before);
  });
});

/**
 * B-4（`openFind` / `openReplace`）在此**不做单测**：`createRendererTestHarness` 的
 * state 适配器没有 `view.plugin`，`@codemirror/search` 的 `openSearchPanel` 会抛
 * `view.plugin is not a function`。它需要真实 `EditorView`，归 e2e 覆盖。
 * 由 `apps/desktop/e2e/public-api-find-replace.spec.ts` 覆盖（B-4：面板打开 / 焦点在面板内 / Escape 关闭）。
 */

describe("B-6 lint 引擎的运行期注入通道", () => {
  it("renderer 暴露 setMarkdownLintEngine（引擎晚到时补注，不重建视图）", () => {
    const { harness } = createHarness("alpha\n");
    expect(typeof harness.renderer.setMarkdownLintEngine).toBe("function");
    // 未注入引擎时注入 undefined 是 no-op，不得抛错。
    expect(() => harness.renderer.setMarkdownLintEngine(undefined)).not.toThrow();
    harness.renderer.destroy();
  });
});
