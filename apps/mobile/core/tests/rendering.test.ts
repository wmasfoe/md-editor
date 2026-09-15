import { describe, it, expect, vi } from "vitest";
import { renderStaticHtml } from "@md-editor/compiler";
import {
  preprocessDirectives,
  preprocessAndRenderMath,
  postprocessMathHtml,
} from "../src/lib/plugin-renderer.ts";

describe("Mobile Web Rendering Contract Tests", () => {
  it("should render markdown bold text with cm-md-bold and cm-md-marker classes", () => {
    const markdown = "这是 **加粗文本** 测试";
    const result = renderStaticHtml(markdown);

    expect(result.html).toContain('class="cm-md-marker cm-md-marker--bold">**</span>');
    expect(result.html).toContain('class="cm-md-inline cm-md-bold">加粗文本</strong>');
  });

  it("should render markdown italic and strikethrough with correct classes", () => {
    const markdown = "这是 *斜体文本* 与 ~~删除线文本~~";
    const result = renderStaticHtml(markdown);

    expect(result.html).toContain('class="cm-md-inline cm-md-italic">斜体文本</em>');
    expect(result.html).toContain('class="cm-md-inline cm-md-strikethrough">删除线文本</del>');
  });

  it("should preprocess container directives into GFM alerts with correct title and icon", () => {
    const markdown = "::: tip 效率指南\n这是提示内容\n:::";
    const withDirectives = preprocessDirectives(markdown);
    const result = renderStaticHtml(withDirectives);

    expect(result.html).toContain('class="cm-callout cm-callout--tip"');
    expect(result.html).toContain('class="cm-callout__title">效率指南</strong>');
    expect(result.html).toContain("<p>这是提示内容</p>");
  });

  it("should preprocess and render LaTeX math expressions", async () => {
    const { loadKatex } = await import("@md-editor/syntax-plugins");
    await loadKatex();

    const markdown = "公式 $E = mc^2$ 与块级公式：\n\n$$\\int_0^1 x dx$$";
    const { markdown: processed, mathTokens } = preprocessAndRenderMath(markdown);
    const result = renderStaticHtml(processed);
    const finalHtml = postprocessMathHtml(result.html, mathTokens);

    expect(finalHtml).toContain('class="cm-md-math-inline"');
    expect(finalHtml).toContain('class="cm-md-math-block');
    expect(finalHtml).toContain("katex");
  });

  it("should preserve language-mermaid in code blocks and hydrate into SVG container", async () => {
    const { hydrateMermaid } = await import("../src/lib/plugin-renderer.ts");
    const markdown = "```mermaid\ngraph TD\n  A --> B\n```";
    const result = renderStaticHtml(markdown);

    expect(result.html).toContain('class="hljs language-mermaid"');

    // 在 Node 环境下模拟基础 DOM 节点测试水合管道
    interface MockElement {
      tagName: string;
      className: string;
      innerHTML: string;
      setAttribute(k: string, v: string): void;
      getAttribute(k: string): string | null;
    }

    const mockElements: MockElement[] = [];
    const mockPre = {
      attributes: {} as Record<string, string>,
      getAttribute(k: string) {
        return this.attributes[k] || null;
      },
      setAttribute(k: string, v: string) {
        this.attributes[k] = v;
      },
      replaceWith(newNode: unknown) {
        mockElements.push(newNode as MockElement);
      },
    };
    const mockCode = {
      textContent: "graph TD\n  A --> B",
      parentElement: mockPre,
    };
    const mockContainer = {
      querySelectorAll(selector: string) {
        if (selector.includes("language-mermaid")) {
          return [mockCode];
        }
        return [];
      },
    };

    // 确保 document.createElement 在 Node 测试环境下可用
    const globalScope = globalThis as unknown as { document?: unknown };
    const originalDoc = globalScope.document;
    globalScope.document = {
      createElement(tag: string): MockElement {
        const attrs: Record<string, string> = {};
        return {
          tagName: tag.toUpperCase(),
          className: "",
          innerHTML: "",
          setAttribute(k: string, v: string) {
            attrs[k] = v;
          },
          getAttribute(k: string) {
            return attrs[k] || null;
          },
        };
      },
    };

    const syntaxPlugins = await import("@md-editor/syntax-plugins");
    const renderSpy = vi.spyOn(syntaxPlugins, "renderMermaidSvg").mockResolvedValue({
      svg: "<svg class='mermaid-svg'>mock</svg>",
    });

    try {
      await hydrateMermaid(mockContainer as unknown as HTMLElement, false);
      expect(mockPre.getAttribute("data-mermaid-hydrated")).toBe("true");
      expect(mockElements).toHaveLength(1);
      expect(mockElements[0].className).toBe("cm-md-mermaid-container my-4");
      expect(mockElements[0].getAttribute("data-mermaid-code")).toContain("graph TD");
      expect(mockElements[0].innerHTML).toContain("mermaid-svg");
    } finally {
      renderSpy.mockRestore();
      globalScope.document = originalDoc;
    }
  });

  it("should extract structured outline with correct levels and IDs", async () => {
    const { extractOutline } = await import("../src/lib/plugin-renderer.ts");
    const markdown = `# 主标题
一些内容
## 快速入门
更多内容
### 安装依赖
- pnpm install
## 架构设计`;

    const outline = extractOutline(markdown);
    expect(outline).toHaveLength(4);
    expect(outline[0]).toEqual({
      level: 1,
      text: "主标题",
      id: "主标题",
    });
    expect(outline[1]).toEqual({
      level: 2,
      text: "快速入门",
      id: "快速入门",
    });
    expect(outline[2]).toEqual({
      level: 3,
      text: "安装依赖",
      id: "安装依赖",
    });
    expect(outline[3]).toEqual({
      level: 2,
      text: "架构设计",
      id: "架构设计",
    });
  });
});
