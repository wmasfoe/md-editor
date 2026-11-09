import { describe, expect, it } from "vitest";
import {
  MAX_EDIT_FEATURES,
  appendEditFeatures,
  collectEditFeatures,
  extractEditFeatures,
  sentenceSimilarity,
  summarizeEditFeatures,
  advanceStyleRule,
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

describe("edit feedback preserves measured evidence", () => {
  it("keeps the measured aggregate and per-value support when the round is unknown", () => {
    // 句长证据不足（weight < 50）→ 本轮取值 unknown，但聚合值已经测到 10（short）。
    const observations = observeSamples(
      ["a", "b"].map((id) => sample(id, { stats: { sentenceLength: { value: 10, weight: 20 } } })),
      1,
    );
    expect(observations.sentenceLength?.value).toBe("unknown");
    const withFeedback = withEditFeedback(
      observations,
      { sentenceLength: { value: "short", count: 6 } },
      1,
    );
    const round = withFeedback.sentenceLength!;
    expect(round.value).toBe("short");
    // 聚合值不能被反馈覆盖丢失，否则已生效规则会被误判为“无证据”而退场。
    expect(round.aggregate).toBe(10);
    // 2 个真实样本 + 6 条编辑反馈：测量证据与反馈证据都要保留。
    expect(round.valueSupport?.short).toHaveLength(8);
    expect(round.valueSupport?.short?.filter((id) => id.startsWith("edit:"))).toHaveLength(6);

    const active = advanceStyleRule("sentenceLength", undefined, round);
    expect(active.status).toBe("draft");
    // 只有 2 个真实文件：编辑反馈不能代替文件，已生效规则因证据不足退场（与晋升口径一致）。
    const previous = { ...active, status: "active" as const, value: "short" };
    expect(advanceStyleRule("sentenceLength", previous, round).status).toBe("retired");
  });
});
