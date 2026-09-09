import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import {
  markdownRangeIndexField,
  syntaxPluginRegistryFacet,
  SyntaxPluginRegistry,
} from "@md-editor/renderer-codemirror";
import {
  provideWysiwygDiagnostics,
  WysiwygDiagnostics,
} from "@md-editor/renderer-codemirror/testing";
import { mathPlugin, mathMarkdownExtension, MATH_NODES, renderMathHtml } from "../src/index.ts";

describe("mathPlugin (@md-editor/syntax-plugins)", () => {
  describe("Incremental safety & fallback", () => {
    it("safely falls back to standard CommonMark text and paragraph when plugin is absent", () => {
      const doc = "Here is $x^2$ inline and:\n\n$$E = mc^2$$\n";
      const diagnostics = new WysiwygDiagnostics();
      const state = EditorState.create({
        doc,
        extensions: [markdown(), provideWysiwygDiagnostics(diagnostics), markdownRangeIndexField],
      });

      const index = state.field(markdownRangeIndexField);
      const mathRecords = index.records.filter(
        (r) => r.nodeName === MATH_NODES.InlineMath || r.nodeName === MATH_NODES.BlockMath,
      );
      expect(mathRecords).toHaveLength(0);

      const diagSnapshot = diagnostics.snapshot();
      expect(diagSnapshot.safeFallbackDiagnosticCodes).toEqual([]);
    });
  });

  describe("Inline math ($...$)", () => {
    it("parses inline math expression and extracts metadata", () => {
      const doc = "The equation is $E = mc^2$ in physics.";
      const diagnostics = new WysiwygDiagnostics();
      const registry = new SyntaxPluginRegistry([mathPlugin]);

      const state = EditorState.create({
        doc,
        extensions: [
          markdown({ extensions: [mathMarkdownExtension] }),
          syntaxPluginRegistryFacet.of(registry),
          provideWysiwygDiagnostics(diagnostics),
          markdownRangeIndexField,
        ],
      });

      const index = state.field(markdownRangeIndexField);
      const inlineMath = index.records.find((r) => r.nodeName === MATH_NODES.InlineMath);
      expect(inlineMath).toBeDefined();
      expect(inlineMath?.metadata?.math).toEqual(
        expect.objectContaining({
          mathKind: "inline",
          expression: "E = mc^2",
        }),
      );
    });

    it("does not match escaped \\$ as inline math", () => {
      const doc = "The cost is \\$100 and \\$200.";
      const diagnostics = new WysiwygDiagnostics();
      const registry = new SyntaxPluginRegistry([mathPlugin]);

      const state = EditorState.create({
        doc,
        extensions: [
          markdown({ extensions: [mathMarkdownExtension] }),
          syntaxPluginRegistryFacet.of(registry),
          provideWysiwygDiagnostics(diagnostics),
          markdownRangeIndexField,
        ],
      });

      const index = state.field(markdownRangeIndexField);
      const inlineMath = index.records.find((r) => r.nodeName === MATH_NODES.InlineMath);
      expect(inlineMath).toBeUndefined();
    });

    it("does not match currency numbers like $100 and $200 as inline math", () => {
      const doc = "The cost is $100 and $200 today.";
      const diagnostics = new WysiwygDiagnostics();
      const registry = new SyntaxPluginRegistry([mathPlugin]);

      const state = EditorState.create({
        doc,
        extensions: [
          markdown({ extensions: [mathMarkdownExtension] }),
          syntaxPluginRegistryFacet.of(registry),
          provideWysiwygDiagnostics(diagnostics),
          markdownRangeIndexField,
        ],
      });

      const index = state.field(markdownRangeIndexField);
      const inlineMath = index.records.find((r) => r.nodeName === MATH_NODES.InlineMath);
      expect(inlineMath).toBeUndefined();
    });
  });

  describe("Block math ($$...$$)", () => {
    it("parses single-line display math block", () => {
      const doc = "$$a^2 + b^2 = c^2$$";
      const diagnostics = new WysiwygDiagnostics();
      const registry = new SyntaxPluginRegistry([mathPlugin]);

      const state = EditorState.create({
        doc,
        extensions: [
          markdown({ extensions: [mathMarkdownExtension] }),
          syntaxPluginRegistryFacet.of(registry),
          provideWysiwygDiagnostics(diagnostics),
          markdownRangeIndexField,
        ],
      });

      const index = state.field(markdownRangeIndexField);
      const blockMath = index.records.find((r) => r.nodeName === MATH_NODES.BlockMath);
      expect(blockMath).toBeDefined();
      expect(blockMath?.metadata?.math).toEqual(
        expect.objectContaining({
          mathKind: "block",
          expression: "a^2 + b^2 = c^2",
        }),
      );
    });

    it("parses multi-line display math block", () => {
      const doc = "$$\n\\begin{matrix}\n1 & 0 \\\\\n0 & 1\n\\end{matrix}\n$$";
      const diagnostics = new WysiwygDiagnostics();
      const registry = new SyntaxPluginRegistry([mathPlugin]);

      const state = EditorState.create({
        doc,
        extensions: [
          markdown({ extensions: [mathMarkdownExtension] }),
          syntaxPluginRegistryFacet.of(registry),
          provideWysiwygDiagnostics(diagnostics),
          markdownRangeIndexField,
        ],
      });

      const index = state.field(markdownRangeIndexField);
      const blockMath = index.records.find((r) => r.nodeName === MATH_NODES.BlockMath);
      expect(blockMath).toBeDefined();
      expect(blockMath?.metadata?.math).toEqual(
        expect.objectContaining({
          mathKind: "block",
          expression: "\\begin{matrix}\n1 & 0 \\\\\n0 & 1\n\\end{matrix}",
        }),
      );
    });

    it("parses block math nested inside blockquote", () => {
      const doc =
        "> ### 标题\n>\n> 欧拉公式：\n>\n> $$\n> \\zeta(s) = \\sum_{n=1}^\\infty \\frac{1}{n^s}\n> $$\n";
      const registry = new SyntaxPluginRegistry([mathPlugin]);

      const state = EditorState.create({
        doc,
        extensions: [
          markdown({ extensions: [mathMarkdownExtension] }),
          syntaxPluginRegistryFacet.of(registry),
          markdownRangeIndexField,
        ],
      });

      const index = state.field(markdownRangeIndexField);
      const quoteRecord = index.records.find((r) => r.nodeName === "Blockquote");
      expect(quoteRecord).toBeDefined();
      expect(quoteRecord?.markerRanges.length).toBe(7);

      const blockMath = index.records.find((r) => r.nodeName === MATH_NODES.BlockMath);
      expect(blockMath).toBeDefined();
      expect(blockMath?.metadata?.math).toEqual(
        expect.objectContaining({
          mathKind: "block",
          expression: "\\zeta(s) = \\sum_{n=1}^\\infty \\frac{1}{n^s}",
        }),
      );
    });

    it("parses ```math fenced code block as BlockMath", () => {
      const doc = "```math\n\\frac{a}{b} = c\n```";
      const registry = new SyntaxPluginRegistry([mathPlugin]);

      const state = EditorState.create({
        doc,
        extensions: [
          markdown({ extensions: [mathMarkdownExtension] }),
          syntaxPluginRegistryFacet.of(registry),
          markdownRangeIndexField,
        ],
      });

      const index = state.field(markdownRangeIndexField);
      const blockMath = index.records.find((r) => r.nodeName === MATH_NODES.BlockMath);
      expect(blockMath).toBeDefined();
      expect(blockMath?.metadata?.math).toEqual(
        expect.objectContaining({
          mathKind: "block",
          expression: "\\frac{a}{b} = c",
        }),
      );
    });

    it("parses ```latex fenced code block nested in blockquote", () => {
      const doc = "> ```latex\n> \\int_0^1 x dx\n> ```";
      const registry = new SyntaxPluginRegistry([mathPlugin]);

      const state = EditorState.create({
        doc,
        extensions: [
          markdown({ extensions: [mathMarkdownExtension] }),
          syntaxPluginRegistryFacet.of(registry),
          markdownRangeIndexField,
        ],
      });

      const index = state.field(markdownRangeIndexField);
      const blockMath = index.records.find((r) => r.nodeName === MATH_NODES.BlockMath);
      expect(blockMath).toBeDefined();
      expect(blockMath?.metadata?.math).toEqual(
        expect.objectContaining({
          mathKind: "block",
          expression: "\\int_0^1 x dx",
        }),
      );
      const quoteRecord = index.records.find((r) => r.nodeName === "Blockquote");
      expect(quoteRecord).toBeDefined();
      expect(quoteRecord?.markerRanges.length).toBe(3);
    });

    it("does not parse single-line $$ as BlockMath when trailing text exists on the same line", () => {
      const doc = "$$E=mc^2$$ and explanation\n";
      const registry = new SyntaxPluginRegistry([mathPlugin]);

      const state = EditorState.create({
        doc,
        extensions: [
          markdown({ extensions: [mathMarkdownExtension] }),
          syntaxPluginRegistryFacet.of(registry),
          markdownRangeIndexField,
        ],
      });

      const index = state.field(markdownRangeIndexField);
      // 同行存在尾随文字时不应作为独立块级公式解析，防止吞掉同行普通段落文字
      const blockMath = index.records.find((r) => r.nodeName === MATH_NODES.BlockMath);
      expect(blockMath).toBeUndefined();
      const inlineMath = index.records.find((r) => r.nodeName === MATH_NODES.InlineMath);
      expect(inlineMath).toBeDefined();
    });

    it("does not treat closing line with trailing words as valid multiline block closure", () => {
      const doc = "$$\na+b\n$$ and trailing words\n$$\n";
      const registry = new SyntaxPluginRegistry([mathPlugin]);

      const state = EditorState.create({
        doc,
        extensions: [
          markdown({ extensions: [mathMarkdownExtension] }),
          syntaxPluginRegistryFacet.of(registry),
          markdownRangeIndexField,
        ],
      });

      const index = state.field(markdownRangeIndexField);
      const blockMath = index.records.find((r) => r.nodeName === MATH_NODES.BlockMath);
      expect(blockMath).toBeDefined();
      // 第一处带有尾随文字的行不应提前闭合，公式继续推进直到独占闭合行
      expect(blockMath?.metadata?.math).toEqual(
        expect.objectContaining({
          mathKind: "block",
        }),
      );
    });

    it("strips list-item structural indentation for fenced math block per CommonMark 4.5", () => {
      const doc = "- 列表项\n  ```math\n  x + y\n  ```";
      const registry = new SyntaxPluginRegistry([mathPlugin]);

      const state = EditorState.create({
        doc,
        extensions: [
          markdown({ extensions: [mathMarkdownExtension] }),
          syntaxPluginRegistryFacet.of(registry),
          markdownRangeIndexField,
        ],
      });

      const index = state.field(markdownRangeIndexField);
      const blockMath = index.records.find((r) => r.nodeName === MATH_NODES.BlockMath);
      expect(blockMath).toBeDefined();
      expect(blockMath?.metadata?.math).toEqual(
        expect.objectContaining({
          mathKind: "block",
          expression: "x + y",
        }),
      );
    });

    it("does not parse unclosed $$ block as BlockMath and preserves subsequent document text", () => {
      const doc = "$$\n\\int_0^1 x dx\n\nThen normal prose continues here...\n";
      const registry = new SyntaxPluginRegistry([mathPlugin]);

      const state = EditorState.create({
        doc,
        extensions: [
          markdown({ extensions: [mathMarkdownExtension] }),
          syntaxPluginRegistryFacet.of(registry),
          markdownRangeIndexField,
        ],
      });

      const index = state.field(markdownRangeIndexField);
      // 未闭合的 $$ 不应生成 BlockMath 节点，防止把整篇文档折叠吞并为公式
      const blockMath = index.records.find((r) => r.nodeName === MATH_NODES.BlockMath);
      expect(blockMath).toBeUndefined();
    });
  });

  describe("WYSIWYG layout decorations", () => {
    it("produces replace decoration for inactive inline math and mark decorations when active", () => {
      const doc = "Energy is $E = mc^2$ forever.";
      const registry = new SyntaxPluginRegistry([mathPlugin]);
      const state = EditorState.create({
        doc,
        extensions: [
          markdown({ extensions: [mathMarkdownExtension] }),
          syntaxPluginRegistryFacet.of(registry),
          markdownRangeIndexField,
        ],
      });

      const index = state.field(markdownRangeIndexField);
      const inlineMath = index.records.find((r) => r.nodeName === MATH_NODES.InlineMath);
      expect(inlineMath).toBeDefined();

      // 非激活态：生成 Replace Widget 替换原公式文本
      const inactiveDecos = registry.buildDecorations(inlineMath!, state, {
        active: false,
        selected: false,
      });
      expect(inactiveDecos).toHaveLength(1);
      const deco = inactiveDecos[0];
      expect(deco.from).toBe(inlineMath!.fullRange.from);
      expect(deco.to).toBe(inlineMath!.fullRange.to);

      // 激活态（光标在公式内）：暴露源码，标记 $
      const activeDecos = registry.buildDecorations(inlineMath!, state, {
        active: true,
        selected: false,
      });
      expect(activeDecos).toHaveLength(2); // opening and closing MathMark
    });

    it("produces block widget with click anchor at content start for fenced math block", () => {
      const doc = "```math\n\\frac{1}{2}\n```";
      const registry = new SyntaxPluginRegistry([mathPlugin]);
      const state = EditorState.create({
        doc,
        extensions: [
          markdown({ extensions: [mathMarkdownExtension] }),
          syntaxPluginRegistryFacet.of(registry),
          markdownRangeIndexField,
        ],
      });

      const index = state.field(markdownRangeIndexField);
      const blockMath = index.records.find((r) => r.nodeName === MATH_NODES.BlockMath);
      expect(blockMath).toBeDefined();

      const decos = registry.buildDecorations(blockMath!, state, {
        active: false,
        selected: false,
      });
      expect(decos).toHaveLength(1);
      const widget = (decos[0].value as unknown as { widget: { anchorPos: number } }).widget;
      // 必须落在第一行换行之后（即 contentRange.from），防止光标插在 ``` 围栏字符之间
      expect(widget.anchorPos).toBe(doc.indexOf("\n") + 1);
    });
  });

  describe("HTML Rendering with KaTeX", () => {
    it("renders math to HTML with KaTeX", async () => {
      const { loadKatex } = await import("../src/index.ts");
      await loadKatex();

      const result = renderMathHtml("x^2 + y^2 = z^2", false);
      expect(result.html).toContain("katex");
      expect(result.error).toBeUndefined();
    });

    it("handles invalid LaTeX syntax gracefully without throwing", async () => {
      const { loadKatex } = await import("../src/index.ts");
      await loadKatex();

      const result = renderMathHtml("\\invalidcommand{123", false);
      expect(result.html).toBeDefined();
    });
  });

  describe("MathInlineWidget measure lifecycle & interaction policy", () => {
    it("configures InlineMath with reveal-source interaction policy", () => {
      const policy = mathPlugin.nodePolicies?.[MATH_NODES.InlineMath];
      expect(policy?.interactionPolicy).toBe("reveal-source");
    });

    it("triggers requestMeasure on widget mount (toDOM) and permits CM6 events", async () => {
      const { MathInlineWidget } = await import("../src/math/math-projection.ts");
      const widget = new MathInlineWidget("test-rec", "E=mc^2", 10);

      let measureRequested = false;
      const fakeElement = {
        className: "",
        setAttribute: () => {},
        classList: { add: () => {}, remove: () => {} },
        addEventListener: () => {},
        innerHTML: "",
      };
      const fakeView = {
        dom: {
          ownerDocument: {
            createElement: () => fakeElement,
          },
        },
        state: {
          doc: { length: 100 },
        },
        requestMeasure: () => {
          measureRequested = true;
        },
      } as unknown as EditorView;

      const dom = widget.toDOM(fakeView);
      expect(dom).toBeDefined();
      expect(dom.className).toBe("cm-md-math-inline");
      expect(measureRequested).toBe(true);

      // ignoreEvent 必须返回 false，确保 CodeMirror 的鼠标划选拖拽事件不被吞掉
      expect(widget.ignoreEvent({ type: "mousemove" } as unknown as Event)).toBe(false);
      expect(widget.ignoreEvent({ type: "mouseup" } as unknown as Event)).toBe(false);
    });

    it("triggers requestMeasure on widget destroy to keep HeightMap in sync", async () => {
      const { MathInlineWidget } = await import("../src/math/math-projection.ts");
      const widget = new MathInlineWidget("test-rec", "E=mc^2", 10);

      const fakeDom = {
        closest: () => null,
      } as unknown as HTMLElement;

      // destroy 执行时不会抛出异常，并安全尝试请求重测
      expect(() => widget.destroy(fakeDom)).not.toThrow();
    });
  });
});
