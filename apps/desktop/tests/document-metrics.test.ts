import { describe, expect, it } from "vitest";
import {
  calculateDocumentMetrics,
  getDocumentMetricLabel
} from "../src/app/document-metrics";

describe("document metrics", () => {
  it("counts words, lines, and characters for mixed Markdown", () => {
    const metrics = calculateDocumentMetrics("# 标题\nHello world\n中文 mixed");

    expect(metrics).toEqual({
      words: 7,
      lines: 3,
      characters: 25
    });
  });

  it("returns zero lines for an empty document", () => {
    const metrics = calculateDocumentMetrics("");

    expect(metrics.lines).toBe(0);
    expect(metrics.words).toBe(0);
    expect(metrics.characters).toBe(0);
  });

  it("formats the selected metric label", () => {
    const metrics = { words: 12, lines: 3, characters: 48 };

    expect(getDocumentMetricLabel("words", metrics)).toBe("12 词");
    expect(getDocumentMetricLabel("lines", metrics)).toBe("3 行");
    expect(getDocumentMetricLabel("characters", metrics)).toBe("48 字符");
  });
});
