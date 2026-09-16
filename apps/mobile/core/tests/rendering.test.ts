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

  it("should render GFM task list items with checkbox and inline text without redundant [x] text", () => {
    const markdown = `- [x] CodeMirror 6 移动端极速自绘选区
- [x] 官方插件全面接入（高亮、容器指令、KaTeX、Mermaid）
- [ ] 跨端本地局域网点对点实时协作`;
    const result = renderStaticHtml(markdown);

    expect(result.html).toContain('class="contains-task-list"');
    expect(result.html).toContain('class="task-list-item"');
    expect(result.html).toContain('<input type="checkbox" checked="" disabled="">');
    expect(result.html).toContain('<input type="checkbox" disabled="">');
    expect(result.html).toContain("CodeMirror 6 移动端极速自绘选区");
    expect(result.html).toContain("跨端本地局域网点对点实时协作");
    expect(result.html).not.toContain("[x]");
    expect(result.html).not.toContain("[ ]");
    expect(result.html).not.toContain("<p>");
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

  it("should gracefully skip replacing detached pre elements if disconnected during async render", async () => {
    const { hydrateMermaid } = await import("../src/lib/plugin-renderer.ts");

    interface MockElement {
      tagName: string;
      className: string;
      innerHTML: string;
      setAttribute(k: string, v: string): void;
      getAttribute(k: string): string | null;
    }

    const mockElements: MockElement[] = [];
    const mockPre = {
      isConnected: false, // 模拟在异步渲染期间节点已被 React 重绘卸载
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
      contains(_node: unknown) {
        return false; // 容器已不再包含该节点
      },
      querySelectorAll(selector: string) {
        if (selector.includes("language-mermaid")) {
          return [mockCode];
        }
        return [];
      },
    };

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
      // 标记过已尝试水合
      expect(mockPre.getAttribute("data-mermaid-hydrated")).toBe("true");
      // 但由于已脱离 DOM，replaceWith 不应被调用，避免操作失效节点
      expect(mockElements).toHaveLength(0);
    } finally {
      renderSpy.mockRestore();
      globalScope.document = originalDoc;
    }
  });

  it("should re-bind and replace newly rendered pre element when container re-rendered during async render", async () => {
    const { hydrateMermaid } = await import("../src/lib/plugin-renderer.ts");

    interface MockElement {
      tagName: string;
      className: string;
      innerHTML: string;
      setAttribute(k: string, v: string): void;
      getAttribute(k: string): string | null;
    }

    const mockElements: MockElement[] = [];
    const detachedPre = {
      isConnected: false,
      attributes: {} as Record<string, string>,
      getAttribute(k: string) {
        return this.attributes[k] || null;
      },
      setAttribute(k: string, v: string) {
        this.attributes[k] = v;
      },
      replaceWith() {
        throw new Error("Should not call replaceWith on detached element");
      },
    };
    const detachedCode = {
      textContent: "graph TD\n  A --> B",
      parentElement: detachedPre,
    };

    const newPre = {
      isConnected: true,
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
    const newCode = {
      textContent: "graph TD\n  A --> B",
      parentElement: newPre,
    };

    let initialQuery = true;
    const mockContainer = {
      contains(node: unknown) {
        return node === newPre;
      },
      querySelectorAll(selector: string) {
        if (selector.includes("language-mermaid")) {
          if (initialQuery) {
            initialQuery = false;
            return [detachedCode];
          }
          return [newCode];
        }
        return [];
      },
    };

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
      expect(mockElements).toHaveLength(1);
      expect(mockElements[0].className).toBe("cm-md-mermaid-container my-4");
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
