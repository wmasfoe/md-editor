import { describe, expect, it } from "vitest";

import {
  MIN_SAMPLE_PROSE_CHARS,
  extractStyleProse,
  hashStyleText,
  splitStyleSentences,
} from "../../src/style/index.ts";
import { spacedTechArticle } from "./fixtures.ts";

describe("style prose extraction", () => {
  it("U-EX-1: excludes code, quotes, frontmatter, HTML, tables and headings from prose", () => {
    const markdown = [
      "---",
      "title: 私人标题",
      "tags: [diary]",
      "---",
      "",
      "# 标题不进入散文",
      "",
      "正文段落，带 **加粗** 和 `inline 代码` 以及[链接](https://example.com)。",
      "",
      "```ts",
      "const secret = 1;",
      "```",
      "",
      "> 引用的别人的话",
      "",
      "| 表头 | 值 |",
      "| --- | --- |",
      "| 表格 | 内容 |",
      "",
      "<div>HTML 块</div>",
      "",
      "- 列表项一",
      "- 列表项二 *斜体*",
      "",
      "---",
    ].join("\n");

    const prose = extractStyleProse(markdown);
    const all = [...prose.paragraphs, ...prose.listItems].join("\n");

    expect(prose.paragraphs).toEqual(["正文段落，带 加粗 和  以及链接。"]);
    expect(prose.listItems).toEqual(["列表项一", "列表项二 斜体"]);
    expect(prose.headingCount).toBe(1);
    expect(prose.emphasisCount).toBe(2);
    for (const excluded of ["私人标题", "secret", "引用", "表格", "HTML", "inline", "diary"]) {
      expect(all).not.toContain(excluded);
    }
  });

  it("U-EX-2: drops sentences that match accepted AI text and keeps them once edited", () => {
    const aiSentence = "这是 AI 续写的一句话。";
    const markdown = `我自己写的开头。${aiSentence}我自己写的结尾。`;
    const aiSentenceHashes = new Set([hashStyleText(aiSentence)]);

    expect(extractStyleProse(markdown, { aiSentenceHashes }).sentences).toEqual([
      "我自己写的开头。",
      "我自己写的结尾。",
    ]);

    // 用户改了一个字之后算作原创。
    const edited = markdown.replace("续写", "生成");
    expect(extractStyleProse(edited, { aiSentenceHashes }).sentences).toContain(
      "这是 AI 生成的一句话。",
    );
  });

  it("U-EX-3: files with too little prose are not eligible samples", () => {
    expect(extractStyleProse("# 只有标题\n\n短短一句。").eligible).toBe(false);
    const article = spacedTechArticle("Markdown");
    const prose = extractStyleProse(article);
    expect(prose.proseChars).toBeGreaterThanOrEqual(MIN_SAMPLE_PROSE_CHARS);
    expect(prose.eligible).toBe(true);
    expect(prose.paragraphHashes).toHaveLength(4);
  });

  it("splits Chinese and English sentences", () => {
    expect(splitStyleSentences("今天下雨了。我们去 TypeScript 公园吧！Ok. Next?")).toEqual([
      "今天下雨了。",
      "我们去 TypeScript 公园吧！",
      "Ok.",
      "Next?",
    ]);
  });

  it("hashes are stable under whitespace changes and versioned", () => {
    expect(hashStyleText("一段  文字\n")).toBe(hashStyleText(" 一段 文字"));
    expect(hashStyleText("一段文字")).not.toBe(hashStyleText("一段文字。"));
    expect(hashStyleText("x")).toMatch(/^n1:[0-9a-f]+$/u);
  });
});
