/**
 * 大纲与导出必须给**同一批标题**分配**同一批 ID**。
 *
 * 缺陷（PR #295 复审指出）：导出按文档顺序给所有标题（含列表项/引用块里的）
 * 分配 ID，大纲却只给顶层标题分配。嵌套标题出现在前面时，顶层条目的 ID 就整体错位。
 *
 * 实测（`- # A` / `# A` / `# A`，第 1/3/5 行）：
 *
 * | | 导出 | 大纲 |
 * | --- | --- | --- |
 * | 修复前 | `a`、`a-1`、`a-2` | `a`(行 3)、`a-1`(行 5) |
 *
 * 于是 `#a-1` 跳到第 5 行、`#a-2` 完全解析不到。
 *
 * 修复后大纲仍只**展示**顶层标题，但 ID 按文档顺序为所有标题分配，
 * 因此顶层条目的 ID 已计入前面嵌套标题占用的名字。
 */
import { describe, expect, it } from "vitest";
import { extractHeadingOutline, resolveHeadingAnchor } from "@md-editor/markdown-fidelity";

import { renderStaticHtml } from "../src/index.ts";

/** 导出 HTML 中的标题 id（按文档顺序）。 */
function exportHeadingIds(markdown: string): string[] {
  return [...renderStaticHtml(markdown).html.matchAll(/<h[1-6][^>]*\sid="([^"]+)"/gu)].map(
    (match) => match[1] as string,
  );
}

/**
 * 独立 oracle：直接从 compiler 的 token 树读出所有标题 id 及其层级。
 *
 * 刻意不复用 `markdown-fidelity` 的行扫描 —— 那样两边错在同一个假设上就测不出来。
 * 这里用的是**导出侧**自己的事实来源（token 树），正好是"大纲该对齐的那一方"。
 */
function headingTree(markdown: string): { id: string; topLevel: boolean }[] {
  const { tokens } = renderStaticHtml(markdown);
  const collected: { id: string; topLevel: boolean }[] = [];
  const walk = (nodes: readonly unknown[], topLevel: boolean): void => {
    for (const node of nodes) {
      if (!node || typeof node !== "object") continue;
      const token = node as Record<string, unknown>;
      if (token.type === "heading" && typeof token.id === "string" && token.id.length > 0) {
        collected.push({ id: token.id, topLevel });
      }
      for (const value of Object.values(token)) {
        if (Array.isArray(value)) walk(value, false);
      }
    }
  };
  walk(tokens, true);
  return collected;
}

/** 语料：嵌套标题出现在前 / 中 / 后，以及多层容器。 */
const CORPUS = [
  "- # A\n\n# A\n\n# A\n",
  "> # A\n\n# A\n",
  "# A\n\n- # A\n\n# A\n",
  "# A\n\n# A\n",
  "> - # A\n\n# A\n",
  "- item\n  - # A\n\n# A\n",
  "# テスト手順\n\n- # 手順\n\n# 手順\n",
  "> [!NOTE]\n> # A\n\n# A\n",
  "- # A\n\n- # A\n\n# A\n",
  "# A\n\n## A\n\n- # A\n\n## A\n",
];

describe("大纲 ID 与导出 ID 对齐（含嵌套标题）", () => {
  it.each(CORPUS)("每个大纲条目的 id 都是导出里真实存在的 id：%j", (markdown) => {
    const exported = new Set(exportHeadingIds(markdown));
    for (const item of extractHeadingOutline(markdown)) {
      expect(exported.has(item.id)).toBe(true);
    }
  });

  it.each(CORPUS)("每个大纲条目都能用导出 id 解析回自己的源码行：%j", (markdown) => {
    for (const item of extractHeadingOutline(markdown)) {
      expect(resolveHeadingAnchor(markdown, `#${item.id}`)?.line).toBe(item.line);
    }
  });

  /**
   * 更强的一条：大纲的 id 序列必须等于「导出侧 token 树里的**顶层**标题 id 序列」。
   *
   * 上一条只在大纲内部自比（大纲 → 解析 → 对回大纲），彼此自洽时测不出错位：
   * 修复前 `- # A` / `# A` / `# A` 的大纲是 `a`(行 3)、`a-1`(行 5)，
   * 解析回自己也对得上，但两者都不是该行标题的真实 id。
   */
  it.each(CORPUS)("大纲 id 序列等于导出侧顶层标题 id 序列：%j", (markdown) => {
    const expected = headingTree(markdown)
      .filter((heading) => heading.topLevel)
      .map((heading) => heading.id);
    expect(extractHeadingOutline(markdown).map((item) => item.id)).toEqual(expected);
  });

  it.each(CORPUS)("导出 HTML 的 id 序列等于 token 树里的全部标题 id 序列：%j", (markdown) => {
    expect(exportHeadingIds(markdown)).toEqual(headingTree(markdown).map((heading) => heading.id));
  });

  it.each(CORPUS)("每个顶层标题的导出 id 都能解析回它自己的源码行：%j", (markdown) => {
    const topLevel = headingTree(markdown).filter((heading) => heading.topLevel);
    for (const heading of topLevel) {
      expect(resolveHeadingAnchor(markdown, `#${heading.id}`)).not.toBeNull();
    }
  });

  it("嵌套标题在前时，顶层条目的 ID 计入它占用的名字", () => {
    const markdown = "- # A\n\n# A\n\n# A\n";
    // 导出按文档顺序：第 1 行 a、第 3 行 a-1、第 5 行 a-2。
    expect(exportHeadingIds(markdown)).toEqual(["a", "a-1", "a-2"]);
    // 大纲只展示顶层（第 3、5 行），但 ID 已对齐。
    expect(
      extractHeadingOutline(markdown).map((item) => ({ id: item.id, line: item.line })),
    ).toEqual([
      { id: "a-1", line: 3 },
      { id: "a-2", line: 5 },
    ]);
  });

  it("嵌套标题仍然不进大纲", () => {
    const markdown = "# A\n\n- # InList\n\n> # InQuote\n";
    expect(extractHeadingOutline(markdown).map((item) => item.text)).toEqual(["A"]);
  });
});
