import { describe, expect, it } from "vitest";
import { renderStaticHtml, renderStaticDocument } from "../src/static/index.ts";

describe("@md-editor/renderer-codemirror/static", () => {
  it("renders basic Markdown elements with Inkpoint dimmed inline markers", () => {
    const md =
      "# Hello World\n\nThis is a **bold** and *italic* text with ~~strikethrough~~ and `code`.";
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

  it("renders GFM task lists with disabled checkboxes", () => {
    const taskMd = `
- [x] Completed task
- [ ] Incomplete task
`;
    const result = renderStaticHtml(taskMd);
    expect(result.html).toContain('class="task-list-item"');
    expect(result.html).toContain('<input type="checkbox" checked="" disabled=""');
    expect(result.html).toContain('<input type="checkbox" disabled=""');
    expect(result.html).toContain("Completed task");
    expect(result.html).toContain("Incomplete task");
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

  it("renders Callouts with custom titles", () => {
    const customCalloutMd = `> [!WARNING] Custom Alert Title
> Watch out!`;
    const result = renderStaticHtml(customCalloutMd);
    expect(result.html).toContain('class="cm-callout cm-callout--warning"');
    expect(result.html).toContain('class="cm-callout__title">Custom Alert Title</strong>');
    expect(result.html).toContain("Watch out!");
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
});
