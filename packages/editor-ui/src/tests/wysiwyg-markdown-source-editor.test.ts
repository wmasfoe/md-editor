import { describe, expect, it } from "vitest";
import type { WysiwygMarkdownSourceKind } from "../utils/wysiwyg-markdown-source";
import { segmentWysiwygMarkdownSource } from "../utils/wysiwyg-markdown-source-editor";

describe("WYSIWYG Markdown source editor presentation", () => {
  it.each([
    [
      "heading",
      "## Title",
      [
        ["marker", "## "],
        ["content", "Title"],
      ],
    ],
    [
      "link",
      '[Docs](guide.md "Guide")',
      [
        ["marker", "["],
        ["content", "Docs"],
        ["marker", "]("],
        ["destination", 'guide.md "Guide"'],
        ["marker", ")"],
      ],
    ],
    [
      "inlineCode",
      "``code ` sample``",
      [
        ["marker", "``"],
        ["content", "code ` sample"],
        ["marker", "``"],
      ],
    ],
    [
      "strong",
      "**bold**",
      [
        ["marker", "**"],
        ["content", "bold"],
        ["marker", "**"],
      ],
    ],
  ] satisfies readonly [
    WysiwygMarkdownSourceKind,
    string,
    readonly (readonly [string, string])[],
  ][])("preserves %s source while assigning visual roles", (kind, source, expected) => {
    const segments = segmentWysiwygMarkdownSource(kind, source);

    expect(segments.map(({ role, text }) => [role, text])).toEqual(expected);
    expect(segments.map(({ text }) => text).join("")).toBe(source);
  });
});
