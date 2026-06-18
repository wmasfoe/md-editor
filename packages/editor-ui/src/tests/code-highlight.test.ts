import { describe, expect, it } from "vitest";
import { tokenizeCodeForHighlighting } from "../utils/code-highlight";

describe("code block highlighting", () => {
  it("tokenizes common fenced code block syntax without changing source text", () => {
    const tokens = tokenizeCodeForHighlighting("const answer = 42;\n// note\nreturn \"ok\";", "ts");

    expect(tokens).toEqual(
      expect.arrayContaining([
        { from: 0, to: 5, kind: "keyword" },
        { from: 15, to: 17, kind: "number" },
        { from: 19, to: 26, kind: "comment" },
        { from: 27, to: 33, kind: "keyword" },
        { from: 34, to: 38, kind: "string" }
      ])
    );
  });

  it("tokenizes HTML tags for markdown-adjacent snippets", () => {
    const tokens = tokenizeCodeForHighlighting("<Callout>Hi</Callout>", "html");

    expect(tokens).toEqual(
      expect.arrayContaining([
        { from: 0, to: 8, kind: "tag" },
        { from: 8, to: 9, kind: "tag" },
        { from: 11, to: 20, kind: "tag" },
        { from: 20, to: 21, kind: "tag" }
      ])
    );
  });

  it("tokenizes Python code with Python-specific keywords", () => {
    const tokens = tokenizeCodeForHighlighting("def hello():\n    return True", "python");

    expect(tokens).toEqual(
      expect.arrayContaining([
        { from: 0, to: 3, kind: "keyword" },
        { from: 17, to: 23, kind: "keyword" },
        { from: 24, to: 28, kind: "keyword" }
      ])
    );
  });

  it("tokenizes Rust code with Rust-specific keywords", () => {
    const tokens = tokenizeCodeForHighlighting("fn main() {\n  let x = 42;\n}", "rust");

    expect(tokens).toEqual(
      expect.arrayContaining([
        { from: 0, to: 2, kind: "keyword" },
        { from: 14, to: 17, kind: "keyword" },
        { from: 22, to: 24, kind: "number" }
      ])
    );
  });

  it("tokenizes SQL with case-insensitive keywords", () => {
    const tokens = tokenizeCodeForHighlighting("SELECT * FROM users WHERE id = 1", "sql");

    expect(tokens).toEqual(
      expect.arrayContaining([
        { from: 0, to: 6, kind: "keyword" },
        { from: 9, to: 13, kind: "keyword" },
        { from: 20, to: 25, kind: "keyword" },
        { from: 31, to: 32, kind: "number" }
      ])
    );
  });

  it("tokenizes Dockerfile with uppercase keywords", () => {
    const tokens = tokenizeCodeForHighlighting("FROM node:18\nRUN npm install", "dockerfile");

    expect(tokens).toEqual(
      expect.arrayContaining([
        { from: 0, to: 4, kind: "keyword" },
        { from: 13, to: 16, kind: "keyword" }
      ])
    );
  });

  it("tokenizes MDX component tags in fenced mdx blocks", () => {
    const tokens = tokenizeCodeForHighlighting("<Callout type=\"info\">Note</Callout>", "mdx");

    expect(tokens).toEqual(
      expect.arrayContaining([
        { from: 0, to: 8, kind: "tag" },
        { from: 14, to: 20, kind: "string" },
        { from: 20, to: 21, kind: "tag" },
        { from: 25, to: 34, kind: "tag" },
        { from: 34, to: 35, kind: "tag" }
      ])
    );
  });
});
