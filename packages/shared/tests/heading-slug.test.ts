import { describe, expect, it } from "vitest";
import {
  EMPTY_HEADING_SLUG,
  createHeadingSlugAllocator,
  headingSlugSource,
  slugifyHeading,
} from "../src/heading-slug.ts";

/**
 * 固定语料（PRD 的 A-1）。这些用例是"锚点四套算法"事故的回归锁：
 * 每一条都曾在旧实现里产出错误 id。
 */
const FIXTURES: readonly (readonly [string, string])[] = [
  ["snake_case_to_do", "snake_case_to_do"],
  ["Привет мир", "привет-мир"],
  ["テスト手順", "テスト手順"],
  ["한국어 문서", "한국어-문서"],
  ["Über uns", "über-uns"],
  ["Hello, World!", "hello-world"],
  ["使用 `npm run dev` 启动 [文档](https://x.dev)", "使用-npm-run-dev-启动-文档"],
  ["**Bold** heading", "bold-heading"],
  ["表格 | 视图", "表格-视图"],
];

describe("slugifyHeading 覆盖旧实现的全部失效语料", () => {
  it.each(FIXTURES)("%s -> %s", (source, expected) => {
    expect(slugifyHeading(source)).toBe(expected);
  });

  it("保留字面下划线（旧 compiler 实现会删掉）", () => {
    expect(slugifyHeading("snake_case")).toBe("snake_case");
    expect(slugifyHeading("user_id 字段")).toBe("user_id-字段");
  });

  it("保留非中英文字种（旧大纲实现会整体丢弃）", () => {
    expect(slugifyHeading("Привет мир")).not.toBe("");
    expect(slugifyHeading("한국어 문서")).not.toBe("");
    expect(slugifyHeading("テスト手順")).not.toBe("");
  });

  it("剥离行内语法与 HTML 标签", () => {
    expect(headingSlugSource("`code` 与 <b>bold</b> 与 ![img](a.png) 与 ~~del~~")).toBe(
      "code 与 bold 与 img 与 del",
    );
  });

  it("去掉首尾连字符", () => {
    expect(slugifyHeading("- already-dashed -")).toBe("already-dashed");
  });
});

describe("createHeadingSlugAllocator 按 GitHub 语义去重", () => {
  it("第一个不加后缀，其后依次 -1、-2（旧实现从 -2 起）", () => {
    const allocate = createHeadingSlugAllocator();
    expect(["B", "B", "B"].map(allocate)).toEqual(["b", "b-1", "b-2"]);
  });

  it("不同标题各自独立计数", () => {
    const allocate = createHeadingSlugAllocator();
    expect(["A", "B", "A", "B"].map(allocate)).toEqual(["a", "b", "a-1", "b-1"]);
  });

  it("空 slug 兜底为 section 并参与去重（不再产生空 id）", () => {
    const allocate = createHeadingSlugAllocator();
    expect(["★", "☆", "✦"].map(allocate)).toEqual([
      EMPTY_HEADING_SLUG,
      `${EMPTY_HEADING_SLUG}-1`,
      `${EMPTY_HEADING_SLUG}-2`,
    ]);
  });

  it('非中英文标题去重后仍唯一（旧实现会得到 "" 与 "-2"）', () => {
    const allocate = createHeadingSlugAllocator();
    const slugs = ["Привет мир", "Привет мир", "한국어 문서"].map(allocate);
    expect(slugs).toEqual(["привет-мир", "привет-мир-1", "한국어-문서"]);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});

/**
 * 最终 ID 必须唯一。
 *
 * 历史缺陷：分配器只按**原始 slug** 计数（`seen.get(base)`），没登记已分配的
 * 最终 ID。于是 `A` / `A` / `A-1` 会产出 `a` / `a-1` / `a-1` —— 第三个标题与
 * 第二个撞车，`#a-1` 永远只能跳到其中一个。
 */
describe("分配器保证最终 ID 唯一", () => {
  // 期望值对齐 GitHub 的权威实现（github-slugger 的 JS 版与 Rust 移植版行为一致）：
  // 后缀始终基于**本次标题自己的 base** 重新从 1 递增，并跳过已占用的候选。
  // 所以 `A`/`A`/`A-1` 是 `a`/`a-1`/`a-1-1`，而不是 `a-2`。
  it("A / A / A-1 → a / a-1 / a-1-1（不得撞车）", () => {
    const allocate = createHeadingSlugAllocator();
    expect(["A", "A", "A-1"].map(allocate)).toEqual(["a", "a-1", "a-1-1"]);
  });

  it("显式带后缀的标题与自动去重后缀不冲突", () => {
    const allocate = createHeadingSlugAllocator();
    // 先占用 a-1（显式），再重复 a 时必须跳过已占用的 a-1。
    expect(["A-1", "A", "A"].map(allocate)).toEqual(["a-1", "a", "a-2"]);
  });

  it("任意输入序列下最终 ID 全文档唯一", () => {
    const allocate = createHeadingSlugAllocator();
    const sources = ["A", "A", "A-1", "A", "A-2", "a", "A"];
    const ids = sources.map(allocate);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("长串连续重复也保持唯一且后缀单调", () => {
    const allocate = createHeadingSlugAllocator();
    const ids = Array.from({ length: 6 }, () => allocate("X"));
    expect(ids).toEqual(["x", "x-1", "x-2", "x-3", "x-4", "x-5"]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("空标题兜底值同样参与去重", () => {
    const allocate = createHeadingSlugAllocator();
    const ids = [allocate(""), allocate(""), allocate("section")];
    expect(new Set(ids).size).toBe(3);
  });
});
