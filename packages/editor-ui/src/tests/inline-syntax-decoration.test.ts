import { describe, expect, it } from "vitest";

/**
 * T4 — decoration 染色正确性
 *
 * 验证 inlineSyntaxDecorationPlugin 的正则模式能正确识别 4 种内联语法标记。
 * 不依赖完整 ProseMirror 文档，直接测试正则匹配逻辑。
 */
describe("inline syntax decoration correctness", () => {
  // 从 inlineSyntaxDecorationPlugin.ts 复制的正则（验证时保持同步）
  const INLINE_SYNTAX_PATTERNS = {
    bold: /(\*\*|__)(.*?)\1/g,
    italic: /([*_])(.*?)\1/g,
    code: /(`+)(.*?)\1/g,
    strikethrough: /(~~)(.*?)\1/g,
  };

  it("T4.1 — identifies bold syntax markers (** or __)", () => {
    const testCases = [
      { text: "**bold**", expected: 1 },
      { text: "__bold__", expected: 1 },
      { text: "**bold** and __bold2__", expected: 2 },
      { text: "**nested **bold****", expected: 2 }, // 嵌套情况
    ];

    for (const { text, expected } of testCases) {
      const matches = [...text.matchAll(INLINE_SYNTAX_PATTERNS.bold)];
      expect(matches.length).toBe(expected);
    }
  });

  it("T4.2 — identifies italic syntax markers (* or _)", () => {
    const testCases = [
      { text: "*italic*", expected: 1 },
      { text: "_italic_", expected: 1 },
      { text: "*italic* and _italic2_", expected: 2 },
    ];

    for (const { text, expected } of testCases) {
      const matches = [...text.matchAll(INLINE_SYNTAX_PATTERNS.italic)];
      expect(matches.length).toBe(expected);
    }
  });

  it("T4.3 — identifies inline code markers (`)", () => {
    const testCases = [
      { text: "`code`", expected: 1 },
      { text: "``code``", expected: 1 },
      { text: "`code` and ``code2``", expected: 2 },
    ];

    for (const { text, expected } of testCases) {
      const matches = [...text.matchAll(INLINE_SYNTAX_PATTERNS.code)];
      expect(matches.length).toBe(expected);
    }
  });

  it("T4.4 — identifies strikethrough markers (~~)", () => {
    const testCases = [
      { text: "~~strike~~", expected: 1 },
      { text: "~~strike~~ and ~~more~~", expected: 2 },
    ];

    for (const { text, expected } of testCases) {
      const matches = [...text.matchAll(INLINE_SYNTAX_PATTERNS.strikethrough)];
      expect(matches.length).toBe(expected);
    }
  });

  it("T4.5 — handles mixed syntax in one paragraph", () => {
    const text = "**bold** *italic* `code` ~~strike~~";

    expect([...text.matchAll(INLINE_SYNTAX_PATTERNS.bold)].length).toBe(1);
    expect([...text.matchAll(INLINE_SYNTAX_PATTERNS.italic)].length).toBeGreaterThanOrEqual(1);
    expect([...text.matchAll(INLINE_SYNTAX_PATTERNS.code)].length).toBe(1);
    expect([...text.matchAll(INLINE_SYNTAX_PATTERNS.strikethrough)].length).toBe(1);
  });

  it("T4.6 — does not match incomplete syntax", () => {
    const incompleteCases = [
      { text: "**bold", pattern: INLINE_SYNTAX_PATTERNS.bold },
      { text: "*italic", pattern: INLINE_SYNTAX_PATTERNS.italic },
      { text: "`code", pattern: INLINE_SYNTAX_PATTERNS.code },
      { text: "~~strike", pattern: INLINE_SYNTAX_PATTERNS.strikethrough },
    ];

    for (const { text, pattern } of incompleteCases) {
      const matches = [...text.matchAll(pattern)];
      expect(matches.length).toBe(0);
    }
  });
});

