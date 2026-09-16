import { describe, expect, it } from "vitest";
import { renderStaticHtml, renderStaticDocument, type StaticCustomRenderer } from "../src/index.ts";

describe("@md-editor/compiler renderStaticHtml", () => {
  it("renders basic Markdown elements with Inkpoint dimmed inline markers", () => {
    const md =
      "# Hello World\n\nThis is a **bold** and *italic* text with ~~strikethrough~~, `code`, and ==highlight==.";
    const result = renderStaticHtml(md);

    expect(result.title).toBe("Hello World");
    expect(result.html).toContain("<h1");
    expect(result.html).toContain("Hello World</h1>");
    expect(result.html).toContain('<span class="cm-md-marker cm-md-marker--bold">**</span>');
    expect(result.html).toContain('<strong class="cm-md-inline cm-md-bold">bold</strong>');
    expect(result.html).toContain('<span class="cm-md-marker cm-md-marker--italic">*</span>');
    expect(result.html).toContain('<em class="cm-md-inline cm-md-italic">italic</em>');
    expect(result.html).toContain(
      '<span class="cm-md-marker cm-md-marker--strikethrough">~~</span>',
    );
    expect(result.html).toContain(
      '<del class="cm-md-inline cm-md-strikethrough">strikethrough</del>',
    );
    expect(result.html).toContain('<span class="cm-md-marker cm-md-marker--inline-code">`</span>');
    expect(result.html).toContain('<code class="cm-md-inline cm-md-inline-code">code</code>');
    expect(result.html).toContain('<span class="cm-md-marker cm-md-marker--highlight">==</span>');
    expect(result.html).toContain('<mark class="cm-md-inline cm-md-highlight">highlight</mark>');
  });

  it("can disable syntax markers for clean HTML output", () => {
    const md = "**pure bold** and *pure italic*";
    const result = renderStaticHtml(md, { includeMarkers: false });
    expect(result.html).not.toContain("cm-md-marker");
    expect(result.html).toContain("<strong>pure bold</strong>");
    expect(result.html).toContain("<em>pure italic</em>");
  });

  it("renders GFM tables properly", () => {
    const tableMd = `
| Feature | Status |
| :--- | :--- |
| Table | Supported |
| Code | Highlighted |
`;
    const result = renderStaticHtml(tableMd);
    expect(result.html).toContain("<table");
    expect(result.html).toContain("<th");
    expect(result.html).toContain("Feature");
    expect(result.html).toContain("Status");
    expect(result.html).toContain("<td");
    expect(result.html).toContain("Supported");
  });

  it("renders GFM task lists with disabled checkboxes without redundant [x] text or paragraph linebreaks", () => {
    const taskMd = `
- [x] Completed task with **bold** text
- [ ] Incomplete task
`;
    const result = renderStaticHtml(taskMd);
    expect(result.html).toContain('class="contains-task-list"');
    expect(result.html).toContain('class="task-list-item"');
    expect(result.html).toContain('<input type="checkbox" checked="" disabled="">');
    expect(result.html).toContain('<input type="checkbox" disabled="">');
    expect(result.html).toContain("Completed task with");
    expect(result.html).toContain("Incomplete task");
    // Ensure no raw [x] or [ ] tokens leaked into the output
    expect(result.html).not.toContain("[x]");
    expect(result.html).not.toContain("[ ]");
    // Ensure tight list items are rendered inline without breaking into <p> tags
    expect(result.html).not.toContain("<p>");
  });

  it("renders code blocks with syntax highlighting", () => {
    const codeMd = `\`\`\`rust
fn main() {
    println!("Hello Inkpoint");
}
\`\`\``;
    const result = renderStaticHtml(codeMd);
    expect(result.html).toContain('<pre><code class="hljs language-rust">');
    expect(result.html).toContain('class="hljs-keyword"');
    expect(result.html).toContain("fn");
  });

  it("renders GFM Alert callouts with SVG icons and default titles", () => {
    const calloutMd = `> [!NOTE]
> This is an important note for Inkpoint.`;
    const result = renderStaticHtml(calloutMd);
    expect(result.html).toContain('class="cm-callout cm-callout--note"');
    expect(result.html).toContain('class="cm-callout__title">Note</strong>');
    expect(result.html).toContain("<svg");
    expect(result.html).toContain("This is an important note for Inkpoint.");
  });

  it("renders Container Directives :::tip [custom title]", () => {
    const directiveMd = `:::tip Pro Tip
Make sure to drink water.
:::`;
    const result = renderStaticHtml(directiveMd);
    expect(result.html).toContain('class="cm-callout cm-callout--tip"');
    expect(result.html).toContain('class="cm-callout__title">Pro Tip</strong>');
    expect(result.html).toContain("Make sure to drink water.");
  });

  it("supports StaticCustomRenderer for intercepting AST output", () => {
    const md = "# Custom Heading\n\nParagraph text.";
    const customRenderer: StaticCustomRenderer = {
      heading: (token, next) => `<section class="custom-sec">${next()}</section>`,
      paragraph: (token) => `<p class="custom-lead">${token.text}</p>\n`,
    };

    const result = renderStaticHtml(md, { customRenderer });
    expect(result.html).toContain('<section class="custom-sec">');
    expect(result.html).toContain('<p class="custom-lead">Paragraph text.</p>');
  });

  it("extracts frontmatter at document offset 0", () => {
    const mdWithFm = `---
title: My Document
author: Inkpoint
---
# Main Content
Body here.`;
    const result = renderStaticHtml(mdWithFm);
    expect(result.frontmatterRaw).toBe("title: My Document\nauthor: Inkpoint");
    expect(result.title).toBe("Main Content");
    expect(result.html).not.toContain("author: Inkpoint");
    expect(result.html).toContain("Main Content</h1>");
  });

  it("handles empty document gracefully", () => {
    const result = renderStaticHtml("   \n\n  ");
    expect(result.html).toContain("空文档");
  });

  it("renders complete static document with inlined theme styles", () => {
    const md = "# Document Title\n\nSome text content.";
    const doc = renderStaticDocument(md);
    expect(doc).toContain("<!doctype html>");
    expect(doc).toContain('<html lang="en">');
    expect(doc).toContain("<title>Document Title</title>");
    expect(doc).toContain("--theme-bg: #ffffff;");
    expect(doc).toContain("@media (prefers-color-scheme: dark)");
    expect(doc).toContain('<div id="content">');
    expect(doc).toContain("Document Title</h1>");
  });

  it("preserves explicit language identifier like mermaid without auto-detection overwrite", () => {
    const mermaidMd = `\`\`\`mermaid
graph TD
  A --> B
\`\`\``;
    const result = renderStaticHtml(mermaidMd);
    expect(result.html).toContain('<pre><code class="hljs language-mermaid">');
    expect(result.html).toContain("graph TD");
    expect(result.html).toContain("A --&gt; B");
  });
});
