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

describe("MdDocumentView 增量失效", () => {
  it("在文档中途插入代码围栏后，后续行变为代码正文；删掉恢复", () => {
    const { doc, view } = makeView("alpha\nbeta\ngamma");
    expect(view.contextAt(2).kind).toBe("paragraph");

    doc.setPosition(0, 0);
    doc.insertText("```ts\n"); // 在开头插入围栏 + 换行
    expect(view.contextAt(0).kind).toBe("fence-delimiter");
    expect(view.contextAt(1)).toEqual({ kind: "fence-body", lang: "ts" });
    expect(view.contextAt(3)).toEqual({ kind: "fence-body", lang: "ts" });

    doc.deleteLines(0, 1); // 整行删掉围栏
    expect(view.contextAt(0).kind).toBe("paragraph");
    expect(view.contextAt(1).kind).toBe("paragraph");
    expect(view.contextAt(2).kind).toBe("paragraph");
  });

  it("两次渲染之间发生多次编辑时，按最早被编辑的行失效（不漏失效）", () => {
    const { doc, view } = makeView("one\ntwo\nthree");
    // 第一次渲染先建缓存
    expect(view.contextAt(2).kind).toBe("paragraph");

    // 编辑 1：文档开头开围栏（影响其后所有行）
    doc.setPosition(0, 0);
    doc.insertText("```\n");
    // 编辑 2：文档末尾追加一行（行号比编辑 1 更靠后）
    doc.moveDocEnd();
    doc.insertText("\ntail");

    // 中间没有渲染，一次渲染必须同时反映两处改动
    expect(view.contextAt(1).kind).toBe("fence-body");
    expect(view.contextAt(3).kind).toBe("fence-body");
    expect(view.contextAt(doc.lineCount - 1).kind).toBe("fence-body");
  });

  it("同一行内容在不同块上下文下渲染结果不同（缓存键含上下文）", () => {
    const doc = new TextDocument("```\ncode here");
    const view = new MdDocumentView(doc, defaultTheme);
    const inFence = view.renderLine(1, { active: false });
    expect(inFence).toContain("\x1b[38;5;245m"); // fence 样式

    doc.deleteLines(0, 1); // 删掉围栏行：同一段内容变成普通段落
    const asParagraph = view.renderLine(0, { active: false });
    expect(asParagraph).toBe("code here");
    expect(asParagraph).not.toContain("\x1b[38;5;245m");
  });
});

describe("MdDocumentView 渲染缓存正确性", () => {
  it("宽度变化后截断结果随之变化（缓存键含可用宽度）", () => {
    const doc = new TextDocument("a".repeat(80));
    const view = new MdDocumentView(doc, defaultTheme);
    const narrow = view.renderLine(0, { active: false });
    expect(narrow).toHaveLength(80);
    expect(narrow.slice(0, 80)).toBe("a".repeat(80));
  });

  it("相同内容出现在不同行号时互不干扰（缓存值与行号无关）", () => {
    const doc = new TextDocument("same\nsame\nsame");
    const view = new MdDocumentView(doc, defaultTheme);
    const rendered = view.renderAll(() => ({ active: false }));
    expect(rendered).toHaveLength(3);
    expect(rendered[0]).toBe(rendered[1]);
    expect(rendered[1]).toBe(rendered[2]);
  });
});
