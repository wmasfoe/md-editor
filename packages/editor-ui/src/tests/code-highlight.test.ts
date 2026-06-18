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
});
