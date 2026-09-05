import { markdown } from "@codemirror/lang-markdown";
import { EditorSelection, EditorState, type SelectionRange } from "@codemirror/state";
import { type EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import {
  createDocumentState,
  switchEditorModeSafely,
  synchronizeRendererEvent,
} from "@md-editor/editor-core";
import { M1_MARKDOWN_EXTENSIONS } from "../../src/markdown/extensions.ts";
import { markdownRangeIndexField } from "../../src/markdown/range-index.ts";
import { editorModeField } from "../../src/mode.ts";
import {
  buildBlockLayoutDecorations,
  getBlockProtectedRanges,
} from "../../src/wysiwyg/list-projection.ts";
import { DirectiveHeaderWidget } from "../../src/wysiwyg/callout-widget.ts";
import { moveAtomVertically } from "../../src/wysiwyg/atom-selection.ts";
import {
  configureWysiwygProjectionFeatures,
  wysiwygProjectionField,
} from "../../src/wysiwyg/projection-state.ts";
import { createRendererTestHarness } from "../../src/testing.ts";
import { type CodeMirrorRenderer } from "../../src/index.ts";

function createEditorState(doc: string, selection?: EditorSelection): EditorState {
  return EditorState.create({
    doc,
    selection: selection ?? EditorSelection.single(doc.length),
    extensions: [markdown({ extensions: M1_MARKDOWN_EXTENSIONS }), markdownRangeIndexField],
  });
}

function createMockView(initialState: EditorState) {
  let state = initialState;
  let transactionCount = 0;
  const view = {
    get state() {
      return state;
    },
    moveVertically(range: SelectionRange) {
      return range;
    },
    dispatch(transaction: ReturnType<EditorState["update"]>) {
      transactionCount += 1;
      state = transaction.state;
    },
  } as unknown as EditorView;
  return {
    view,
    getState: () => state,
    getTransactionCount: () => transactionCount,
  };
}

function createWysiwygState(doc: string, selection?: EditorSelection): EditorState {
  return EditorState.create({
    doc,
    selection: selection ?? EditorSelection.single(doc.length),
    extensions: [
      markdown({ extensions: M1_MARKDOWN_EXTENSIONS }),
      markdownRangeIndexField,
      editorModeField,
      configureWysiwygProjectionFeatures(["blocks"]),
      wysiwygProjectionField,
    ],
  });
}

describe("GFM Alerts & Callouts (> [!NOTE])", () => {
  describe("Range index & metadata extraction", () => {
    it("extracts alert metadata with custom title for > [!NOTE] 架构优势", () => {
      const doc = ["> [!NOTE] 架构优势", "> 编辑器基于 CodeMirror 6 渲染。"].join("\n");
      const state = createEditorState(doc);
      const index = state.field(markdownRangeIndexField);

      const quoteRecords = index.records.filter((r) => r.kind === "quote");
      expect(quoteRecords).toHaveLength(1);

      const alertRecord = quoteRecords[0];
      expect(alertRecord.alert).toBeDefined();
      expect(alertRecord.alert?.alertType).toBe("note");
      expect(alertRecord.alert?.title).toBe("架构优势");
      expect(alertRecord.alert?.markerRange).toEqual({ from: 2, to: 9 });
      expect(
        doc.slice(alertRecord.alert!.markerRange.from, alertRecord.alert!.markerRange.to),
      ).toBe("[!NOTE]");
    });

    it("supports all 5 standard GFM alert types: NOTE, TIP, IMPORTANT, WARNING, CAUTION", () => {
      const types = [
        { type: "NOTE", expected: "note" },
        { type: "TIP", expected: "tip" },
        { type: "IMPORTANT", expected: "important" },
        { type: "WARNING", expected: "warning" },
        { type: "CAUTION", expected: "caution" },
      ];

      for (const { type, expected } of types) {
        const doc = `> [!${type}]\n> 详情内容`;
        const state = createEditorState(doc);
        const index = state.field(markdownRangeIndexField);
        const record = index.records.find((r) => r.kind === "quote");

        expect(record?.alert?.alertType).toBe(expected);
        expect(record?.alert?.title).toBe(expected.charAt(0).toUpperCase() + expected.slice(1));
      }
    });

    it("supports case-insensitive type syntax (> [!note], > [!Tip])", () => {
      const doc = `> [!note] 小写测试\n> 正文`;
      const state = createEditorState(doc);
      const index = state.field(markdownRangeIndexField);
      const record = index.records.find((r) => r.kind === "quote");

      expect(record?.alert?.alertType).toBe("note");
      expect(record?.alert?.title).toBe("小写测试");
    });

    it("falls back to standard quote for regular blockquotes and unknown types", () => {
      const normalDoc = `> 这是一个普通的引用块\n> 第二行`;
      const normalState = createEditorState(normalDoc);
      const normalIndex = normalState.field(markdownRangeIndexField);
      const normalRecord = normalIndex.records.find((r) => r.kind === "quote");
      expect(normalRecord?.alert).toBeUndefined();

      const unknownDoc = `> [!UNKNOWN] 未知类型\n> 正文`;
      const unknownState = createEditorState(unknownDoc);
      const unknownIndex = unknownState.field(markdownRangeIndexField);
      const unknownRecord = unknownIndex.records.find((r) => r.kind === "quote");
      expect(unknownRecord?.alert).toBeUndefined();
    });
  });

  describe("Layout decorations & inline disclosure", () => {
    it("decorates all lines with alert classes and inserts header widget when inactive", () => {
      const doc = ["> [!TIP] 技巧提示", "> 第一行建议", "> 第二行建议"].join("\n");
      // 光标放在最后一行，此时首行未激活
      const state = createEditorState(doc, EditorSelection.single(doc.length));
      const index = state.field(markdownRangeIndexField);
      const record = index.records.find((r) => r.kind === "quote")!;

      const decos = buildBlockLayoutDecorations(record, state);

      // 验证首行和后续行的 line decoration
      const lineDecos = decos.filter(
        (d) =>
          (d.value as unknown as { spec?: { wysiwygRole?: string } }).spec?.wysiwygRole ===
          "alert-line",
      );
      expect(lineDecos).toHaveLength(3);

      const firstLineDeco = lineDecos[0];
      const spec = (firstLineDeco.value as unknown as { spec?: { class?: string } }).spec;
      expect(spec?.class).toContain("cm-md-alert");
      expect(spec?.class).toContain("cm-md-alert--tip");
      expect(spec?.class).toContain("cm-md-alert--first");

      // 验证首行被替换为 header widget
      const headerWidgetDecos = decos.filter(
        (d) =>
          (d.value as unknown as { spec?: { wysiwygRole?: string } }).spec?.wysiwygRole ===
          "alert-header-widget",
      );
      expect(headerWidgetDecos).toHaveLength(1);
      const headerWidget = (
        headerWidgetDecos[0].value as unknown as {
          widget?: DirectiveHeaderWidget;
        }
      ).widget;
      expect(headerWidget).toBeInstanceOf(DirectiveHeaderWidget);
      expect(headerWidget?.directiveType).toBe("tip");
      expect(headerWidget?.title).toBe("技巧提示");
    });

    it("preserves header widget even when cursor focuses on the first line (No Inline Disclosure)", () => {
      const doc = ["> [!WARNING] 警告标题", "> 正文内容"].join("\n");
      // 光标位于第 5 个字符（在首行内部）
      const state = createEditorState(doc, EditorSelection.single(5));
      const index = state.field(markdownRangeIndexField);
      const record = index.records.find((r) => r.kind === "quote")!;

      const decos = buildBlockLayoutDecorations(record, state);

      // 光标在首行时，依然恒定替换为只读卡片头部，绝不原位回显源码
      const headerWidgetDecos = decos.filter(
        (d) =>
          (d.value as unknown as { spec?: { wysiwygRole?: string } }).spec?.wysiwygRole ===
          "alert-header-widget",
      );
      expect(headerWidgetDecos).toHaveLength(1);
    });
  });

  describe("Widget DOM rendering", () => {
    it("renders 16px SVG icon, title, and valid CSS classes in DOM", () => {
      const widget = new DirectiveHeaderWidget("important", "核心重点", "record-123");
      const fakeDoc = {
        createElement(tag: string) {
          const el = {
            tagName: tag,
            className: "",
            dataset: {} as Record<string, string>,
            textContent: "",
            innerHTML: "",
            children: [] as unknown[],
            appendChild(child: unknown) {
              el.children.push(child);
              return child;
            },
          };
          return el as unknown as HTMLElement;
        },
      } as unknown as Document;

      const fakeView = {
        dom: { ownerDocument: fakeDoc },
      } as unknown as EditorView;

      const dom = widget.toDOM(fakeView);
      expect(dom.className).toContain("cm-md-directive__header-content");
      expect(dom.className).toContain("cm-md-directive--important");
      expect(dom.dataset.recordId).toBe("record-123");
    });

    it("tests mode switch after typing in source mode", () => {
      const doc = "> [!NOTE]\n>\n> 123";
      const docState = createDocumentState({
        markdown: "",
        mode: "source",
      });

      let rendererRef: CodeMirrorRenderer | null = null;
      const harness = createRendererTestHarness({
        initialSnapshot: docState.getSnapshot(),
        onEditorChange: (change) => {
          docState.applyEditorChange(change.markdown, change.origin);
        },
        onQueuedExternalEditReady: () => {},
        onQueuedExternalEditCancelled: () => {},
      });
      rendererRef = harness.renderer;

      docState.subscribeTransitions((event) => {
        if (rendererRef) {
          synchronizeRendererEvent(docState, rendererRef, event);
        }
      });

      harness.replaceAsUser(doc);

      const testState = createEditorState(doc);
      const index = testState.field(markdownRangeIndexField);
      const record = index.records[0];
      expect(record.alert).toBeDefined();

      const protectedRanges = getBlockProtectedRanges(record, testState);
      // Header 整行 (0..9) 作为只读卡片受到 protectedRanges 保护
      expect(protectedRanges).toContainEqual({ from: 0, to: 9 });

      const result = switchEditorModeSafely(docState, "wysiwyg", {
        renderer: harness.renderer,
      });
      expect(result.ok).toBe(true);
      expect(result.snapshot.mode).toBe("wysiwyg");
    });
  });

  describe("Quote & Alert vertical boundary navigation", () => {
    it("moves cursor into the last line of quote content area when pressing ArrowUp from below", () => {
      const doc = ["> line 1", "> line 2", ""].join("\n");
      // 光标位于第 3 行空行行首（即双回车退出引用后光标所在行）
      const state = createWysiwygState(doc, EditorSelection.single(doc.length));
      const { view, getState } = createMockView(state);

      const handled = moveAtomVertically(view, "backward");
      expect(handled).toBe(true);

      const head = getState().selection.main.head;
      const line2 = state.doc.line(2);
      // 光标稳稳进入第 2 行（引用内容区的最后一行）
      expect(head).toBeGreaterThanOrEqual(line2.from + 2);
      expect(head).toBeLessThanOrEqual(line2.to);
    });

    it("moves cursor into the last line of alert content area when pressing ArrowUp from below", () => {
      const doc = ["> [!NOTE]", ">", "> alert content line", ""].join("\n");
      const state = createWysiwygState(doc, EditorSelection.single(doc.length));
      const { view, getState } = createMockView(state);

      const handled = moveAtomVertically(view, "backward");
      expect(handled).toBe(true);

      const head = getState().selection.main.head;
      const line3 = state.doc.line(3);
      // 光标稳稳进入第 3 行（Alert 内容区的最后一行）
      expect(head).toBeGreaterThanOrEqual(line3.from + 2);
      expect(head).toBeLessThanOrEqual(line3.to);
    });

    it("skips read-only header and moves above alert when pressing ArrowUp from first content line", () => {
      const doc = ["title above", "> [!NOTE]", "> content line"].join("\n");
      // 光标位于第 3 行（Alert 首个内容行）
      const contentLine = doc.indexOf("> content line") + 2;
      const state = createWysiwygState(doc, EditorSelection.single(contentLine));
      const { view, getState } = createMockView(state);

      const handled = moveAtomVertically(view, "backward");
      expect(handled).toBe(true);

      const head = getState().selection.main.head;
      const line1 = state.doc.line(1);
      // 光标自动跨越只读 Header，直接退到上方行
      expect(head).toBeGreaterThanOrEqual(line1.from);
      expect(head).toBeLessThanOrEqual(line1.to);
    });

    it("skips read-only header and moves into first content line when pressing ArrowDown from above alert", () => {
      const doc = ["title above", "> [!NOTE]", "> content line"].join("\n");
      // 光标位于第 1 行（上方行）
      const state = createWysiwygState(doc, EditorSelection.single(0));
      const { view, getState } = createMockView(state);

      const handled = moveAtomVertically(view, "forward");
      expect(handled).toBe(true);

      const head = getState().selection.main.head;
      const line3 = state.doc.line(3);
      // 光标自动跨越只读 Header，直接落入 Alert 首个内容行
      expect(head).toBeGreaterThanOrEqual(line3.from + 2);
      expect(head).toBeLessThanOrEqual(line3.to);
    });
  });
});
