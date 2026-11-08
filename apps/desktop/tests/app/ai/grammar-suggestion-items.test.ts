import { describe, expect, it } from "vitest";
import type { AiWritingSuggestion } from "@md-editor/ai";
import { toGrammarSuggestionItems } from "../../../src/app/ai/grammar-suggestion-items";

const markdown = "# 标题\n\n我门用React写界面";
const from = markdown.indexOf("我门");
const target = { from, to: markdown.length, text: markdown.slice(from), markdown };

describe("grammar suggestion items", () => {
  it("E-3/U-GEC-2: every diff becomes an item; style suggestions keep their kind", () => {
    const suggestion: AiWritingSuggestion = {
      hasEdit: true,
      edit: {
        original: "我门",
        replacement: "我们",
        diffs: [
          {
            start: 0,
            end: 2,
            utf16From: 0,
            utf16To: 2,
            original: "我门",
            replacement: "我们",
            kind: "fix",
          },
          {
            start: 2,
            end: 4,
            utf16From: 2,
            utf16To: 4,
            original: "用R",
            replacement: "用 R",
            kind: "style",
          },
        ],
      },
    };
    expect(toGrammarSuggestionItems(suggestion, target)).toEqual([
      {
        from,
        to: from + 2,
        text: "我们",
        originalText: "我门",
        explanation: undefined,
        kind: "fix",
      },
      {
        from: from + 2,
        to: from + 4,
        text: "用 R",
        originalText: "用R",
        explanation: undefined,
        kind: "style",
      },
    ]);
  });

  it("keeps the single-edit fallback for JSON results without offsets", () => {
    const suggestion: AiWritingSuggestion = {
      hasEdit: true,
      edit: { original: "我门", replacement: "我们", reason: "错别字" },
    };
    expect(toGrammarSuggestionItems(suggestion, target)).toEqual([
      { from, to: from + 2, text: "我们", originalText: "我门", explanation: "错别字" },
    ]);
  });

  it("drops no-op diffs and returns nothing without an edit", () => {
    const noop: AiWritingSuggestion = {
      hasEdit: true,
      edit: {
        original: "我门",
        replacement: "我门",
        diffs: [
          { start: 0, end: 2, utf16From: 0, utf16To: 2, original: "我门", replacement: "我门" },
        ],
      },
    };
    expect(toGrammarSuggestionItems(noop, target)).toEqual([]);
    expect(toGrammarSuggestionItems({ hasEdit: false, edit: null }, target)).toEqual([]);
  });
});
