/**
 * 大纲与导出必须给同一批标题分配同一批 ID。
 *
 * 分歧根因：`extractHeadingOutline` 用逐行正则 `/^#{1,6}\s+/` 找标题，**完全不过滤
 * 代码围栏**；而导出走 Markdown token，围栏里的 `# xxx` 根本不是标题。
 *
 * 于是围栏里写 `# 安装`、围栏外又有真正的 `## 安装` 时，大纲会先给围栏里那行
 * 分配 `安装`，真正的标题就变成 `安装-1` —— 大纲里的链接指向导出 HTML 里
 * 不存在（或指向别处）的 id。
 */
import { describe, expect, it } from "vitest";

import { extractHeadingOutline } from "../src/index.ts";

describe("大纲跳过代码围栏", () => {
  it("围栏内的 # 行不算标题", () => {
    const outline = extractHeadingOutline("```\n# 安装\n```\n\n## 安装\n");
    expect(outline.map((item) => item.text)).toEqual(["安装"]);
    // 唯一真正的标题拿到不带后缀的 id。
    expect(outline.map((item) => item.id)).toEqual(["安装"]);
  });

  it("波浪号围栏同样生效", () => {
    const outline = extractHeadingOutline("~~~\n# 假的\n~~~\n\n## 真的\n");
    expect(outline.map((item) => item.text)).toEqual(["真的"]);
  });

  it("围栏内的重复标题不影响围栏外标题的后缀", () => {
    const outline = extractHeadingOutline("```\n# A\n# A\n```\n\n## A\n");
    expect(outline.map((item) => item.id)).toEqual(["a"]);
  });

  it("未闭合的围栏吞掉后续内容（与 CommonMark 一致）", () => {
    const outline = extractHeadingOutline("```\n# 围栏内\n## 仍在围栏内\n");
    expect(outline).toEqual([]);
  });

  it("围栏关闭后的标题正常计入", () => {
    const outline = extractHeadingOutline("```\n# 内\n```\n\n## 外\n");
    expect(outline.map((item) => item.text)).toEqual(["外"]);
  });

  it("行号仍指向原文真实行（围栏不影响行号计算）", () => {
    const outline = extractHeadingOutline("```\n# 内\n```\n\n## 外\n");
    // "## 外" 在第 5 行（1-based）。
    expect(outline[0]?.line).toBe(5);
  });
});

/**
 * 列表内围栏不得吞掉后续标题。
 *
 * 根因：`matchOpeningCodeFence` 允许 0–3 空格缩进，列表项里的收尾围栏（`  ``` `）
 * 因此被当成**新的开启围栏**，而它永远等不到同缩进的闭合行，于是把文档剩余部分
 * 全部当作围栏内容 —— 大纲里围栏之后的所有标题凭空消失（实测 `- ``` … ` 之后的
 * `## after` 完全不出现）。
 *
 * 修复：闭合围栏的缩进必须与开启围栏一致（CommonMark 的列表内围栏语义），
 * 这样"缩进对不上"的收尾行不会另起一个新围栏。
 */
describe("列表内围栏不吞掉后续标题", () => {
  it("列表项开头的围栏不会吞掉之后的标题", () => {
    const outline = extractHeadingOutline("- ```\n  # 列表内\n  ```\n\n## 之后\n");
    // 列表内围栏内容不该出现在大纲里，但"之后"必须出现。
    expect(outline.map((item) => item.text)).toEqual(["之后"]);
  });

  it("缩进围栏正常闭合后标题仍在", () => {
    const outline = extractHeadingOutline("- item\n\n  ```\n  # 围栏内\n  ```\n\n## 之后\n");
    expect(outline.map((item) => item.text)).toEqual(["之后"]);
  });

  it("顶层围栏行为不变", () => {
    const outline = extractHeadingOutline("```\n# 围栏内\n```\n\n## 之后\n");
    expect(outline.map((item) => item.text)).toEqual(["之后"]);
  });
});
