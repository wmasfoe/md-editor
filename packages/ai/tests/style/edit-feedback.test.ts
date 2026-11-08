import { describe, expect, it } from "vitest";
import {
  MAX_EDIT_FEATURES,
  appendEditFeatures,
  collectEditFeatures,
  extractEditFeatures,
  sentenceSimilarity,
  summarizeEditFeatures,
} from "../../src/style/index.ts";
import { observeSamples, withEditFeedback } from "../../src/style/engine-entry.ts";
import { sample } from "./fixtures.ts";

describe("learning from edits to accepted AI text", () => {
  it("U-EF-1: extracts spacing, punctuation, term and length changes", () => {
    expect(
      extractEditFeatures("我们用React写界面,然后打包.", "我们用 React 写界面，然后打包。"),
    ).toEqual(
      expect.arrayContaining([
        { dimension: "cjkLatinSpacing", value: "spaced" },
        { dimension: "cjkPunctuationWidth", value: "fullwidth" },
      ]),
    );
    expect(extractEditFeatures("我们用反应框架写界面。", "我们用 React 写界面。")).toContainEqual({
      dimension: "termScript",
      value: "keep-english",
    });
    expect(
      extractEditFeatures(
        "这是一个非常非常长而且啰嗦的句子，我们需要把它写得更短一些。",
        "这句要写短。",
      ),
    ).toContainEqual({ dimension: "sentenceLength", value: "short" });
  });

  it("U-EF-2: unrelated or unchanged sentences produce no features", () => {
    expect(extractEditFeatures("一样的句子。", "一样的句子。")).toEqual([]);
    expect(sentenceSimilarity("今天天气很好。", "我们讨论编译器。")).toBeLessThan(0.5);
    const markdown = "我们讨论编译器的设计。今天天气很好。";
    expect(collectEditFeatures(["今天天气很好。"], markdown, "t")).toEqual([]);
    expect(collectEditFeatures(["完全无关的一句话。"], markdown, "t")).toEqual([]);
    expect(collectEditFeatures(["我们讨论编译器的设计,"], markdown, "t")).toContainEqual({
      at: "t",
      dimension: "cjkPunctuationWidth",
      value: "fullwidth",
    });
  });

  it("keeps only the most recent features and summarizes by majority", () => {
    const many = Array.from({ length: MAX_EDIT_FEATURES + 5 }, (_, i) => ({
      at: `t${i}`,
      dimension: "cjkLatinSpacing" as const,
      value: "spaced",
    }));
    expect(appendEditFeatures([], many)).toHaveLength(MAX_EDIT_FEATURES);
    expect(
      summarizeEditFeatures(
        [
          { at: "2", dimension: "termScript", value: "keep-english" },
          { at: "3", dimension: "termScript", value: "keep-english" },
          { at: "4", dimension: "cjkLatinSpacing", value: "spaced" },
          { at: "5", dimension: "cjkLatinSpacing", value: "unspaced" },
        ],
        "1",
      ),
    ).toEqual({ termScript: { value: "keep-english", count: 2 } });
  });

  it("U-EF-3: edit features count as extra support for matching or unknown dimensions", () => {
    const observations = observeSamples(
      ["a", "b"].map((id) => sample(id, { stats: { cjkLatinSpacing: { value: 1, weight: 30 } } })),
      1,
    );
    const merged = withEditFeedback(
      observations,
      {
        cjkLatinSpacing: { value: "spaced", count: 3 },
        termScript: { value: "keep-english", count: 2 },
        formality: { value: "casual", count: 1 },
      },
      1,
    );
    expect(merged.cjkLatinSpacing?.supportSampleIds).toHaveLength(5);
    expect(merged.termScript).toMatchObject({ value: "keep-english" });
    expect(merged.termScript?.supportSampleIds).toHaveLength(2);
    // 不冲突的未知维度可由反馈补足；与样本结论冲突时不覆盖。
    const conflicting = withEditFeedback(
      observations,
      { cjkLatinSpacing: { value: "unspaced", count: 9 } },
      1,
    );
    expect(conflicting.cjkLatinSpacing).toEqual(observations.cjkLatinSpacing);
  });
});
