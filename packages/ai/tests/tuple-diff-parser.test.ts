import { describe, expect, it } from "vitest";
import {
  applyTupleDiffs,
  codePointOffsetToUtf16Offset,
  locateCloudEditSuggestion,
  parseTupleDiffOutput,
  resolveTripleDefenseDiffs,
} from "../src/tuple-diff-parser.ts";

describe("tuple-diff-parser: Unicode 坐标与 Diff 解析", () => {
  it("正确转换包含 Emoji 的 Unicode Code Point 偏移量到 UTF-16", () => {
    // '🚀' 在 UTF-16 中 length 为 2，但算 1 个 Code Point
    const text = "Hi 🚀 world";
    // 0: 'H', 1: 'i', 2: ' ', 3: '🚀', 4: ' ', 5: 'w'
    expect(codePointOffsetToUtf16Offset(text, 0)).toBe(0);
    expect(codePointOffsetToUtf16Offset(text, 3)).toBe(3); // 到 🚀 前
    expect(codePointOffsetToUtf16Offset(text, 4)).toBe(5); // 过了 🚀 之后 (3 + 2 = 5)
    expect(codePointOffsetToUtf16Offset(text, 5)).toBe(6);
  });

  it("支持解析标准单处修改与多处修改的元组 JSON", () => {
    const outputSingle = '[[7, 9, "但是", "所以"]]';
    expect(parseTupleDiffOutput(outputSingle)).toEqual([[7, 9, "但是", "所以"]]);

    const outputMulti = '[[0, 2, "今晚", "今天"], [7, 9, "但是", "所以"]]';
    expect(parseTupleDiffOutput(outputMulti)).toEqual([
      [0, 2, "今晚", "今天"],
      [7, 9, "但是", "所以"],
    ]);
  });

  it("支持解析纯删除、纯插入和空修改", () => {
    const delOutput = '[[8, 9, "多余", ""]]';
    expect(parseTupleDiffOutput(delOutput)).toEqual([[8, 9, "多余", ""]]);

    const insOutput = '[[8, 8, "", "插入"]]';
    expect(parseTupleDiffOutput(insOutput)).toEqual([[8, 8, "", "插入"]]);

    expect(parseTupleDiffOutput("[]")).toEqual([]);
    expect(parseTupleDiffOutput("<|endoftext|>")).toEqual([]);
    expect(parseTupleDiffOutput("")).toEqual([]);
  });

  it("自动过滤 original === replacement 的无变动修改项", () => {
    const raw = '[[1, 2, "否", "否"], [7, 8, "呢", "吗"]]';
    const parsed = parseTupleDiffOutput(raw);
    expect(parsed).toEqual([[7, 8, "呢", "吗"]]);

    const text = "是否正确呢？";
    const validated = resolveTripleDefenseDiffs(text, [
      [1, 2, "否", "否"],
      [4, 5, "呢", "吗"],
    ]);
    expect(validated).toHaveLength(1);
    expect(validated[0].original).toBe("呢");
    expect(validated[0].replacement).toBe("吗");
  });

  it("兼容 Markdown 代码围栏与非标准包装", () => {
    const wrapped = '```json\n[[1, 2, "a", "b"]]\n```';
    expect(parseTupleDiffOutput(wrapped)).toEqual([[1, 2, "a", "b"]]);
  });

  it("三重防御定位：强一致匹配时直接命中", () => {
    const text = "今天天气很好，但是我想出去玩。";
    const diffs = parseTupleDiffOutput('[[7, 9, "但是", "所以"]]');
    const validated = resolveTripleDefenseDiffs(text, diffs);

    expect(validated).toHaveLength(1);
    expect(validated[0]).toMatchObject({
      start: 7,
      end: 9,
      utf16From: 7,
      utf16To: 9,
      original: "但是",
      replacement: "所以",
      wasAdjusted: false,
    });
  });

  it("三重防御定位：偏移 1~2 个字符时通过 Fuzzy Anchor 纠偏", () => {
    const text = "今天天气很好，但是我想出去玩。";
    // 假设模型数错了 offset，把 [7, 9] 数成了 [8, 10]
    const flawedDiffs = [[8, 10, "但是", "所以"]] as const;
    const validated = resolveTripleDefenseDiffs(text, flawedDiffs, 5);

    expect(validated).toHaveLength(1);
    expect(validated[0].utf16From).toBe(7);
    expect(validated[0].utf16To).toBe(9);
    expect(validated[0].wasAdjusted).toBe(true);
  });

  it("三重防御定位：完全找不到原文时静默丢弃", () => {
    const text = "今天天气很好，我想出去玩。"; // 原文中没有"但是"
    const diffs = [[7, 9, "但是", "所以"]] as const;
    const validated = resolveTripleDefenseDiffs(text, diffs, 5);

    expect(validated).toHaveLength(0); // 安全静默丢弃
  });

  it("倒序应用：多处修改从后向前替换，防止下标漂移", () => {
    const text = "今晚天气很好，但是我想出去玩。";
    // 0:2 "今晚" -> "今天" (长度相同)
    // 7:9 "但是" -> "所以非常特别" (长度变长)
    const diffs = parseTupleDiffOutput('[[0, 2, "今晚", "今天"], [7, 9, "但是", "所以非常特别"]]');
    const validated = resolveTripleDefenseDiffs(text, diffs);

    const result = applyTupleDiffs(text, validated);
    expect(result).toBe("今天天气很好，所以非常特别我想出去玩。");
  });
});

describe("tuple-diff-parser: 云端大模型自适应定位器 (Adaptive Locator)", () => {
  it("第 1 优先级：云端模型提供了有效坐标时直接命中", () => {
    const text = "今天天气很好，但是我想出去玩。";
    const edit = {
      original: "但是",
      replacement: "所以",
      start: 7,
      end: 9,
      reason: "转折改因果",
    };
    const located = locateCloudEditSuggestion(text, edit);
    expect(located).not.toBeNull();
    expect(located?.utf16From).toBe(7);
    expect(located?.utf16To).toBe(9);
    expect(located?.wasAdjusted).toBe(false);
  });

  it("第 2 优先级：无坐标时通过唯一子串命中", () => {
    const text = "今天天气很好，但是我想出去玩。";
    const edit = {
      original: "但是",
      replacement: "所以",
    };
    const located = locateCloudEditSuggestion(text, edit);
    expect(located).not.toBeNull();
    expect(located?.utf16From).toBe(7);
    expect(located?.utf16To).toBe(9);
  });

  it("第 3 优先级：同词重复时结合近似坐标命中最近邻", () => {
    // 句子中有两个"但是"：index 2 和 index 12
    const text = "虽然但是我不懂，但是我想去。";
    const edit = {
      original: "但是",
      replacement: "所以",
      start: 11, // 近似第 2 个 (真实是 8:10，实际为 index 8)
    };
    const located = locateCloudEditSuggestion(text, edit);
    expect(located).not.toBeNull();
    expect(located?.utf16From).toBe(8);
    expect(located?.original).toBe("但是");
  });
});
