import { describe, expect, it } from "vitest";

import {
  STYLE_UNKNOWN_VALUE,
  aggregateStat,
  computeSampleStats,
  extractStyleProse,
} from "../../src/style/index.ts";
import { spacedTechArticle } from "./fixtures.ts";

describe("style statistics", () => {
  it("U-ST-1: computes deterministic values for a fixed corpus", () => {
    const stats = computeSampleStats(extractStyleProse(spacedTechArticle("Markdown")));

    expect(stats.cjkLatinSpacing?.value).toBe(1);
    expect(stats.cjkLatinSpacing?.weight).toBeGreaterThanOrEqual(20);
    expect(stats.cjkPunctuationWidth?.value).toBe(1);
    expect(stats.paragraphLength?.weight).toBe(4);
    expect(stats.sentenceLength?.weight).toBe(12);
    expect(stats.headingDensity?.value).toBeGreaterThan(0);

    const unspaced = computeSampleStats(
      extractStyleProse("我们用React写界面,再用TypeScript写类型.然后用Vite打包,一切顺利."),
    );
    expect(unspaced.cjkLatinSpacing?.value).toBe(0);
    expect(unspaced.cjkPunctuationWidth?.value).toBe(0);
  });

  it("U-ST-1: aggregates by evidence weight and classifies", () => {
    expect(
      aggregateStat("cjkLatinSpacing", [
        { value: 1, weight: 30 },
        { value: 0, weight: 10 },
      ]),
    ).toMatchObject({ value: "spaced", aggregate: 0.75, totalWeight: 40 });
    expect(aggregateStat("paragraphLength", [{ value: 60, weight: 25 }]).value).toBe("short");
    expect(aggregateStat("paragraphLength", [{ value: 260, weight: 25 }]).value).toBe("long");
  });

  it("U-ST-2: returns unknown when evidence is insufficient or ambiguous", () => {
    expect(aggregateStat("cjkLatinSpacing", []).value).toBe(STYLE_UNKNOWN_VALUE);
    expect(aggregateStat("cjkLatinSpacing", [{ value: 1, weight: 5 }]).value).toBe(
      STYLE_UNKNOWN_VALUE,
    );
    // 加空格与不加空格各占一半，不能判定。
    expect(aggregateStat("cjkLatinSpacing", [{ value: 0.5, weight: 100 }]).value).toBe(
      STYLE_UNKNOWN_VALUE,
    );
    // “翻译为中文”无法统计证明，只会得到 keep-english 或 unknown。
    expect(aggregateStat("termScript", [{ value: 0, weight: 5000 }]).value).toBe(
      STYLE_UNKNOWN_VALUE,
    );
  });
});
