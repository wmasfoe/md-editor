import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
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
});
