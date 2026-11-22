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
