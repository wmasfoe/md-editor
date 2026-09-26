import { describe, expect, it } from "vitest";
import { TextDocument } from "../src/document/text-document.ts";
import { computeBlockContexts, MdDocumentView } from "../src/render/md-view.ts";
import { defaultTheme, plainTheme } from "../src/render/theme.ts";

function makeView(markdown: string) {
  const doc = new TextDocument(markdown);
  return { doc, view: new MdDocumentView(doc, plainTheme) };
}

describe("computeBlockContexts", () => {
  it("labels headings, quotes, lists and rules", () => {
    const contexts = computeBlockContexts(["# Title", "> quote", "- item", "---", "text"]);
    expect(contexts.map((c) => c.kind)).toEqual(["heading", "quote", "list", "rule", "paragraph"]);
    expect(contexts[0]).toEqual({ kind: "heading", level: 1 });
  });

  it("tracks fenced code blocks across lines", () => {
    const contexts = computeBlockContexts(["```js", "const a = 1;", "```", "after"]);
    expect(contexts.map((c) => c.kind)).toEqual([
      "fence-delimiter",
      "fence-body",
      "fence-delimiter",
      "paragraph",
    ]);
    expect(contexts[1]).toEqual({ kind: "fence-body", lang: "js" });
  });

  it("labels frontmatter only at the document start", () => {
    const contexts = computeBlockContexts(["---", "title: x", "---", "# H"]);
    expect(contexts.map((c) => c.kind)).toEqual([
      "frontmatter",
      "frontmatter",
      "frontmatter",
      "heading",
    ]);
  });

  it("keeps one context per source line", () => {
    const lines = ["a", "", "# b", "```", "code", "```"];
    expect(computeBlockContexts(lines)).toHaveLength(lines.length);
  });
});

describe("MdDocumentView live preview", () => {
  it("hides markers on inactive lines and keeps the source on the active line", () => {
    const { view } = makeView("# Title");
    expect(view.renderLine(0, { active: false })).toBe("Title");
    expect(view.renderLine(0, { active: true })).toBe("# Title");
  });

  it("styles inline strong/emphasis/code/link and hides their markers when inactive", () => {
    const { view } = makeView("a **b** c *d* e `f` g [h](http://x)");
    expect(view.renderLine(0, { active: false })).toBe("a b c d e f g h");
    expect(view.renderLine(0, { active: true })).toBe("a **b** c *d* e `f` g [h](http://x)");
  });

  it("rewrites list bullets to • on inactive lines", () => {
    const { doc, view } = makeView("- item\n1. ordered");
    expect(view.renderLine(0, { active: false })).toBe("• item");
    expect(doc.lineText(1)).toBe("1. ordered");
    expect(view.renderLine(1, { active: false })).toBe("1. ordered");
    // 活动行保留原始标记
    expect(view.renderLine(0, { active: true })).toBe("- item");
  });

  it("renders blockquote markers as │ on inactive lines", () => {
    const { view } = makeView("> quoted");
    expect(view.renderLine(0, { active: false })).toBe("│ quoted");
    expect(view.renderLine(0, { active: true })).toBe("> quoted");
  });

  it("does not apply inline markdown inside fenced code", () => {
    const { view } = makeView("```\n**not strong**\n```");
    expect(view.renderLine(1, { active: false })).toBe("**not strong**");
  });

  it("keeps CJK text intact", () => {
    const { view } = makeView("# 中文标题");
    expect(view.renderLine(0, { active: false })).toBe("中文标题");
  });

  it("keeps one rendered line per source line", () => {
    const markdown = "# T\n\n- a\n- b\n\n```js\ncode\n```\n> q";
    const { view } = makeView(markdown);
    const rendered = view.renderAll(() => ({ active: false }));
    expect(rendered).toHaveLength(markdown.split("\n").length);
  });

  it("invalidates cached block contexts when the document changes", () => {
    const { doc, view } = makeView("plain");
    expect(view.contextAt(0).kind).toBe("paragraph");
    doc.insertText("# ");
    expect(view.contextAt(0)).toEqual({ kind: "heading", level: 1 });
  });

  it("emits ANSI styles with the default theme", () => {
    const doc = new TextDocument("**bold**");
    const view = new MdDocumentView(doc, defaultTheme);
    const rendered = view.renderLine(0, { active: false });
    expect(rendered).toContain("\x1b[1m");
    expect(rendered).toContain("bold");
    expect(rendered).not.toContain("**");
  });
});
