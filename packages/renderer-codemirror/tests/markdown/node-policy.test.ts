import { describe, expect, it } from "vitest";
import { getMarkdownNodePolicy, isExplicitDeferredNode } from "../../src/markdown/node-policy.ts";

describe("Markdown node policy registry", () => {
  it("maps every M1 semantic node to an explicit policy", () => {
    expect(getMarkdownNodePolicy("StrongEmphasis")).toMatchObject({
      kind: "bold",
      renderPolicy: "inline-visible-markers",
      editPolicy: "native",
    });
    expect(getMarkdownNodePolicy("ATXHeading6")).toMatchObject({
      kind: "heading-atx",
      renderPolicy: "heading-active-marker",
    });
    expect(getMarkdownNodePolicy("ListItem", "OrderedList")?.kind).toBe("list-item-ordered");
    expect(getMarkdownNodePolicy("ListItem", "BulletList")?.kind).toBe("list-item-unordered");
    expect(getMarkdownNodePolicy("Image", "Paragraph", ["LinkMark", "URL"])).toMatchObject({
      kind: "image",
      editPolicy: "atom-delete",
    });
    expect(
      getMarkdownNodePolicy("Image", "Paragraph", [
        "LinkMark",
        "LinkMark",
        "LinkMark",
        "LinkMark",
      ]),
    ).toMatchObject({
      kind: "image",
      renderPolicy: "image-widget",
      editPolicy: "atom-delete",
    });
    expect(
      getMarkdownNodePolicy("Image", "Paragraph", ["LinkMark", "LinkMark", "LinkLabel"]),
    ).toMatchObject({
      kind: "reference-image",
      renderPolicy: "source-only-atom",
    });
    expect(getMarkdownNodePolicy("Image", "Paragraph", ["LinkMark", "LinkMark"])).toMatchObject({
      kind: "reference-image",
      renderPolicy: "source-only-atom",
    });
    expect(
      getMarkdownNodePolicy("Link", "Paragraph", [
        "LinkMark",
        "LinkMark",
        "LinkMark",
        "LinkMark",
      ]),
    ).toMatchObject({
      kind: "link",
      renderPolicy: "link-segmented",
    });
    expect(
      getMarkdownNodePolicy("Link", "Paragraph", ["LinkMark", "LinkMark", "LinkLabel"]),
    ).toMatchObject({
      kind: "reference-link",
      renderPolicy: "source-only-atom",
    });
    expect(getMarkdownNodePolicy("Link", "Paragraph", ["LinkMark", "LinkMark"])).toMatchObject({
      kind: "reference-link",
      renderPolicy: "source-only-atom",
    });
    expect(getMarkdownNodePolicy("HorizontalRule")).toMatchObject({
      kind: "thematic-break",
      interactionPolicy: "select-atom",
    });
  });

  it("keeps structural and marker nodes transparent", () => {
    for (const nodeName of [
      "Document",
      "Paragraph",
      "BulletList",
      "OrderedList",
      "EmphasisMark",
      "LinkMark",
      "TableCell",
    ]) {
      expect(getMarkdownNodePolicy(nodeName)).toBeNull();
    }
  });

  it("claims only top-level GFM URL nodes as bare autolinks", () => {
    expect(getMarkdownNodePolicy("URL", "Paragraph")).toMatchObject({
      kind: "autolink",
      renderPolicy: "source-only-atom",
      editPolicy: "source-mode-only",
    });
    expect(getMarkdownNodePolicy("URL", "Autolink")).toBeNull();
    expect(getMarkdownNodePolicy("URL", "Link")).toBeNull();
    expect(getMarkdownNodePolicy("URL", "Image")).toBeNull();
  });

  it("claims GFM tables with a structured table-widget policy", () => {
    expect(getMarkdownNodePolicy("Table")).toMatchObject({
      kind: "table",
      renderPolicy: "table-widget",
      editPolicy: "structured",
      interactionPolicy: "structured-block",
    });
    // TableHeader/Row/Cell/Delimiter are transparent and must not receive policies.
    for (const nodeName of ["TableHeader", "TableRow", "TableCell", "TableDelimiter"]) {
      expect(getMarkdownNodePolicy(nodeName)).toBeNull();
    }
  });

  it("marks deferred scope raw and gives unknown nodes a raw fallback", () => {
    for (const nodeName of ["FencedCode", "CodeBlock", "HTMLTag"]) {
      expect(isExplicitDeferredNode(nodeName)).toBe(true);
      expect(getMarkdownNodePolicy(nodeName)).toMatchObject({
        renderPolicy: "deferred-raw",
        editPolicy: "native",
      });
    }
    expect(isExplicitDeferredNode("HTMLBlock")).toBe(false);
    expect(getMarkdownNodePolicy("HTMLBlock")).toMatchObject({
      kind: "html",
      renderPolicy: "html-widget",
      editPolicy: "structured",
      interactionPolicy: "structured-block",
    });
    expect(getMarkdownNodePolicy("FutureExtensionNode")).toMatchObject({
      kind: "raw-fallback",
      renderPolicy: "raw-fallback",
      editPolicy: "native",
    });
  });
});
