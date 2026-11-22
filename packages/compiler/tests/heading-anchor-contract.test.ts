/**
 * A-4 / A-5 / A-6：标题锚点的**端到端**契约。
 *
 * 这三个判据此前只有各自半边：`heading-ids.test.ts` 拿硬编码字符串比对外层 HTML，
 * 从不调用 `resolveHeadingAnchor` —— 两侧今天恰好一致，但没有任何东西锁住它。
 * 这里把两边接起来：导出的 `<h2 id>` 必须能被文档内导航解析到同一个标题。
 */
import { describe, expect, it } from "vitest";
import { renderStaticHtml } from "../src/index.ts";
import { resolveHeadingAnchor } from "@md-editor/markdown-fidelity";

function headingIds(html: string): string[] {
  return [...html.matchAll(/<h[1-6][^>]*\sid="([^"]+)"/gu)].map((match) => match[1] as string);
}

function allIds(html: string): string[] {
  return [...html.matchAll(/\sid="([^"]+)"/gu)].map((match) => match[1] as string);
}

/** 多语种语料：C++ / 下划线 / 俄 / 韩 / 日片假名 / 中文 / ASCII。 */
const CORPUS = [
  "## Hello World",
  "## snake_case_to_do",
  "## C++ 与 Rust",
  "## Привет мир",
  "## 안녕하세요 세계",
  "## テスト手順",
  "## カタカナのテスト",
  "## 中文标题测试",
  "## Multiple   Spaces",
  "## Trailing spaces   ",
];

describe("A-4 导出 HTML 的 id ≡ 文档内导航的解析结果", () => {
  it.each(CORPUS)("%s：导出 id 能被 resolveHeadingAnchor 命中同一标题", (markdown) => {
    const { html } = renderStaticHtml(markdown, {});
    const ids = headingIds(html);
    expect(ids).toHaveLength(1);

    const anchor = resolveHeadingAnchor(markdown, `#${ids[0]}`);
    expect(anchor).not.toBeNull();
    // 两侧对同一标题必须给出同一个 id —— 这正是 A-4 要锁住的漂移。
    expect(anchor?.id).toBe(ids[0]);
  });

  it("多标题文档里每个导出 id 都能解析回对应标题", () => {
    const markdown = CORPUS.join("\n\n");
    const { html } = renderStaticHtml(markdown, {});
    const ids = headingIds(html);
    expect(ids.length).toBe(CORPUS.length);

    for (const [index, id] of ids.entries()) {
      const anchor = resolveHeadingAnchor(markdown, `#${id}`);
      expect(anchor, `#${id} 无法解析`).not.toBeNull();
      expect(anchor?.id).toBe(id);
      expect(anchor?.level).toBe(2);
      expect(index).toBeLessThan(ids.length);
    }
  });
});

describe("A-5 片段跳转覆盖非中文/非 ASCII 语种", () => {
  it.each([
    ["C++ 与 Rust", "C++ 与 Rust"],
    ["snake_case_to_do", "snake_case_to_do"],
    ["Привет мир", "Привет мир"],
    ["안녕하세요 세계", "안녕하세요 세계"],
    ["カタカナのテスト", "カタカナのテスト"],
  ])("%s：用导出 id 做片段能命中该标题", (markdown, text) => {
    const { html } = renderStaticHtml(`## ${markdown}`, {});
    const [id] = headingIds(html);
    const anchor = resolveHeadingAnchor(`## ${markdown}`, `#${id}`);
    expect(anchor).not.toBeNull();
    expect(anchor?.text).toBe(text);
  });
});

describe("A-6 legacy 别名仅在与新 id 不同时输出，且不遮蔽新 id", () => {
  it("别名不会与文档内任何标题的真实 id 冲突（曾实测重复 id）", () => {
    const cases = [
      "## テスト手順\n\n## 手順\n",
      "## snake_case_to_do\n\n## snakecasetodo\n",
      "## 中文标题\n\n## 中文标题\n",
      "## Hello World\n\n## Hello-World\n",
    ];
    for (const markdown of cases) {
      const { html } = renderStaticHtml(markdown, {});
      const ids = allIds(html);
      // 重复 id 会让 #fragment 跳到错误标题 —— A-6 明令禁止。
      expect(new Set(ids).size, `重复 id：${ids.join(", ")}`).toBe(ids.length);
    }
  });

  it("别名与自身 id 相同时不输出", () => {
    // 纯 ASCII 无标点的标题：legacy slug 与新 slug 一致，不该多出一个空锚点。
    const { html } = renderStaticHtml("## helloworld\n", {});
    expect(html).not.toContain("heading-anchor-alias");
  });

  it("别名与真实 id 不同且不冲突时才输出，并带 aria-hidden", () => {
    const { html } = renderStaticHtml("## テスト手順\n", {});
    const aliases = [...html.matchAll(/<a id="([^"]+)" class="heading-anchor-alias"/gu)];

    // 该标题的 legacy slug 与新 slug 必然不同（后者保留假名，前者会丢），所以必须恰好一个别名。
    expect(aliases).toHaveLength(1);
    expect(html).toContain('aria-hidden="true"');
    // 别名 id 绝不能同时是标题自身的 id（否则就是重复 id）。
    expect(html).not.toContain(`<h2 id="${aliases[0]?.[1]}"`);
  });
});
