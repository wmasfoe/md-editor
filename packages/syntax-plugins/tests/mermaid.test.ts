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
import {
  mermaidPlugin,
  mermaidMarkdownExtension,
  MERMAID_NODES,
  renderMermaidSvg,
} from "../src/index.ts";

describe("mermaidPlugin (@md-editor/syntax-plugins)", () => {
  describe("Incremental safety & fallback", () => {
    it("safely falls back to standard CommonMark FencedCode when plugin is absent", () => {
      const doc = "```mermaid\ngraph TD;\nA-->B;\n```";
      const diagnostics = new WysiwygDiagnostics();
      const state = EditorState.create({
        doc,
        extensions: [markdown(), provideWysiwygDiagnostics(diagnostics), markdownRangeIndexField],
      });

      const index = state.field(markdownRangeIndexField);
      // 未加载插件时，不应产生 MermaidBlock 节点
      const mermaidRecords = index.records.filter((r) => r.nodeName === MERMAID_NODES.MermaidBlock);
      expect(mermaidRecords).toHaveLength(0);

      // 但标准代码块正常存在
      const codeRecords = index.records.filter((r) => r.kind === "deferred-code");
      expect(codeRecords).toHaveLength(1);
    });
  });

  describe("Mermaid block parsing & range index", () => {
    it("parses ```mermaid fenced block and extracts diagram code", () => {
      const doc = "```mermaid\ngraph TD\n  Client --> Server\n```";
      const diagnostics = new WysiwygDiagnostics();
      const registry = new SyntaxPluginRegistry([mermaidPlugin]);

      const state = EditorState.create({
        doc,
        extensions: [
          markdown({ extensions: [mermaidMarkdownExtension] }),
          syntaxPluginRegistryFacet.of(registry),
          provideWysiwygDiagnostics(diagnostics),
          markdownRangeIndexField,
        ],
      });

      const index = state.field(markdownRangeIndexField);
      const mermaidRecord = index.records.find((r) => r.nodeName === MERMAID_NODES.MermaidBlock);
      expect(mermaidRecord).toBeDefined();
      expect(mermaidRecord?.metadata?.mermaid).toEqual(
        expect.objectContaining({
          code: "graph TD\n  Client --> Server",
        }),
      );
    });

    it("does not treat other languages like ```ts as MermaidBlock", () => {
      const doc = "```ts\nconst x = 1;\n```";
      const registry = new SyntaxPluginRegistry([mermaidPlugin]);

      const state = EditorState.create({
        doc,
        extensions: [
          markdown({ extensions: [mermaidMarkdownExtension] }),
          syntaxPluginRegistryFacet.of(registry),
          markdownRangeIndexField,
        ],
      });

      const index = state.field(markdownRangeIndexField);
      const mermaidRecord = index.records.find((r) => r.nodeName === MERMAID_NODES.MermaidBlock);
      expect(mermaidRecord).toBeUndefined();

      const codeRecords = index.records.filter((r) => r.kind === "deferred-code");
      expect(codeRecords).toHaveLength(1);
    });

    it("parses ```mermaid nested inside blockquote and strips quote prefix", () => {
      const doc = "> ```mermaid\n> graph TD\n>   A --> B\n> ```";
      const registry = new SyntaxPluginRegistry([mermaidPlugin]);

      const state = EditorState.create({
        doc,
        extensions: [
          markdown({ extensions: [mermaidMarkdownExtension] }),
          syntaxPluginRegistryFacet.of(registry),
          markdownRangeIndexField,
        ],
      });

      const index = state.field(markdownRangeIndexField);
      const mermaidRecord = index.records.find((r) => r.nodeName === MERMAID_NODES.MermaidBlock);
      expect(mermaidRecord).toBeDefined();
      expect(mermaidRecord?.metadata?.mermaid).toEqual(
        expect.objectContaining({
          code: "graph TD\n  A --> B",
        }),
      );

      const quoteRecord = index.records.find((r) => r.nodeName === "Blockquote");
      expect(quoteRecord).toBeDefined();
      expect(quoteRecord?.markerRanges.length).toBe(4);
    });

    it("strips list-item structural indentation for mermaid block per CommonMark 4.5", () => {
      const doc = "- 列表项\n  ```mermaid\n  graph TD\n    A --> B\n  ```";
      const registry = new SyntaxPluginRegistry([mermaidPlugin]);

      const state = EditorState.create({
        doc,
        extensions: [
          markdown({ extensions: [mermaidMarkdownExtension] }),
          syntaxPluginRegistryFacet.of(registry),
          markdownRangeIndexField,
        ],
      });

      const index = state.field(markdownRangeIndexField);
      const mermaidRecord = index.records.find((r) => r.nodeName === MERMAID_NODES.MermaidBlock);
      expect(mermaidRecord).toBeDefined();
      // 结构缩进 2 格被剔除，但图表内部相对缩进保留
      expect(mermaidRecord?.metadata?.mermaid).toEqual(
        expect.objectContaining({
          code: "graph TD\n  A --> B",
        }),
      );
    });
  });

  describe("WYSIWYG layout decorations", () => {
    it("produces block replace widget when inactive and marker marks when active", () => {
      const doc = "```mermaid\ngraph TD\n  A --> B\n```";
      const registry = new SyntaxPluginRegistry([mermaidPlugin]);
      const state = EditorState.create({
        doc,
        extensions: [
          markdown({ extensions: [mermaidMarkdownExtension] }),
          syntaxPluginRegistryFacet.of(registry),
          markdownRangeIndexField,
        ],
      });

      const index = state.field(markdownRangeIndexField);
      const mermaidRecord = index.records.find((r) => r.nodeName === MERMAID_NODES.MermaidBlock);
      expect(mermaidRecord).toBeDefined();

      // 非激活态：整块替换为图表 Widget
      const inactiveDecos = registry.buildDecorations(mermaidRecord!, state, {
        active: false,
        selected: false,
      });
      expect(inactiveDecos).toHaveLength(1);
      expect(inactiveDecos[0].from).toBe(mermaidRecord!.fullRange.from);
      expect(inactiveDecos[0].to).toBe(mermaidRecord!.fullRange.to);

      // 激活态：原位展开源码，高亮首尾 fence
      const activeDecos = registry.buildDecorations(mermaidRecord!, state, {
        active: true,
        selected: false,
      });
      expect(activeDecos).toHaveLength(2); // opening and closing fence marks
    });
  });

  describe("SVG rendering", () => {
    it("handles empty or whitespace gracefully", async () => {
      const result = await renderMermaidSvg("");
      expect(result.svg).toBe("");
    });

    it("isolates syntax errors without throwing unhandled exceptions", async () => {
      const result = await renderMermaidSvg("invalid graph syntax %% %%% broken");
      // 语法错误时应返回 error 说明，不抛出异常
      expect(result.error).toBeDefined();
    });
  });
});
