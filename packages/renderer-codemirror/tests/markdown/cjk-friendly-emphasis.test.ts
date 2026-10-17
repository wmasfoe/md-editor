import { parser as markdownParser } from "@lezer/markdown";
import { describe, expect, it } from "vitest";
import {
  resolveCjkFriendlyDelimiterSides,
  type DelimiterMarker,
  type DelimiterNeighbors,
} from "../../src/markdown/cjk-friendly-emphasis.ts";
import { M1_MARKDOWN_EXTENSIONS } from "../../src/markdown/extensions.ts";

const parser = markdownParser.configure(M1_MARKDOWN_EXTENSIONS);

const INLINE_NODES = new Set(["StrongEmphasis", "Emphasis", "Strikethrough"]);

/** 取出源码中所有行内强调 / 删除线节点的原文，便于断言"哪一段被当作语法"。 */
function inlineSpans(source: string): string[] {
  const spans: string[] = [];
  parser.parse(source).iterate({
    enter(node) {
      if (INLINE_NODES.has(node.name)) {
        spans.push(source.slice(node.from, node.to));
      }
    },
  });
  return spans;
}

function codePoints(text: string): (number | null)[] {
  return [...(text || "")].map((char) => char.codePointAt(0) ?? null);
}

function neighbors(before: string, after: string): DelimiterNeighbors {
  const beforePoints = codePoints(before);
  return {
    before: beforePoints.at(-1) ?? null,
    beforePrevious: beforePoints.at(-2) ?? null,
    after: codePoints(after)[0] ?? null,
  };
}

describe("CJK 友好强调解析（CommonMark CJK-friendly amendments）", () => {
  it("把中文标点紧贴的加粗识别为强调节点（本次报告的回归）", () => {
    const source =
      "本文档整理了从**「爆款洗稿（视频/小说逆向拆解）」**到**「角色锁定、分镜生成、视频配音、剪辑成片」**的完整落地路径";

    expect(inlineSpans(source)).toEqual([
      "**「爆款洗稿（视频/小说逆向拆解）」**",
      "**「角色锁定、分镜生成、视频配音、剪辑成片」**",
    ]);
  });

  it("不再把相邻两句的定界符跨对错配成「**到**」", () => {
    // 修复前：第一对 `**` 双双退化为字面文本，`**到**` 反而被识别为加粗。
    expect(inlineSpans("从**「爆款」**到**「角色锁定」**的路径")).toEqual([
      "**「爆款」**",
      "**「角色锁定」**",
    ]);
    expect(inlineSpans("从**「爆款」**到**「角色锁定」**的路径")).not.toContain("**到**");
  });

  it("覆盖句首 / 句末 / 全角括号 / 日文 / 韩文等边界形态", () => {
    expect(inlineSpans("**测试。**测试")).toEqual(["**测试。**"]);
    expect(inlineSpans("测试**（测试）**测试")).toEqual(["**（测试）**"]);
    expect(inlineSpans("前*「フレーズ」*後")).toEqual(["*「フレーズ」*"]);
    expect(inlineSpans("중**「강조」**문")).toEqual(["**「강조」**"]);
    expect(inlineSpans("**注意**。")).toEqual(["**注意**"]);
    expect(inlineSpans("a**「x」**b")).toEqual(["**「x」**"]);
  });

  it("同样修复 GFM 删除线的 CJK 邻接场景", () => {
    expect(inlineSpans("中~~「删除」~~文")).toEqual(["~~「删除」~~"]);
    expect(inlineSpans("~~中断说明。~~后续")).toEqual(["~~中断说明。~~"]);
  });

  it("非 CJK 文本保持 CommonMark 原语义（纯增量兼容）", () => {
    expect(inlineSpans("a**b**c")).toEqual(["**b**"]);
    expect(inlineSpans("snake_case_name")).toEqual([]);
    expect(inlineSpans("_emphasis_")).toEqual(["_emphasis_"]);
    // lezer-markdown 1.8.0 起修正了「部分消耗的定界符 run」：与 cmark 一致地嵌套解析
    expect(inlineSpans("a ****b***c")).toEqual(["***b***", "**b**"]);
  });

  it("`_` 保持 CommonMark 的词内限制：CJK 相邻不额外放宽", () => {
    // 与规范修订一致：`_` 只在「另一侧参与开合」或「另一侧是 Unicode 标点序列」时才允许开合，
    // `字_x_字` 属于词内下划线，仍不解析（与 `a_x_b` 同源）。
    expect(inlineSpans("中_斜体_文")).toEqual([]);
    expect(inlineSpans("中_斜体_")).toEqual([]);
    expect(inlineSpans("_斜体_")).toEqual(["_斜体_"]);
    expect(inlineSpans("中 _斜体_")).toEqual(["_斜体_"]);
  });

  it("代理对（CJK 扩展区 / IVS / emoji）边界按完整码点分类", () => {
    expect(inlineSpans("𠀀**加粗**𠀀")).toEqual(["**加粗**"]);
    expect(inlineSpans("字\u{E0100}**加粗**字")).toEqual(["**加粗**"]);
    expect(inlineSpans("😀**加粗**😀")).toEqual(["**加粗**"]);
    expect(inlineSpans("😀_italic_😀")).toEqual(["_italic_"]);
  });
});

describe("resolveCjkFriendlyDelimiterSides", () => {
  const cases: readonly {
    readonly marker: DelimiterMarker;
    readonly before: string;
    readonly after: string;
    readonly canOpen: boolean;
    readonly canClose: boolean;
  }[] = [
    // CJK 标点视为普通文字：两侧都是汉字 + 全角标点时可开可合
    { marker: "*", before: "从", after: "「", canOpen: true, canClose: true },
    { marker: "*", before: "」", after: "到", canOpen: true, canClose: true },
    // 非 CJK 标点仍按 CommonMark 处理：句首标点后不能开
    { marker: "*", before: "a", after: "(", canOpen: false, canClose: true },
    { marker: "*", before: "", after: "字", canOpen: true, canClose: false },
    { marker: "*", before: "字", after: "", canOpen: false, canClose: true },
    // 空白两侧恒不满足对面侧
    { marker: "*", before: " ", after: " ", canOpen: false, canClose: false },
    // `_` 的词内限制
    { marker: "_", before: "字", after: "x", canOpen: false, canClose: false },
    { marker: "_", before: "(", after: "x", canOpen: true, canClose: false },
    { marker: "_", before: "x", after: ")", canOpen: false, canClose: true },
    // IVS / 变体选择符参与前置序列
    { marker: "*", before: "\u{E0100}", after: "x", canOpen: true, canClose: true },
  ];

  for (const testCase of cases) {
    it(`${testCase.marker} before=${JSON.stringify(testCase.before)} after=${JSON.stringify(
      testCase.after,
    )}`, () => {
      expect(
        resolveCjkFriendlyDelimiterSides(
          testCase.marker,
          neighbors(testCase.before, testCase.after),
        ),
      ).toEqual({ canOpen: testCase.canOpen, canClose: testCase.canClose });
    });
  }
});
