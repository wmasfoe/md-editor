import { describe, expect, it } from "vitest";
import { compileToTokens, renderStaticHtml } from "../src/index.ts";

/** 收集静态 Token 树里的行内强调节点，返回 `类型(原文)`。 */
function inlineMarks(markdown: string): string[] {
  const marks: string[] = [];
  const walk = (tokens: readonly { type: string; raw: string; tokens?: unknown }[] | undefined) => {
    for (const token of tokens ?? []) {
      if (["bold", "italic", "strikethrough", "highlight"].includes(token.type)) {
        marks.push(`${token.type}(${token.raw})`);
      }
      if (Array.isArray(token.tokens)) {
        walk(token.tokens as { type: string; raw: string; tokens?: unknown }[]);
      }
    }
  };
  walk(compileToTokens(markdown).tokens);
  return marks;
}

function boldTexts(markdown: string): string[] {
  return inlineMarks(markdown)
    .filter((mark) => mark.startsWith("bold("))
    .map((mark) => mark.slice("bold(".length, -1));
}

describe("静态渲染器的 CJK 友好强调解析", () => {
  it("中文标点紧贴的加粗不再退化成字面文本（本次报告的回归）", () => {
    const markdown =
      "本文档整理了从**「爆款洗稿（视频/小说逆向拆解）」**到**「角色锁定、分镜生成、视频配音、剪辑成片」**的完整落地路径";

    expect(boldTexts(markdown)).toEqual([
      "**「爆款洗稿（视频/小说逆向拆解）」**",
      "**「角色锁定、分镜生成、视频配音、剪辑成片」**",
    ]);
  });

  it("不产生「**到**」这类跨对错配的加粗", () => {
    const markdown = "从**「爆款」**到**「角色锁定」**的路径";

    expect(boldTexts(markdown)).toEqual(["**「爆款」**", "**「角色锁定」**"]);
    expect(boldTexts(markdown)).not.toContain("**到**");
    expect(renderStaticHtml(markdown).html).not.toContain(
      '<strong class="cm-md-inline cm-md-bold">到</strong>',
    );
  });

  it("渲染出的 HTML 与编辑器同一套标记/内容类名契约", () => {
    const { html } = renderStaticHtml("从**「爆款」**到");

    expect(html).toContain('<span class="cm-md-marker cm-md-marker--bold">**</span>');
    expect(html).toContain('<strong class="cm-md-inline cm-md-bold">「爆款」</strong>');
    // 开标记前的正文与闭标记之后的正文保持原样（不会因解析失败而多出可见空格）
    expect(html).toContain("<p>从<span");
    expect(html).toContain('<span class="cm-md-marker cm-md-marker--bold">**</span>到</p>');
  });

  it("覆盖句首 / 句末 / 全角括号 / 日文 / 韩文等边界形态", () => {
    expect(boldTexts("**测试。**测试")).toEqual(["**测试。**"]);
    expect(boldTexts("测试**（测试）**测试")).toEqual(["**（测试）**"]);
    expect(inlineMarks("前*「フレーズ」*後")).toEqual(["italic(*「フレーズ」*)"]);
    expect(boldTexts("중**「강조」**문")).toEqual(["**「강조」**"]);
    expect(boldTexts("**注意**。")).toEqual(["**注意**"]);
  });

  it("同样修复 GFM 删除线的 CJK 邻接场景", () => {
    expect(inlineMarks("中~~「删除」~~文")).toEqual(["strikethrough(~~「删除」~~)"]);
  });

  it("非 CJK 文本保持 CommonMark 原语义（纯增量兼容）", () => {
    expect(boldTexts("a**b**c")).toEqual(["**b**"]);
    expect(inlineMarks("snake_case_name")).toEqual([]);
    expect(inlineMarks("_emphasis_")).toEqual(["italic(_emphasis_)"]);
  });

  it("`_` 保留 CommonMark 词内限制，与编辑器语法树口径一致", () => {
    // marked-cjk-friendly 默认会把 `_` 也放宽（`这是 _斜体_文字` 会解析成斜体），
    // 这里刻意把 `_` 交回 marked 默认实现，避免静态渲染器与 WYSIWYG 编辑器不一致。
    expect(inlineMarks("中_斜体_文")).toEqual([]);
    expect(inlineMarks("这是 _斜体_文字")).toEqual([]);
    expect(inlineMarks("中 _斜体_")).toEqual(["italic(_斜体_)"]);
  });
  it("行内强调 / 删除线 / 斜体共用同一套 CJK 友好判定", () => {
    expect(inlineMarks("**粗体**、*斜体*、~~删除~~")).toEqual([
      "bold(**粗体**)",
      "italic(*斜体*)",
      "strikethrough(~~删除~~)",
    ]);
  });
});
