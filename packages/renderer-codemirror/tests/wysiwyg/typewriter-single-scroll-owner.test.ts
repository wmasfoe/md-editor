import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * 结构护栏（审计指出的缺口）：**单滚动所有权**。
 *
 * 验收要求「遵守单滚动所有权」（一个 EditorView / 一个 scroller，禁止第二个滚动容器）。
 * 此前只有行为级验证（E29/E30 在 `.cm-scroller` 上观察），**无结构级断言** ——
 * 本测试从源码锁定：打字机模块**只写 CM 自己的 `scrollDOM.scrollTop`**，
 * 不得创建/插入任何 DOM 容器，也不得使用其它滚动 API（`scrollTo/scrollBy/window.scroll`）。
 */
const SOURCE = readFileSync(
  fileURLToPath(new URL("../../src/wysiwyg/typewriter-mode.ts", import.meta.url)),
  "utf-8",
);

describe("打字机模式：单滚动所有权（结构级护栏）", () => {
  it("只写 scrollDOM.scrollTop；不创建/插入 DOM 容器；不用其它滚动 API", () => {
    expect(SOURCE, "不得创建 DOM 元素（第二滚动容器的唯一来源）").not.toMatch(
      /createElement\(|innerHTML\s*=/,
    );
    expect(SOURCE, "不得插入 DOM").not.toMatch(/appendChild|insertBefore|append\(/);
    expect(SOURCE, "不得使用其它滚动 API").not.toMatch(
      /window\.scroll|\.scrollTo\(|\.scrollBy\(|document\.scrollingElement/,
    );
    const writes = SOURCE.match(/scrollDOM\.scrollTop\s*=/g) ?? [];
    expect(writes.length, "滚动写入必须且只能落在 CM 自己的 scrollDOM.scrollTop").toBeGreaterThan(
      0,
    );
  });
});
