import { describe, expect, it } from "vitest";
import { getMarkdownNodePolicy, isExplicitDeferredNode } from "./node-policy.ts";

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

  it("marks deferred scope raw and gives unknown nodes a raw fallback", () => {
    for (const nodeName of ["FencedCode", "CodeBlock", "Table", "HTMLBlock", "HTMLTag"]) {
      expect(isExplicitDeferredNode(nodeName)).toBe(true);
      expect(getMarkdownNodePolicy(nodeName)).toMatchObject({
        renderPolicy: "deferred-raw",
        editPolicy: "native",
      });
    }
    expect(getMarkdownNodePolicy("FutureExtensionNode")).toMatchObject({
      kind: "raw-fallback",
      renderPolicy: "raw-fallback",
      editPolicy: "native",
    });
  });
});
