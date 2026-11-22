/**
 * 嵌套标题必须参与**文档级** ID 分配与别名冲突判定。
 *
 * 两条缺陷（PR #292 复审指出，均已在旧实现上实测复现）：
 *
 * 1. **列表递归新建分配器**：`convertListItemTokens` 调 `convertBlockTokens([t])`
 *    时没传文档分配器，默认参数会新建一个。于是 `# A` + `- # A` 产出两个
 *    `id="a"`（互相不知道对方存在）。
 * 2. **别名只收集顶层真实 id**：`realHeadingIds` 只遍历顶层 token，
 *    嵌套标题的 id 不在集合里。于是 `# テスト手順`（legacy 别名 `手順`）
 *    + `> # 手順`（嵌套标题真实 id `手順`）产出两个 `id="手順"`。
 *
 * 修复后还要求"导出的片段能解析回正确源码行"——ID 唯一只是必要条件，
 * 链接真的跳到那个标题才算对。
 */
import { describe, expect, it } from "vitest";

import { renderStaticHtml } from "../src/index.ts";

const headingIds = (html: string): string[] =>
  [...html.matchAll(/<h[1-6][^>]*\sid="([^"]+)"/gu)].map((match) => match[1] as string);

const allIds = (html: string): string[] =>
  [...html.matchAll(/\sid="([^"]+)"/gu)].map((match) => match[1] as string);

function duplicates(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) dupes.add(id);
    seen.add(id);
  }
  return [...dupes];
}

const render = (markdown: string) => renderStaticHtml(markdown).html;

describe("列表项内的标题共享文档级分配器", () => {
  it('# A + - # A：不得产出两个 id="a"', () => {
    const html = render("# A\n\n- # A\n");
    expect(duplicates(allIds(html))).toEqual([]);
    expect(headingIds(html)).toEqual(["a", "a-1"]);
  });

  it("深层嵌套列表同样共享", () => {
    const html = render("# A\n\n- item\n  - nested\n    - # A\n");
    expect(duplicates(allIds(html))).toEqual([]);
    expect(headingIds(html)).toEqual(["a", "a-1"]);
  });

  it("列表项标题与顶层标题的顺序决定后缀（文档顺序）", () => {
    const html = render("- # A\n\n# A\n");
    expect(headingIds(html)).toEqual(["a", "a-1"]);
  });
});

describe("引用块内的标题参与别名冲突判定", () => {
  it("# テスト手順 + > # 手順：别名不得与嵌套标题真实 id 撞车", () => {
    const html = render("# テスト手順\n\n> # 手順\n");
    expect(duplicates(allIds(html))).toEqual([]);
    // 嵌套标题保留自己的真实 id。
    expect(headingIds(html)).toContain("手順");
    expect(headingIds(html)).toContain("テスト手順");
  });

  it("callout 内的标题同样算进真实 id 集合", () => {
    const html = render("# テスト手順\n\n> [!NOTE]\n> # 手順\n");
    expect(duplicates(allIds(html))).toEqual([]);
  });

  it("嵌套标题之间同名也去重", () => {
    const html = render("> # X\n\n> # X\n");
    expect(duplicates(allIds(html))).toEqual([]);
    expect(headingIds(html)).toEqual(["x", "x-1"]);
  });
});

/**
 * 大纲/锚点解析只收**顶层**标题，嵌套标题仅参与 ID 唯一性。
 *
 * 这是刻意保留的规则，不是遗漏：
 * - 导出必须保证**任何** `<hN id>` 在文档内唯一，否则 `#fragment` 会跳到错的位置；
 * - 大纲是导航目录，收录列表项/引用块里的标题会让 TOC 混入噪声
 *   （callout 正文里的标题尤其明显）。
 *
 * 因此这里显式断言规则本身，而不是假装嵌套标题也能 round-trip。
 */
describe("大纲规则：只收顶层标题，嵌套标题仅参与 ID 唯一性", () => {
  it("顶层标题的 id 能解析回正确源码行", async () => {
    const { resolveHeadingAnchor: resolve } = await import("@md-editor/markdown-fidelity");
    const markdown = "# A\n\n## B\n\n- # C\n";
    expect(resolve(markdown, "#a")?.line).toBe(1);
    expect(resolve(markdown, "#b")?.line).toBe(3);
  });

  it("列表项/引用块内的标题不进大纲（因此也无法被锚点解析到）", async () => {
    const { extractHeadingOutline, resolveHeadingAnchor: resolve } =
      await import("@md-editor/markdown-fidelity");
    const markdown = "# A\n\n- # InList\n\n> # InQuote\n";
    expect(extractHeadingOutline(markdown).map((item) => item.text)).toEqual(["A"]);
    expect(resolve(markdown, "#inlist")).toBeNull();
    expect(resolve(markdown, "#inquote")).toBeNull();
  });

  it("嵌套标题的导出 id 仍然全文档唯一（跳转目标无歧义）", () => {
    const markdown = "# A\n\n- # A\n\n> # A\n\n## A\n";
    const html = render(markdown);
    expect(duplicates(allIds(html))).toEqual([]);
  });
});
