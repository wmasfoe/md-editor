/**
 * A-6 的补丁：**别名之间**也不得互相冲突。
 *
 * A-6 只处理了「别名 vs 真实 id」：`## テスト手順` + `## 手順` 曾各输出一个
 * `id="手順"`。但两个不同标题的 legacy 别名可以互相撞车：
 *
 *   ## テスト手順   → 真实 id="テスト手順"，legacy 别名 id="手順"
 *   ## ガイド手順   → 真实 id="ガイド手順"，legacy 别名 id="手順"
 *
 * 两个别名同名，`#手順` 只能跳到第一个，第二个链接永久失效。别名只是给旧链接
 * 兜底的 `<a id>`，因此**每个别名在全文档内只应输出一次**。
 */
import { describe, expect, it } from "vitest";

import { renderStaticHtml } from "../src/index.ts";

function htmlOf(markdown: string): string {
  return renderStaticHtml(markdown).html;
}

function allIds(html: string): string[] {
  return [...html.matchAll(/\sid="([^"]+)"/gu)].map((match) => match[1] as string);
}

function duplicates(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) dupes.add(id);
    seen.add(id);
  }
  return [...dupes];
}

describe("legacy 别名不得互相冲突", () => {
  it("テスト手順 + ガイド手順：全文档无重复 id", () => {
    const ids = allIds(htmlOf("## テスト手順\n\n## ガイド手順\n"));
    expect(duplicates(ids)).toEqual([]);
    // 两个标题的真实 id 都必须保留。
    expect(ids).toContain("テスト手順");
    expect(ids).toContain("ガイド手順");
  });

  it("三个同尾标题：只输出一次别名，真实 id 全部保留", () => {
    const ids = allIds(htmlOf("## テスト手順\n\n## ガイド手順\n\n## 補足手順\n"));
    expect(duplicates(ids)).toEqual([]);
    expect(ids).toContain("テスト手順");
    expect(ids).toContain("ガイド手順");
    expect(ids).toContain("補足手順");
  });

  it("别名与另一个标题的真实 id 同名时，别名让位（A-6 原契约不回退）", () => {
    // 旧链接 #手順 指向第二个标题：别名让位给真实 id。
    const ids = allIds(htmlOf("## テスト手順\n\n## 手順\n"));
    expect(duplicates(ids)).toEqual([]);
  });

  it("同名标题的 legacy 别名也不重复输出", () => {
    const ids = allIds(htmlOf("## 手順\n\n## テスト手順\n\n## ガイド手順\n"));
    expect(duplicates(ids)).toEqual([]);
  });

  it("没有任何别名冲突时行为不变（不误删可用别名）", () => {
    const html = htmlOf("## テスト手順\n");
    // 单个标题：真实 id + 一个 legacy 别名，两者不同名。
    const ids = allIds(html);
    expect(duplicates(ids)).toEqual([]);
    expect(ids).toContain("テスト手順");
    expect(html).toContain('class="heading-anchor-alias"');
  });
});

/**
 * 大纲（markdown-fidelity）与导出（compiler）必须给同一批标题分配同一批 ID。
 *
 * 两者的标题发现机制不同：导出走 Markdown token，大纲走逐行扫描。围栏识别
 * 曾经只在导出侧存在，于是围栏里的假标题会让大纲提前占掉 id。
 */
describe("大纲与导出 ID 一致", () => {
  it("围栏 + 重复标题混合文档：大纲 id 全部出现在导出 HTML 中", async () => {
    const { extractHeadingOutline } = await import("@md-editor/markdown-fidelity");
    const markdown = "```\n# 安装\n```\n\n## 安装\n\n```js\n// # 安装\n```\n\n## 安装\n";

    const outlineIds = extractHeadingOutline(markdown).map((item) => item.id);
    const htmlIds = new Set(allIds(htmlOf(markdown)));

    expect(outlineIds.length).toBeGreaterThan(0);
    for (const id of outlineIds) {
      expect(htmlIds.has(id)).toBe(true);
    }
  });

  it("围栏内的标题既不出现在大纲里，也不出现在导出里", () => {
    const markdown = "```\n## 围栏内\n```\n\n## 围栏外\n";
    const html = htmlOf(markdown);
    expect(allIds(html)).toEqual(["围栏外"]);
  });
});
