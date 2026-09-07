import { describe, expect, it } from "vitest";
import { parser } from "@lezer/markdown";
import { highlightPlugin, HIGHLIGHT_NODES, highlightMarkdownExtension } from "../src/index.ts";

describe("highlightPlugin", () => {
  const configuredParser = parser.configure(highlightMarkdownExtension);

  it("exposes the correct plugin contract", () => {
    expect(highlightPlugin.id).toBe("markdown.highlight");
    expect(highlightPlugin.name).toBe("文本高亮");
    expect(highlightPlugin.markdownExtension).toBe(highlightMarkdownExtension);
    expect(highlightPlugin.nodePolicies).toBeDefined();

    const policy = highlightPlugin.nodePolicies?.[HIGHLIGHT_NODES.Highlight];
    expect(policy).toBeDefined();
    expect(policy?.kind).toBe("highlight");
    expect(policy?.renderPolicy).toBe("inline-visible-markers");
    expect(policy?.editPolicy).toBe("native");
    expect(policy?.interactionPolicy).toBe("text");
    expect(policy?.markerNodeNames).toEqual([HIGHLIGHT_NODES.HighlightMark]);
    expect(policy?.contentStrategy).toBe("between-markers");
  });

  it("parses basic ==highlight== syntax", () => {
    const tree = configuredParser.parse("Hello ==world== text");
    const top = tree.topNode;
    expect(top.toString()).toBe("Document(Paragraph(Highlight(HighlightMark,HighlightMark)))");

    const highlightNode = top.getChild("Paragraph")?.getChild(HIGHLIGHT_NODES.Highlight);
    expect(highlightNode).toBeDefined();
    expect(highlightNode?.from).toBe(6);
    expect(highlightNode?.to).toBe(15);
  });

  it("parses Chinese text highlight correctly", () => {
    const tree = configuredParser.parse("这是一段==高亮文本测试==内容");
    const top = tree.topNode;
    expect(top.toString()).toBe("Document(Paragraph(Highlight(HighlightMark,HighlightMark)))");
  });

  it("supports nested bold and italic inside highlight", () => {
    const tree = configuredParser.parse("==text with **bold** and *italic*==");
    const top = tree.topNode;
    expect(top.toString()).toBe(
      "Document(Paragraph(Highlight(HighlightMark,StrongEmphasis(EmphasisMark,EmphasisMark),Emphasis(EmphasisMark,EmphasisMark),HighlightMark)))",
    );
  });

  it("supports highlight nested inside bold", () => {
    const tree = configuredParser.parse("**bold and ==highlight== text**");
    const top = tree.topNode;
    expect(top.toString()).toBe(
      "Document(Paragraph(StrongEmphasis(EmphasisMark,Highlight(HighlightMark,HighlightMark),EmphasisMark)))",
    );
  });

  it("handles multiple highlights in the same line", () => {
    const tree = configuredParser.parse("==first== and ==second==");
    const top = tree.topNode;
    expect(top.toString()).toBe(
      "Document(Paragraph(Highlight(HighlightMark,HighlightMark),Highlight(HighlightMark,HighlightMark)))",
    );
  });

  it("does not match when whitespace is adjacent to markers", () => {
    const openSpaced = configuredParser.parse("== not highlight==");
    expect(openSpaced.topNode.toString()).toBe("Document(Paragraph)");

    const closeSpaced = configuredParser.parse("==not highlight ==");
    expect(closeSpaced.topNode.toString()).toBe("Document(Paragraph)");
  });

  it("gracefully falls back when plugin is not loaded", () => {
    const defaultParser = parser;
    const tree = defaultParser.parse("Hello ==world== text");
    expect(tree.topNode.toString()).toBe("Document(Paragraph)");
    expect(tree.topNode.getChild("Paragraph")?.getChild(HIGHLIGHT_NODES.Highlight)).toBeNull();
  });

  it("extracts metadata properly via extractMetadata", () => {
    const source = "Hello ==highlighted== text";
    const tree = configuredParser.parse(source);
    const node = tree.topNode.getChild("Paragraph")!.getChild(HIGHLIGHT_NODES.Highlight)!;
    const children = [
      node.firstChild!, // open mark
      node.lastChild!, // close mark
    ];

    const metadata = highlightPlugin.extractMetadata?.(node, source, children);
    expect(metadata).toBeDefined();
    expect(metadata?.text).toBe("highlighted");
    expect(metadata?.openingMarkerRange).toEqual({ from: 6, to: 8 });
    expect(metadata?.closingMarkerRange).toEqual({ from: 19, to: 21 });
    expect(metadata?.contentRange).toEqual({ from: 8, to: 19 });
  });
});
