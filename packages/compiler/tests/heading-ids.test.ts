import { describe, expect, it } from "vitest";
import { renderStaticHtml } from "../src/index.ts";

/**
 * 导出 HTML 的标题 id 必须与大纲（`markdown-fidelity.extractHeadingOutline`）
 * 使用同一套 GitHub 语义。本文件锁定 P1 收敛后的行为：
 * 旧实现会删掉字面 `_`（`snake_case` → `snakecase`），导致文档内 `#锚点` 在
 * 导出 HTML 里断链。
 */
function headingIds(markdown: string): string[] {
  const html = renderStaticHtml(markdown).html;
  return [...html.matchAll(/<h[1-6] id="([^"]*)"/gu)].map((match) => match[1]);
}

describe("导出 HTML 的标题 id（GitHub 语义）", () => {
  it("保留下划线：文档内 #snake_case 链接不再断链", () => {
    expect(headingIds("## snake_case_to_do\n")).toEqual(["snake_case_to_do"]);
    expect(headingIds("## user_id 字段\n")).toEqual(["user_id-字段"]);
  });

  it("非中英文标题产出非空且唯一的 id", () => {
    expect(headingIds("## Привет мир\n\n## Привет мир\n\n## 한국어 문서\n")).toEqual([
      "привет-мир",
      "привет-мир-1",
      "한국어-문서",
    ]);
    expect(headingIds("## テスト手順\n## Über uns\n")).toEqual(["テスト手順", "über-uns"]);
  });

  it("重复标题按 GitHub 语义加 -1、-2（第一个不加后缀）", () => {
    expect(headingIds("## B\n\n## B\n\n## B\n")).toEqual(["b", "b-1", "b-2"]);
  });

  it("剥掉行内语法与 HTML 标签后取可见文本", () => {
    expect(headingIds("## 使用 `npm run dev` 启动 [文档](https://x.dev)\n")).toEqual([
      "使用-npm-run-dev-启动-文档",
    ]);
    expect(headingIds("## **Bold** heading\n")).toEqual(["bold-heading"]);
  });
});
