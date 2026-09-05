import { markdown } from "@codemirror/lang-markdown";
import { EditorSelection, EditorState, type StateEffect } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { createDocumentState } from "@md-editor/editor-core";
import {
  markdownRangeIndexField,
  syntaxPluginRegistryFacet,
  SyntaxPluginRegistry,
} from "@md-editor/renderer-codemirror";
import {
  createCodeMirrorRendererWithFactory,
  provideWysiwygDiagnostics,
  WysiwygDiagnostics,
} from "@md-editor/renderer-codemirror/testing";
import {
  containerDirectivePlugin,
  directiveMarkdownExtension,
  buildDirectiveLayoutDecorations,
} from "../src/index.ts";

describe("containerDirectivePlugin (@md-editor/syntax-plugins)", () => {
  describe("Incremental safety & fallback", () => {
    it("safely falls back to standard CommonMark paragraph when plugin is absent", () => {
      const doc = `:::info 架构优势\n编辑器渲染基于 CodeMirror 6\n:::`;
      const diagnostics = new WysiwygDiagnostics();
      const state = EditorState.create({
        doc,
        extensions: [markdown(), provideWysiwygDiagnostics(diagnostics), markdownRangeIndexField],
      });

      const index = state.field(markdownRangeIndexField);
      // 无插件时，不应产生 directive 类型的记录，也不应抛出任何错误
      const directiveRecords = index.records.filter((r) => r.kind === "directive");
      expect(directiveRecords).toHaveLength(0);

      const diagSnapshot = diagnostics.snapshot();
      expect(diagSnapshot.safeFallbackDiagnosticCodes).toEqual([]);
    });
  });

  describe("AST parsing & range index", () => {
    it("parses container directive with type and custom title", () => {
      const doc = `:::info 架构优势\n编辑器渲染基于 CodeMirror 6\n:::`;
      const diagnostics = new WysiwygDiagnostics();
      const registry = new SyntaxPluginRegistry([containerDirectivePlugin]);

      const state = EditorState.create({
        doc,
        extensions: [
          markdown({ extensions: [directiveMarkdownExtension] }),
          syntaxPluginRegistryFacet.of(registry),
          provideWysiwygDiagnostics(diagnostics),
          markdownRangeIndexField,
        ],
      });

      const index = state.field(markdownRangeIndexField);
      const directiveRecords = index.records.filter((r) => r.kind === "directive");
      expect(directiveRecords).toHaveLength(1);

      const [record] = directiveRecords;
      expect(record.renderPolicy).toBe("directive-panel");
      expect(record.directive).toBeDefined();
      expect(record.directive?.directiveType).toBe("info");
      expect(record.directive?.title).toBe("架构优势");
      expect(record.contentRange).toBeDefined();
      expect(record.contentRange?.from).toBe(":::info 架构优势\n".length);
      expect(record.contentRange?.to).toBe(doc.length - "\n:::".length);
    });

    it("parses container directive with default title when title is omitted", () => {
      const doc = `:::tip\n提示正文内容\n:::`;
      const registry = new SyntaxPluginRegistry([containerDirectivePlugin]);
      const state = EditorState.create({
        doc,
        extensions: [
          markdown({ extensions: [directiveMarkdownExtension] }),
          syntaxPluginRegistryFacet.of(registry),
          markdownRangeIndexField,
        ],
      });

      const index = state.field(markdownRangeIndexField);
      const record = index.records.find((r) => r.kind === "directive");
      expect(record).toBeDefined();
      expect(record?.directive?.directiveType).toBe("tip");
      expect(record?.directive?.title).toBe("Tip");
    });

    it("ignores ::: inside nested fenced code block without premature closing", () => {
      const doc = [
        ":::warning 嵌套代码测试",
        "这里是正文",
        "```markdown",
        ":::info 不应闭合",
        "```",
        "外部容器继续",
        ":::",
      ].join("\n");

      const registry = new SyntaxPluginRegistry([containerDirectivePlugin]);
      const state = EditorState.create({
        doc,
        extensions: [
          markdown({ extensions: [directiveMarkdownExtension] }),
          syntaxPluginRegistryFacet.of(registry),
          markdownRangeIndexField,
        ],
      });

      const index = state.field(markdownRangeIndexField);
      const directiveRecords = index.records.filter((r) => r.kind === "directive");
      expect(directiveRecords).toHaveLength(1);

      const [record] = directiveRecords;
      expect(record.fullRange.from).toBe(0);
      expect(record.fullRange.to).toBe(doc.length);
      expect(record.directive?.title).toBe("嵌套代码测试");
    });
  });

  describe("WYSIWYG layout decorations", () => {
    it("generates line decorations and replaces header with widget when not active", () => {
      const doc = `:::danger 危险警告\n系统核心参数不可变\n:::`;
      const registry = new SyntaxPluginRegistry([containerDirectivePlugin]);
      const state = EditorState.create({
        doc,
        selection: EditorSelection.single(0), // 光标在 0，但首行激活检查判断区间
        extensions: [
          markdown({ extensions: [directiveMarkdownExtension] }),
          syntaxPluginRegistryFacet.of(registry),
          markdownRangeIndexField,
        ],
      });

      const index = state.field(markdownRangeIndexField);
      const record = index.records.find((r) => r.kind === "directive")!;
      expect(record).toBeDefined();

      // 将光标移动到容器外部或末尾测试非激活状态
      const inactiveState = EditorState.create({
        doc,
        selection: EditorSelection.single(doc.indexOf("系统")), // 光标在内容行
        extensions: [
          markdown({ extensions: [directiveMarkdownExtension] }),
          syntaxPluginRegistryFacet.of(registry),
          markdownRangeIndexField,
        ],
      });

      const decos = buildDirectiveLayoutDecorations(record, inactiveState);
      expect(decos.length).toBeGreaterThan(0);

      // 验证 Line Decoration
      const lineDecos = decos.filter(
        (d) =>
          (d.value as unknown as { spec?: { wysiwygRole?: string } }).spec?.wysiwygRole ===
          "directive-line",
      );
      expect(lineDecos.length).toBe(3); // 首行、内容行、闭合行共 3 行

      // 验证首行被替换为 Header Widget
      const headerWidgetDecos = decos.filter(
        (d) =>
          (d.value as unknown as { spec?: { wysiwygRole?: string } }).spec?.wysiwygRole ===
          "directive-header-widget",
      );
      expect(headerWidgetDecos).toHaveLength(1);
    });

    it("reveals raw source when cursor focuses on the first line (Inline Disclosure)", () => {
      const doc = `:::info 架构说明\n内容行\n:::`;
      const registry = new SyntaxPluginRegistry([containerDirectivePlugin]);
      // 光标放在第 4 个字符（在首行 :::info 内）
      const activeState = EditorState.create({
        doc,
        selection: EditorSelection.single(4),
        extensions: [
          markdown({ extensions: [directiveMarkdownExtension] }),
          syntaxPluginRegistryFacet.of(registry),
          markdownRangeIndexField,
        ],
      });

      const index = activeState.field(markdownRangeIndexField);
      const record = index.records.find((r) => r.kind === "directive")!;

      const decos = buildDirectiveLayoutDecorations(record, activeState);
      // 首行不应有 replace widget，而应展示 marker
      const headerWidgetDecos = decos.filter(
        (d) =>
          (d.value as unknown as { spec?: { wysiwygRole?: string } }).spec?.wysiwygRole ===
          "directive-header-widget",
      );
      expect(headerWidgetDecos).toHaveLength(0);

      const markerDecos = decos.filter(
        (d) =>
          (d.value as unknown as { spec?: { wysiwygRole?: string } }).spec?.wysiwygRole ===
          "directive-marker-visible",
      );
      expect(markerDecos.length).toBeGreaterThan(0);
    });
  });

  describe("Renderer Integration with plugins", () => {
    it("renders directive when plugin is provided via plugins option", () => {
      const parent = (
        typeof document !== "undefined" ? document.createElement("div") : {}
      ) as HTMLElement;
      const docState = createDocumentState({
        markdown: `:::tip 技巧\n多用快捷键\n:::`,
      });

      let viewState: EditorState | null = null;
      const renderer = createCodeMirrorRendererWithFactory(
        {
          parent,
          initialSnapshot: docState.getSnapshot(),
          onEditorChange: () => {},
          onQueuedExternalEditReady: () => {},
          onQueuedExternalEditCancelled: () => {},
          plugins: [containerDirectivePlugin],
        },
        (input) => {
          viewState = input.state;
          return {
            get state() {
              return viewState!;
            },
            isComposing: false,
            dispatch: () => {},
            dispatchTransaction: () => {},
            setState: (nextState) => {
              viewState = nextState;
            },
            scrollSnapshot: () => ({}) as unknown as StateEffect<unknown>,
            getScrollTop: () => 0,
            setScrollTop: () => {},
            hasFocus: () => false,
            focus: () => {},
            requestMeasure: () => {},
            destroy: () => {},
          };
        },
      );

      expect(renderer.clientId).toBeDefined();
      expect(viewState).toBeDefined();
      const index = viewState!.field(markdownRangeIndexField);
      const directiveRecord = index.records.find((r) => r.kind === "directive");
      expect(directiveRecord).toBeDefined();
      expect(directiveRecord?.directive?.title).toBe("技巧");
    });
  });
});
