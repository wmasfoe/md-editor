import { describe, expect, it } from "vitest";
import {
  createMarkdownImageSrcResolver,
  extractHeadingOutline,
  findActiveHeadingIdForLine,
  isLikelyMdxBlock,
  restoreMarkdownImageSources,
  rewriteMarkdownImageSourcesForPreview,
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

  it("finds the active heading for a visible line", () => {
    const outline = extractHeadingOutline("# A\nbody\n## B\nmore\n### C\n");

    expect(findActiveHeadingIdForLine(outline, 1)).toBe("a");
    expect(findActiveHeadingIdForLine(outline, 4)).toBe("b");
    expect(findActiveHeadingIdForLine(outline, 99)).toBe("c");
    expect(findActiveHeadingIdForLine(outline, 0)).toBeNull();
  });
});

describe("MDX raw block detection", () => {
  it("detects unknown MDX component blocks without executing them", () => {
    expect(isLikelyMdxBlock("<CustomThing foo=\"bar\" />")).toBe(true);
    expect(isLikelyMdxBlock("<div>html</div>")).toBe(false);
  });
});

describe("local Markdown image preview sources", () => {
  it("resolves relative image paths through the desktop asset protocol", () => {
    const resolveImageSrc = createMarkdownImageSrcResolver("/Users/me/docs/today.md", {
      hasTauriRuntime: true,
      convertFileSrc: (path) => `asset://${path}`
    });

    expect(resolveImageSrc("assets/pasted%20image.png")).toBe(
      "asset:///Users/me/docs/assets/pasted image.png"
    );
  });

  it("leaves remote, embedded, and non-desktop image sources unchanged", () => {
    const resolveImageSrc = createMarkdownImageSrcResolver("/Users/me/docs/today.md", {
      hasTauriRuntime: true,
      convertFileSrc: (path) => `asset://${path}`
    });

    expect(resolveImageSrc("https://example.com/a.png")).toBe("https://example.com/a.png");
    expect(resolveImageSrc("data:image/png;base64,abc")).toBe("data:image/png;base64,abc");
    expect(
      createMarkdownImageSrcResolver("/Users/me/docs/today.md", {
        hasTauriRuntime: false,
        convertFileSrc: (path) => `asset://${path}`
      })("assets/a.png")
    ).toBe("assets/a.png");
  });

  it("rewrites preview Markdown and restores original persisted sources", () => {
    const input = "before\n\n![shot](assets/a.png)\n\n![remote](https://example.com/a.png)\n";
    const preview = rewriteMarkdownImageSourcesForPreview(
      input,
      createMarkdownImageSrcResolver("/Users/me/docs/today.md", {
        hasTauriRuntime: true,
        convertFileSrc: (path) => `asset://${path}`
      })
    );

    expect(preview.markdown).toContain("![shot](asset:///Users/me/docs/assets/a.png)");
    expect(preview.markdown).toContain("![remote](https://example.com/a.png)");
    expect(restoreMarkdownImageSources(preview.markdown, preview.sourceMap)).toBe(input);
  });
});
