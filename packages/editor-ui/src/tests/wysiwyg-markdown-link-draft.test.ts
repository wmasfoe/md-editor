import { describe, expect, it } from "vitest";
import { findWysiwygMarkdownLinkDraft } from "../utils/wysiwyg-markdown-link-draft";

describe("WYSIWYG Markdown link draft parsing", () => {
  it("terminates for incomplete brackets at any text offset", () => {
    expect(findWysiwygMarkdownLinkDraft("", "[")).toBeNull();
    expect(findWysiwygMarkdownLinkDraft("[", "]")).toBeNull();
    expect(findWysiwygMarkdownLinkDraft("prefix [", "]")).toBeNull();
  });

  it("captures complete unescaped links with balanced destinations", () => {
    expect(findWysiwygMarkdownLinkDraft("[](", ")")).toEqual({
      source: "[]()",
      startOffset: 0,
    });
    expect(findWysiwygMarkdownLinkDraft("before [label](next.md", ")")).toEqual({
      source: "[label](next.md)",
      startOffset: 7,
    });
    expect(findWysiwygMarkdownLinkDraft("before[label](next.md", ")")).toEqual({
      source: "[label](next.md)",
      startOffset: 6,
    });
    expect(findWysiwygMarkdownLinkDraft("[label](docs/a(b).md", ")")).toEqual({
      source: "[label](docs/a(b).md)",
      startOffset: 0,
    });
  });

  it("ignores escaped opening brackets", () => {
    expect(findWysiwygMarkdownLinkDraft("\\[](", ")")).toBeNull();
  });
});
