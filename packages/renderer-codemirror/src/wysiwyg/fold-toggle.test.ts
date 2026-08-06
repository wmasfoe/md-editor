import { EditorSelection, EditorState } from "@codemirror/state";
import { foldable } from "@codemirror/language";
import { markdown } from "@codemirror/lang-markdown";
import { describe, expect, it } from "vitest";

function createState(doc: string): EditorState {
  return EditorState.create({
    doc,
    extensions: [markdown({ addKeymap: false })],
    selection: EditorSelection.cursor(0),
  });
}

describe("CM6 foldService for markdown (fold-toggle 依赖)", () => {
  it("finds foldable heading ranges (ATX)", () => {
    const doc = "# Title\n\npara\n\n## Sub\n\nmore\n";
    const state = createState(doc);
    const titleRange = foldable(state, state.doc.line(1).from, state.doc.line(1).to);
    expect(titleRange).not.toBeNull();
    expect(titleRange!.to).toBeGreaterThan(state.doc.line(1).to);
    // 第二个标题也可折叠(到文档尾)
    const subRange = foldable(state, state.doc.line(5).from, state.doc.line(5).to);
    expect(subRange).not.toBeNull();
  });

  it("finds foldable setext headings", () => {
    const doc = "Title\n=====\n\npara\n";
    const state = createState(doc);
    const range = foldable(state, state.doc.line(1).from, state.doc.line(1).to);
    expect(range).not.toBeNull();
  });

  it("only list items with children are foldable", () => {
    const doc = "- a\n- b\n  - b1\n- c\n";
    const state = createState(doc);
    // 无子项的 - a 不可折叠
    expect(foldable(state, state.doc.line(1).from, state.doc.line(1).to)).toBeNull();
    // 有子项 b1 的 - b 可折叠(范围覆盖子项)
    const bRange = foldable(state, state.doc.line(2).from, state.doc.line(2).to);
    expect(bRange).not.toBeNull();
    expect(bRange!.to).toBeGreaterThan(state.doc.line(2).to);
  });

  it("foldable ranges survive projection-mode markdown config", async () => {
    // 用渲染器的完整 markdown 配置(带 codeLanguages)验证 foldService 仍生效
    const { createMarkdownLanguageSupport } = await import("../markdown/code-languages.ts");
    const state = EditorState.create({
      doc: "# Title\n\npara\n\n## Sub\n",
      extensions: [createMarkdownLanguageSupport({ addKeymap: false })],
      selection: EditorSelection.cursor(0),
    });
    const titleRange = foldable(state, state.doc.line(1).from, state.doc.line(1).to);
    expect(titleRange).not.toBeNull();
  });
});
