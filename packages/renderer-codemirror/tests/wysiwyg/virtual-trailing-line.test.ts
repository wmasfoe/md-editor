// @vitest-environment jsdom

if (typeof Range !== "undefined" && !Range.prototype.getClientRects) {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
}
import { markdown } from "@codemirror/lang-markdown";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { provideWysiwygDiagnostics, WysiwygDiagnostics } from "../../src/diagnostics.ts";
import { M1_MARKDOWN_EXTENSIONS } from "../../src/markdown/extensions.ts";
import { markdownRangeIndexField } from "../../src/markdown/range-index.ts";
import { editorModeField, setEditorModeEffect } from "../../src/mode.ts";
import { createWysiwygProjectionExtensions } from "../../src/wysiwyg/index.ts";
import {
  calculateMaterializationPrefix,
  exitAtomAtEndOfDocument,
  moveDownToVirtualTrailingLine,
  moveUpFromVirtualTrailingLine,
  needsVirtualTrailingLine,
  virtualTrailingLineDecorationField,
} from "../../src/wysiwyg/editing/virtual-trailing-line.ts";
import {
  setVirtualTrailingLineActiveEffect,
  virtualTrailingLineActiveField,
} from "../../src/wysiwyg/state/types.ts";
import { selectWysiwygAtom } from "../../src/wysiwyg/blocks/atom-selection.ts";

function createHarness(doc: string, mode: "wysiwyg" | "source" = "wysiwyg") {
  const diagnostics = new WysiwygDiagnostics();
  let state = EditorState.create({
    doc,
    selection: EditorSelection.cursor(doc.length),
    extensions: [
      markdown({ extensions: M1_MARKDOWN_EXTENSIONS }),
      provideWysiwygDiagnostics(diagnostics),
      editorModeField,
      markdownRangeIndexField,
      createWysiwygProjectionExtensions(["html", "tables", "thematic-breaks"]),
    ],
  });

  if (mode === "source") {
    state = state.update({ effects: setEditorModeEffect.of("source") }).state;
  }

  const dom = document.createElement("div");
  document.body.appendChild(dom);

  const view = new EditorView({
    state,
    parent: dom,
  });

  return {
    view,
    get state() {
      return view.state;
    },
    destroy() {
      view.destroy();
      dom.remove();
    },
  };
}

describe("Virtual Trailing Line", () => {
  describe("needsVirtualTrailingLine gating logic", () => {
    it("returns false for completely empty documents", () => {
      const { state, destroy } = createHarness("");
      try {
        expect(needsVirtualTrailingLine(state)).toBe(false);
      } finally {
        destroy();
      }
    });

    it("returns false in source mode even if doc has no trailing empty line", () => {
      const { state, destroy } = createHarness("Hello world", "source");
      try {
        expect(needsVirtualTrailingLine(state)).toBe(false);
      } finally {
        destroy();
      }
    });

    it("returns true for normal text ending without newline", () => {
      const { state, destroy } = createHarness("Hello world");
      try {
        expect(needsVirtualTrailingLine(state)).toBe(true);
      } finally {
        destroy();
      }
    });

    it("returns false for normal text ending with a real blank line", () => {
      const { state, destroy } = createHarness("Hello world\n");
      try {
        expect(needsVirtualTrailingLine(state)).toBe(false);
      } finally {
        destroy();
      }
    });

    it("returns true for user HTML snippet ending without trailing blank line", () => {
      const snippet = [
        "但是，我们",
        "",
        "<head>",
        '    <meta charset="UTF-8" />',
        "    <title>Inkpoint</title>",
        "  </head>",
      ].join("\n");
      const { state, destroy } = createHarness(snippet);
      try {
        expect(needsVirtualTrailingLine(state)).toBe(true);
      } finally {
        destroy();
      }
    });

    it("returns true for HTML block ending with single newline (consumed by whole-line replacement)", () => {
      const snippet = "<div>Content</div>\n";
      const { state, destroy } = createHarness(snippet);
      try {
        expect(needsVirtualTrailingLine(state)).toBe(true);
      } finally {
        destroy();
      }
    });

    it("returns false for HTML block followed by a real blank line (two newlines)", () => {
      const snippet = "<div>Content</div>\n\n";
      const { state, destroy } = createHarness(snippet);
      try {
        expect(needsVirtualTrailingLine(state)).toBe(false);
      } finally {
        destroy();
      }
    });

    it("returns true for table ending without trailing blank line", () => {
      const snippet = "| A | B |\n| --- | --- |\n| 1 | 2 |";
      const { state, destroy } = createHarness(snippet);
      try {
        expect(needsVirtualTrailingLine(state)).toBe(true);
      } finally {
        destroy();
      }
    });

    it("returns false for table followed by a real blank line", () => {
      const snippet = "| A | B |\n| --- | --- |\n| 1 | 2 |\n\n";
      const { state, destroy } = createHarness(snippet);
      try {
        expect(needsVirtualTrailingLine(state)).toBe(false);
      } finally {
        destroy();
      }
    });

    it("returns true for thematic break ending without blank line", () => {
      const snippet = "Paragraph\n\n---";
      const { state, destroy } = createHarness(snippet);
      try {
        expect(needsVirtualTrailingLine(state)).toBe(true);
      } finally {
        destroy();
      }
    });
  });

  describe("zero disk / storage pollution invariant", () => {
    it("never mutates state.doc when virtual trailing line is displayed or activated", () => {
      const snippet = [
        "但是，我们",
        "",
        "<head>",
        '    <meta charset="UTF-8" />',
        "    <title>Inkpoint</title>",
        "  </head>",
      ].join("\n");
      const { view, destroy } = createHarness(snippet);
      try {
        // 初始渲染：底层 doc 严格保持原样，零字节增加
        expect(view.state.doc.toString()).toBe(snippet);

        // 激活虚拟空行态
        view.dispatch({
          effects: setVirtualTrailingLineActiveEffect.of(true),
        });
        expect(view.state.field(virtualTrailingLineActiveField)).toBe(true);

        // 验证即使处于激活态（显示光标），底层 state.doc 仍为 0 变更！
        expect(view.state.doc.toString()).toBe(snippet);
        expect(view.state.doc.length).toBe(snippet.length);
      } finally {
        destroy();
      }
    });
  });

  describe("decoration and DOM presentation", () => {
    it("renders virtual line widget at doc.length when needed", () => {
      const snippet = "<div>Safe</div>";
      const { view, destroy } = createHarness(snippet);
      try {
        const decos = view.state.field(virtualTrailingLineDecorationField);
        let found = false;
        decos.between(view.state.doc.length, view.state.doc.length, (_from, _to, value) => {
          if (value.spec.block && value.spec.side === 1) {
            found = true;
          }
        });
        expect(found).toBe(true);

        // DOM 中存在 cm-virtual-trailing-line
        const el = view.dom.querySelector(".cm-virtual-trailing-line");
        expect(el).not.toBeNull();
        expect(el?.getAttribute("data-virtual-line")).toBe("true");
      } finally {
        destroy();
      }
    });

    it("does not render virtual line widget when doc ends with real blank line", () => {
      const snippet = "<div>Safe</div>\n\n";
      const { view, destroy } = createHarness(snippet);
      try {
        const decos = view.state.field(virtualTrailingLineDecorationField);
        expect(decos.size).toBe(0);
        const el = view.dom.querySelector(".cm-virtual-trailing-line");
        expect(el).toBeNull();
      } finally {
        destroy();
      }
    });
  });

  describe("Enter key on selected atom at EOF", () => {
    it("materializes a new paragraph line below HTML block when Enter is pressed on atom selection", () => {
      const snippet = "<head>\n  <title>Inkpoint</title>\n</head>";
      const { view, destroy } = createHarness(snippet);
      try {
        const index = view.state.field(markdownRangeIndexField);
        const htmlRecord = index.byKind("html")[0];
        expect(htmlRecord).toBeDefined();

        // 选中该 HTML 块整块原子
        selectWysiwygAtom(view, htmlRecord.id);
        expect(view.state.selection.main.from).toBe(htmlRecord.fullRange.from);
        expect(view.state.selection.main.to).toBe(htmlRecord.fullRange.to);

        // 按 Enter 键退出原子并在下方创建新空行
        const handled = exitAtomAtEndOfDocument(view);
        expect(handled).toBe(true);

        // 验证底层文档成功补齐 \n\n，光标落在新空行上
        expect(view.state.doc.toString()).toBe(`${snippet}\n\n`);
        expect(view.state.selection.main.head).toBe(view.state.doc.length);
      } finally {
        destroy();
      }
    });
  });

  describe("JIT materialization on typing", () => {
    it("calculates correct materialization prefix for blocks vs normal text", () => {
      const snippetBlock = "<div>Content</div>";
      const { state: stateBlock, destroy: d1 } = createHarness(snippetBlock);
      try {
        // 块级组件后需补 \n\n
        expect(calculateMaterializationPrefix(stateBlock)).toBe("\n\n");
      } finally {
        d1();
      }

      const snippetText = "Normal paragraph";
      const { state: stateText, destroy: d2 } = createHarness(snippetText);
      try {
        // 普通文本行末尾只需补 \n
        expect(calculateMaterializationPrefix(stateText)).toBe("\n");
      } finally {
        d2();
      }
    });
  });

  describe("keyboard navigation with Arrow keys", () => {
    it("moves focus to virtual line when pressing ArrowDown at EOF", () => {
      const snippet = "Paragraph";
      const { view, destroy } = createHarness(snippet);
      try {
        expect(view.state.field(virtualTrailingLineActiveField)).toBe(false);

        // 光标在文末
        view.dispatch({ selection: EditorSelection.cursor(view.state.doc.length) });
        const movedDown = moveDownToVirtualTrailingLine(view);
        expect(movedDown).toBe(true);
        expect(view.state.field(virtualTrailingLineActiveField)).toBe(true);

        // 按 ArrowUp 退出虚拟行返回正文
        const movedUp = moveUpFromVirtualTrailingLine(view);
        expect(movedUp).toBe(true);
        expect(view.state.field(virtualTrailingLineActiveField)).toBe(false);
      } finally {
        destroy();
      }
    });
  });
});
