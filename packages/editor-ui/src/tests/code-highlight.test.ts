import { describe, expect, it } from "vitest";
import {
  normalizeCodeHighlightLanguage,
  tokenizeCodeForHighlighting,
} from "../utils/code-highlight";

describe("code block highlighting", () => {
  it("uses Shiki tokens without changing source offsets", async () => {
    const code = 'const answer = 42;\n// note\nreturn "ok";';
    const tokens = await tokenizeCodeForHighlighting(code, "ts");

    expect(tokens.length).toBeGreaterThan(4);
    expect(tokens).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ from: 0, to: 5 }),
        expect.objectContaining({ from: 15, to: 17 }),
        expect.objectContaining({ from: 19, to: 26 }),
        expect.objectContaining({ from: 27, to: 33 }),
        expect.objectContaining({ from: 34, to: 38 }),
      ]),
    );
    expect(tokens.every((token) => token.from >= 0 && token.to <= code.length && token.kind)).toBe(
      true,
    );
    expect(tokens).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ from: 0, to: 5, kind: "keyword" }),
        expect.objectContaining({ from: 15, to: 17, kind: "number" }),
        expect.objectContaining({ from: 19, to: 26, kind: "comment" }),
        expect.objectContaining({ from: 27, to: 33, kind: "keyword" }),
        expect.objectContaining({ from: 34, to: 38, kind: "string" }),
      ]),
    );
  });

  it("normalizes common fenced language aliases to Shiki languages", () => {
    expect(normalizeCodeHighlightLanguage("ts")).toBe("typescript");
    expect(normalizeCodeHighlightLanguage("tsx")).toBe("tsx");
    expect(normalizeCodeHighlightLanguage("js")).toBe("javascript");
    expect(normalizeCodeHighlightLanguage("sh")).toBe("shellscript");
    expect(normalizeCodeHighlightLanguage("yml")).toBe("yaml");
  });

  it("returns no tokens for unsupported languages", async () => {
    await expect(tokenizeCodeForHighlighting("hello", "unknown-language")).resolves.toEqual([]);
  });

  it("highlights JSON keys and values as separate source ranges", async () => {
    const tokens = await tokenizeCodeForHighlighting('{"name":"Ada","enabled":true}', "json");

    expect(tokens).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ from: 1, to: 7 }),
        expect.objectContaining({ from: 8, to: 13 }),
        expect.objectContaining({ from: 14, to: 23 }),
        expect.objectContaining({ from: 24, to: 28 }),
      ]),
    );
  });

  it("highlights HTML and MDX tag attributes", async () => {
    const htmlTokens = await tokenizeCodeForHighlighting(
      '<Callout type="info">Hi</Callout>',
      "html",
    );
    const mdxTokens = await tokenizeCodeForHighlighting(
      '<Callout type="info">Note</Callout>',
      "mdx",
    );

    expect(htmlTokens).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ from: 1, to: 8 }),
        expect.objectContaining({ from: 9, to: 13 }),
        expect.objectContaining({ from: 14, to: 20 }),
      ]),
    );
    expect(mdxTokens).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ from: 1, to: 8 }),
        expect.objectContaining({ from: 9, to: 13 }),
        expect.objectContaining({ from: 14, to: 20 }),
      ]),
    );
  });

  it("does not collapse CSS color values into comment ranges", async () => {
    const code = ".note { color: #1f6feb; margin: 0; }";
    const tokens = await tokenizeCodeForHighlighting(code, "css");

    expect(tokens).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ from: 8, to: 13 }),
        expect.objectContaining({ from: 15, to: 22 }),
        expect.objectContaining({ from: 24, to: 30 }),
        expect.objectContaining({ from: 32, to: 33 }),
      ]),
    );
    expect(tokens.some((token) => token.from === 15 && token.to === code.length)).toBe(false);
  });
});
