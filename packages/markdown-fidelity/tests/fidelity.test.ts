import { describe, expect, it } from "vitest";
import {
  extractHeadingOutline,
  isLikelyMdxBlock,
  serializeRoundTrip,
  splitFrontmatter
} from "../src";

describe("frontmatter preservation", () => {
  it("keeps raw frontmatter text separate from body", () => {
    const markdown = "---\n# comment\ntitle: \"Post\"\ndate: 2026-06-12\n---\n# Body\n";

    expect(splitFrontmatter(markdown)).toEqual({
      raw: "---\n# comment\ntitle: \"Post\"\ndate: 2026-06-12\n---",
      body: "# Body\n"
    });
  });

  it("does not treat invalid top matter as frontmatter", () => {
    expect(splitFrontmatter("---\ntitle: Post\n# Missing close")).toBeNull();
  });
});

describe("round-trip normalization", () => {
  it("only adds a final trailing newline in the placeholder serializer", () => {
    expect(serializeRoundTrip("<Callout type=\"info\" />")).toEqual({
      markdown: "<Callout type=\"info\" />\n",
      changed: true
    });
  });

  it("preserves raw blocks that already include a final newline", () => {
    const markdown = "```ts meta\nconst value = 1;\n```\n";

    expect(serializeRoundTrip(markdown)).toEqual({
      markdown,
      changed: false
    });
  });
});

describe("outline extraction", () => {
  it("extracts h1-h6 headings with stable duplicate ids", () => {
    expect(extractHeadingOutline("# A\n## B\n### B\n")).toEqual([
      { id: "a", level: 1, text: "A", line: 1 },
      { id: "b", level: 2, text: "B", line: 2 },
      { id: "b-2", level: 3, text: "B", line: 3 }
    ]);
  });
});

describe("MDX raw block detection", () => {
  it("detects unknown MDX component blocks without executing them", () => {
    expect(isLikelyMdxBlock("<CustomThing foo=\"bar\" />")).toBe(true);
    expect(isLikelyMdxBlock("<div>html</div>")).toBe(false);
  });
});
