import { describe, expect, it } from "vitest";
import { exportDocumentHtml, renderFragmentHtml } from "../../src/export/html-export.ts";

describe("html-export", () => {
  it("renders fragment html for clipboard copy", () => {
    const md = "# Title\n\nHello **world**!";
    const html = renderFragmentHtml(md);
    expect(html).toContain("<h1");
    expect(html).toContain("Title</h1>");
    expect(html).toContain("<strong>world</strong>");
    // 不应包含完整的 doctype 和 html 头
    expect(html).not.toContain("<!doctype html>");
  });

  it("exports both standalone and linked html simultaneously", async () => {
    const md = "# My Document\n\n![Logo](./assets/logo.png)\n\n![Web](https://example.com/pic.png)";
    const result = await exportDocumentHtml(md, {
      resolveImageDataUrl: async (src) => {
        if (src === "./assets/logo.png") {
          return "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==";
        }
        return null;
      },
    });

    expect(result.title).toBe("My Document");

    // standalone 应包含 base64 内联
    expect(result.standaloneHtml).toContain('src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=="');
    expect(result.standaloneHtml).toContain("<!doctype html>");
    // standalone 不应替换网络图片
    expect(result.standaloneHtml).toContain('src="https://example.com/pic.png"');

    // linked 应保留原始相对路径
    expect(result.linkedHtml).toContain('src="./assets/logo.png"');
    expect(result.linkedHtml).toContain('src="https://example.com/pic.png"');
    expect(result.linkedHtml).toContain("<!doctype html>");
  });

  it("injects custom printPageCss into @media print", async () => {
    const md = "# Printable Note";
    const result = await exportDocumentHtml(md, {
      printPageCss: "@page { size: Letter portrait; }",
    });

    expect(result.standaloneHtml).toContain("@media print { @page { size: Letter portrait; } }");
    expect(result.linkedHtml).toContain("@media print { @page { size: Letter portrait; } }");
  });

  it("inlines mermaid diagrams as vector SVG when renderer provided", async () => {
    const md = "# Chart\n\n```mermaid\ngraph TD;\nA-->B;\n```";
    const result = await exportDocumentHtml(md, {
      renderMermaidSvg: async (code) => {
        expect(code).toContain("graph TD");
        return { svg: '<svg id="test-mermaid"><rect width="100" height="50"/></svg>' };
      },
    });

    expect(result.standaloneHtml).toContain('<div class="cm-md-mermaid-container">');
    expect(result.standaloneHtml).toContain('<svg id="test-mermaid">');
    expect(result.linkedHtml).toContain('<div class="cm-md-mermaid-container">');
    expect(result.linkedHtml).toContain('<svg id="test-mermaid">');
  });

  it("injects prose and code fonts and font sizes into document", async () => {
    const md = "# Font Document\n\nText here.";
    const result = await exportDocumentHtml(md, {
      proseFontFamily: '"LXGW WenKai", sans-serif',
      codeFontFamily: '"JetBrains Mono", monospace',
      fontSize: 18,
      customCss: ':root { --theme-font: "Default Theme Font"; }',
    });

    expect(result.standaloneHtml).toContain('--theme-font: "LXGW WenKai", sans-serif !important;');
    expect(result.standaloneHtml).toContain(
      '--theme-mono-font: "JetBrains Mono", monospace !important;',
    );
    expect(result.standaloneHtml).toContain("--theme-editor-font-size: 18px !important;");
    expect(result.standaloneHtml).toContain("font-family: var(--theme-font) !important;");

    // Ensure user font is cascaded AFTER customCss
    const themeFontPos = result.standaloneHtml.indexOf('"Default Theme Font"');
    const userFontPos = result.standaloneHtml.indexOf('"LXGW WenKai"');
    expect(themeFontPos).toBeGreaterThan(-1);
    expect(userFontPos).toBeGreaterThan(themeFontPos);
  });
});
