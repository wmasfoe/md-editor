import { describe, expect, it } from "vitest";
import {
  compileToTokens,
  type HeadingToken,
  type CalloutToken,
  type MathBlockToken,
  type MathInlineToken,
  type ParagraphToken,
} from "../src/index.ts";

describe("compileToTokens", () => {
  it("extracts frontmatter, title, and token stream", () => {
    const md = `---
title: Test Doc
author: Inkpoint
---

# Hello World

This is a paragraph with **bold**, *italic*, ==highlighted==, and \`inline code\`.

> [!NOTE] Custom Note Title
> This is a callout block.
`;

    const result = compileToTokens(md);
    expect(result.frontmatterRaw).toBe("title: Test Doc\nauthor: Inkpoint");
    expect(result.title).toBe("Hello World");
    expect(result.tokens.length).toBeGreaterThan(0);

    const heading = result.tokens.find((t) => t.type === "heading") as HeadingToken;
    expect(heading).toBeDefined();
    expect(heading.level).toBe(1);
    expect(heading.text).toBe("Hello World");
    expect(heading.id).toBe("hello-world");

    const callout = result.tokens.find((t) => t.type === "callout") as CalloutToken;
    expect(callout).toBeDefined();
    expect(callout.calloutType).toBe("note");
    expect(callout.title).toBe("Custom Note Title");
  });

  it("extracts math tokens correctly", () => {
    const md = `Here is inline $E = mc^2$ math.

$$
\\frac{a}{b} = c
$$
`;
    const result = compileToTokens(md);
    const mathBlock = result.tokens.find((t) => t.type === "math_block") as MathBlockToken;
    expect(mathBlock).toBeDefined();
    expect(mathBlock.math).toContain("\\frac{a}{b} = c");

    const paragraph = result.tokens.find((t) => t.type === "paragraph") as ParagraphToken;
    expect(paragraph).toBeDefined();
    const mathInline = paragraph.tokens?.find((t) => t.type === "math_inline") as MathInlineToken;
    expect(mathInline).toBeDefined();
    expect(mathInline.math).toBe("E = mc^2");
  });

  it("handles empty document safely", () => {
    const result = compileToTokens("");
    expect(result.tokens).toEqual([]);
    expect(result.title).toBe("Untitled");
    expect(result.frontmatterRaw).toBeUndefined();
  });
});
