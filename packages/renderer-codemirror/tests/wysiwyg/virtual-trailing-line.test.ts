// @vitest-environment jsdom

if (typeof Range !== "undefined" && !Range.prototype.getClientRects) {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
}
import { markdown } from "@codemirror/lang-markdown";
import { defaultKeymap, history, undo } from "@codemirror/commands";
import { EditorSelection, EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { describe, expect, it, vi } from "vitest";
import { provideWysiwygDiagnostics, WysiwygDiagnostics } from "../../src/diagnostics.ts";
import { createMdxComponentRegistry } from "@md-editor/plugin-host/mdx";
import { M1_MARKDOWN_EXTENSIONS } from "../../src/markdown/extensions.ts";
import { markdownRangeIndexField, mdxModeFacet } from "../../src/markdown/range-index.ts";
import { editorModeField, setEditorModeEffect } from "../../src/mode.ts";
import { createWysiwygProjectionExtensions } from "../../src/wysiwyg/index.ts";
import { inspectWysiwygProjection } from "../../src/wysiwyg/state/projection-field.ts";
import {
  calculateMaterializationPrefix,
  exitAtomAtEndOfDocument,
  materializeVirtualTrailingLine,
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
import { mdxComponentRegistryFacet } from "../../src/wysiwyg/projections/mdx-projection.ts";

/**
 * @param extraExtensions 追加的扩展。生产根扩展装有 `defaultKeymap`，默认键位的优先级低于虚拟行键位；
 *   要验证“虚拟行键位压过默认键位”，必须把它装进来，否则合成的 Backspace/Enter 本来就什么都不做。
 */
function createHarness(
  doc: string,
  mode: "wysiwyg" | "source" = "wysiwyg",
  extraExtensions: readonly Extension[] = [],
) {
  const diagnostics = new WysiwygDiagnostics();
  let state = EditorState.create({
    doc,
    selection: EditorSelection.cursor(doc.length),
    extensions: [
      history(),
      markdown({ extensions: M1_MARKDOWN_EXTENSIONS }),
      provideWysiwygDiagnostics(diagnostics),
      editorModeField,
      markdownRangeIndexField,
      createWysiwygProjectionExtensions(["html", "tables", "thematic-breaks"]),
      ...extraExtensions,
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

/** 与生产根扩展一致的默认键位。 */
const PRODUCTION_DEFAULT_KEYMAP: Extension = keymap.of(defaultKeymap);

/**
 * 启用 MDX / Frontmatter 投影的视图。默认夹具 `createHarness` 没启用这两类投影，
 * 而它们同样在 `TERMINAL_BLOCK_KINDS` 里，需要单独验证块下方只有一个落脚行。
 */
function mountWithFeatures(doc: string) {
  const registry = createMdxComponentRegistry([
    {
      id: "mdx.callout",
      component: {
        name: "Callout",
        displayName: "Callout",
        props: [{ name: "type", type: "enum", values: ["info", "warning"] }],
        acceptsChildren: true,
        version: "0.1",
      },
    },
  ]);
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      selection: EditorSelection.cursor(2),
      extensions: [
        markdown({ extensions: M1_MARKDOWN_EXTENSIONS }),
        editorModeField,
        markdownRangeIndexField,
        mdxModeFacet.of(true),
        mdxComponentRegistryFacet.of(registry),
        createWysiwygProjectionExtensions([
          "html",
          "tables",
          "thematic-breaks",
          "frontmatter",
          "mdx",
        ]),
      ],
    }),
  });
  return {
    view,
    destroy() {
      view.destroy();
      parent.remove();
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

    it("returns false for normal text ending without newline", () => {
      const { state, destroy } = createHarness("Hello world");
      try {
        // 普通末行下面仍有 .cm-line。点文末空白应续写该段，不挂虚拟空行。
        expect(needsVirtualTrailingLine(state)).toBe(false);
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

  // MDX / Frontmatter 同在 TERMINAL_BLOCK_KINDS 里，但默认夹具没启用它们的投影。
  // 这里单独搭一个启用对应特性的视图，守“块下方只有一个落脚行”对这两类块同样成立。
  describe("terminal mdx and frontmatter blocks", () => {
    // 块的渲染形态不同：MDX 是块 widget；Frontmatter 是 header / body / footer 三种带 .cm-line 的行。
    // 注意：「frontmatter」（无尾随换行）这一条在旧实现（普通 widget）上也通过，不是漏测——
    // 文档最后一行就是 footer 这个真实 .cm-line，CM6 末尾无需合成，本来就只有一个落脚行。
    // 有一个尾随换行时才会多出合成行，「frontmatter + 1 newline」正是拦它的用例。
    // 共同点是：虚拟行是最后一个子节点，紧挨在块的最后一个节点后面，中间没有合成的空 .cm-line。
    it.each([
      ["mdx", 'Intro\n\n<Callout type="info">\n内容\n</Callout>', "cm-md-mdx"],
      ["mdx + 1 newline", 'Intro\n\n<Callout type="info">\n内容\n</Callout>\n', "cm-md-mdx"],
      ["frontmatter", "---\ntitle: demo\n---", "cm-md-frontmatter-line--footer"],
      ["frontmatter + 1 newline", "---\ntitle: demo\n---\n", "cm-md-frontmatter-line--footer"],
    ])(
      "leaves exactly one landing row below a terminal %s block",
      (_label, doc, lastBlockClass) => {
        const { view, destroy } = mountWithFeatures(doc);
        try {
          expect(needsVirtualTrailingLine(view.state)).toBe(true);
          const kids = Array.from(view.contentDOM.children);
          const virtualIndex = kids.findIndex((el) =>
            el.classList.contains("cm-virtual-trailing-line"),
          );
          expect(virtualIndex).toBeGreaterThanOrEqual(0);
          // 虚拟行必须是最后一个子节点。
          expect(virtualIndex).toBe(kids.length - 1);
          // 紧挨在它前面的必须是块自己的最后一个节点，不能是 CM6 合成的空 .cm-line。
          const previous = kids[virtualIndex - 1];
          expect(previous.className).toContain(lastBlockClass);
        } finally {
          destroy();
        }
      },
    );
  });

  describe("decoration and DOM presentation", () => {
    it("renders virtual line widget at doc.length when needed", () => {
      const snippet = "<div>Safe</div>";
      const { view, destroy } = createHarness(snippet);
      try {
        // 断言行为，不断言装饰的具体写法（行装饰 / widget 都可能）：
        // 虚拟行存在、带标记、是最后一个子节点，且文档不变。
        expect(view.state.field(virtualTrailingLineDecorationField).size).toBe(1);
        const el = view.dom.querySelector(".cm-virtual-trailing-line");
        expect(el).not.toBeNull();
        expect(el?.getAttribute("data-virtual-line")).toBe("true");
        expect(view.contentDOM.lastElementChild).toBe(el);
        expect(view.state.doc.toString()).toBe(snippet);
      } finally {
        destroy();
      }
    });

    // 回归：CM6 构建末尾会给“未被块 widget 覆盖的文末位置”补一个空 .cm-line。整行块级替换不覆盖
    // 末尾，虚拟行若只是普通 widget 就会叠在这一行之下，用户看到两个空行。
    // 断言对象是 .cm-content 的直接子节点序列，不依赖具体像素。
    it.each([
      ["table", "Intro\n\n| A |\n| --- |\n| 1 |"],
      ["table + 1 newline", "Intro\n\n| A |\n| --- |\n| 1 |\n"],
      ["html", "Intro\n\n<div>Safe</div>"],
      ["html + 1 newline", "Intro\n\n<div>Safe</div>\n"],
      ["thematic break", "Intro\n\n---"],
      ["thematic break + 1 newline", "Intro\n\n---\n"],
    ])("leaves exactly one landing row below a terminal block: %s", (_label, doc) => {
      const { view, destroy } = createHarness(doc);
      try {
        // 夹具默认把光标放在 doc.length，贴文末的 HTML 块会因此展开成源码行；
        // 把光标放进开头的正文，让块保持预览态。
        view.dispatch({ selection: EditorSelection.cursor(2) });
        const kids = Array.from(view.contentDOM.children);
        const blockIndex = kids.findIndex((el) =>
          /cm-md-(table|html-block|thematic)/.test(el.className),
        );
        expect(blockIndex).toBeGreaterThanOrEqual(0);
        const below = kids.slice(blockIndex + 1);
        // 块下面只能有一个节点，且它就是虚拟行（虚拟行本身也是一个 .cm-line，所以按类名判定）。
        expect(below.map((el) => el.classList.contains("cm-virtual-trailing-line"))).toEqual([
          true,
        ]);
      } finally {
        destroy();
      }
    });

    it.each([
      ["table", "Intro\n\n| A |\n| --- |\n| 1 |\n\n"],
      ["html", "Intro\n\n<div>Safe</div>\n\n"],
    ])(
      "keeps the document's own blank line as the landing row when there is no virtual line: %s",
      (_label, doc) => {
        const { view, destroy } = createHarness(doc);
        try {
          view.dispatch({ selection: EditorSelection.cursor(2) });
          expect(view.contentDOM.querySelector(".cm-virtual-trailing-line")).toBeNull();
          const kids = Array.from(view.contentDOM.children);
          const blockIndex = kids.findIndex((el) => /cm-md-(table|html-block)/.test(el.className));
          expect(blockIndex).toBeGreaterThanOrEqual(0);
          const below = kids.slice(blockIndex + 1);
          expect(below.length).toBeGreaterThan(0);
          expect(below.every((el) => el.classList.contains("cm-line"))).toBe(true);
        } finally {
          destroy();
        }
      },
    );

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
    it("does not treat a plain paragraph end as a virtual line", () => {
      const { view, destroy } = createHarness("Paragraph");
      try {
        view.dispatch({ selection: EditorSelection.cursor(view.state.doc.length) });
        expect(moveDownToVirtualTrailingLine(view)).toBe(false);
        expect(view.state.field(virtualTrailingLineActiveField)).toBe(false);
      } finally {
        destroy();
      }
    });

    it("ArrowDown from a terminal HTML atom activates the virtual line without revealing source", () => {
      const snippet = "<div>End</div>";
      const { view, destroy } = createHarness(snippet);
      try {
        const htmlRecord = view.state.field(markdownRangeIndexField).byKind("html")[0];
        expect(htmlRecord).toBeDefined();
        selectWysiwygAtom(view, htmlRecord.id);

        expect(moveDownToVirtualTrailingLine(view)).toBe(true);
        expect(view.state.field(virtualTrailingLineActiveField)).toBe(true);
        expect(view.state.selection.main.head).toBe(view.state.doc.length);
        expect(view.state.doc.toString()).toBe(snippet);
        expect(inspectWysiwygProjection(view.state).activeSyntaxIds).not.toContain(htmlRecord.id);
        expect(view.dom.querySelector(".cm-md-html-block-widget")).not.toBeNull();

        expect(moveUpFromVirtualTrailingLine(view)).toBe(true);
        expect(view.state.field(virtualTrailingLineActiveField)).toBe(false);
      } finally {
        destroy();
      }
    });

    // 无尾随换行时 fullRange.to === doc.length，停在块末端与 doc.length 等价，测不出差别。
    // 带尾随换行才会分开两者：停在 fullRange.to 的光标仍在块内，再键入会写进块里。
    it.each([
      ["table", "| A | B |\n| --- | --- |\n| 1 | 2 |\n", "table"],
      ["html", "<div>End</div>\n", "html"],
      ["thematic break", "para\n\n---\n", "thematic-break"],
    ] as const)(
      "ArrowDown from a terminal %s atom parks the caret at doc.length, not at the block end",
      (_label, snippet, kind) => {
        const { view, destroy } = createHarness(snippet);
        try {
          const record = view.state.field(markdownRangeIndexField).byKind(kind)[0];
          expect(record).toBeDefined();
          // 前置条件：块末端和文档末尾确实不是同一个偏移，否则这条用例没有区分力。
          expect(record.fullRange.to).toBeLessThan(view.state.doc.length);
          selectWysiwygAtom(view, record.id);

          expect(moveDownToVirtualTrailingLine(view)).toBe(true);

          expect(view.state.selection.main.head).toBe(view.state.doc.length);
          expect(view.state.field(virtualTrailingLineActiveField)).toBe(true);
          expect(view.state.doc.toString()).toBe(snippet);
        } finally {
          destroy();
        }
      },
    );

    it("Backspace and Enter on the virtual line do not change the document", () => {
      const snippet = "<div>End</div>";
      const { view, destroy } = createHarness(snippet, "wysiwyg", [PRODUCTION_DEFAULT_KEYMAP]);
      try {
        view.dispatch({
          selection: EditorSelection.cursor(view.state.doc.length),
          effects: setVirtualTrailingLineActiveEffect.of(true),
        });
        pressKey(view, "Backspace");
        pressKey(view, "Enter");
        expect(view.state.doc.toString()).toBe(snippet);
        expect(view.state.field(virtualTrailingLineActiveField)).toBe(true);
      } finally {
        destroy();
      }
    });
  });

  describe("clicking the space below the last line", () => {
    it("activates the virtual line when the click is in the bottom padding", () => {
      const snippet = "<div>End</div>";
      const { view, destroy } = createHarness(snippet);
      try {
        view.dispatch({ selection: EditorSelection.cursor(0) });
        mockDocumentGeometry(view, 160, 900);

        clickContent(view, 200, 500);

        expect(view.state.doc.toString()).toBe(snippet);
        expect(view.state.selection.main.head).toBe(snippet.length);
        expect(view.state.field(virtualTrailingLineActiveField)).toBe(true);
        expect(view.dom.querySelector(".cm-virtual-trailing-line--active")).not.toBeNull();
      } finally {
        destroy();
      }
    });

    it("puts the caret on the real last line when no virtual line is showing", () => {
      const snippet = "Hello\n";
      const { view, destroy } = createHarness(snippet);
      try {
        view.dispatch({ selection: EditorSelection.cursor(0) });
        mockDocumentGeometry(view, 80, 900);

        clickContent(view, 200, 400);

        expect(view.state.doc.toString()).toBe(snippet);
        expect(needsVirtualTrailingLine(view.state)).toBe(false);
        expect(view.state.selection.main.head).toBe(snippet.length);
        expect(view.state.field(virtualTrailingLineActiveField)).toBe(false);
      } finally {
        destroy();
      }
    });

    it("ignores clicks beside the document and clicks on the last line itself", () => {
      const snippet = "<div>End</div>";
      const { view, destroy } = createHarness(snippet);
      try {
        view.dispatch({ selection: EditorSelection.cursor(0) });
        mockDocumentGeometry(view, 160, 900);

        // 内容列左侧和最后一行本行都不算文末留白，不能误点亮虚拟空行。
        clickContent(view, 8, 500);
        clickContent(view, 200, 150);
        expect(view.state.doc.toString()).toBe(snippet);
        expect(view.state.field(virtualTrailingLineActiveField)).toBe(false);
      } finally {
        destroy();
      }
    });
  });

  describe("keys on the active virtual line", () => {
    const snippet = "<div>End</div>";

    function activate() {
      const harness = createHarness(snippet, "wysiwyg", [PRODUCTION_DEFAULT_KEYMAP]);
      harness.view.dispatch({
        selection: EditorSelection.cursor(harness.view.state.doc.length),
        effects: setVirtualTrailingLineActiveEffect.of(true),
      });
      return harness;
    }

    // 注意覆盖范围：这里只守“文档不变”这条不变量。文末的删除同时会被 wysiwygChangeProtection 拦下，
    // 所以去掉 Backspace / Delete 的键位绑定，jsdom 里观察不到差别；绑定本身的作用（不触发
    // “需要源码模式”提示）要靠 e2e 或人工确认。Enter 的绑定则有区分力，见下一条。
    it("Backspace does not delete the last character of the block above", () => {
      const { view, destroy } = activate();
      try {
        pressKey(view, "Backspace");
        expect(view.state.doc.toString()).toBe(snippet);
        expect(view.state.field(virtualTrailingLineActiveField)).toBe(true);
      } finally {
        destroy();
      }
    });

    it("Enter does not insert a newline, so a clean file stays clean", () => {
      const { view, destroy } = activate();
      try {
        pressKey(view, "Enter");
        expect(view.state.doc.toString()).toBe(snippet);
        expect(view.state.field(virtualTrailingLineActiveField)).toBe(true);
      } finally {
        destroy();
      }
    });

    it("Delete does not touch the document", () => {
      const { view, destroy } = activate();
      try {
        pressKey(view, "Delete");
        expect(view.state.doc.toString()).toBe(snippet);
        expect(view.state.field(virtualTrailingLineActiveField)).toBe(true);
      } finally {
        destroy();
      }
    });

    // 必须带尾随换行：无尾随换行时光标在块末端，原子选择层的 ArrowLeft 也会选中该块，
    // 删掉虚拟行自己的 ArrowLeft 绑定结果完全一样，用例就失去区分力。
    it.each([
      ["html", "<div>End</div>\n", "html"],
      ["table", "| A |\n| --- |\n| 1 |\n", "table"],
      ["thematic break", "para\n\n---\n", "thematic-break"],
    ] as const)(
      "ArrowLeft leaves the virtual line and selects the preceding %s atom",
      (_label, doc, kind) => {
        const { view, destroy } = createHarness(doc);
        try {
          view.dispatch({
            selection: EditorSelection.cursor(doc.length),
            effects: setVirtualTrailingLineActiveEffect.of(true),
          });
          const record = view.state.field(markdownRangeIndexField).byKind(kind)[0];
          expect(record.fullRange.to).toBeLessThan(doc.length);

          pressKey(view, "ArrowLeft");

          expect(view.state.field(virtualTrailingLineActiveField)).toBe(false);
          expect(view.state.doc.toString()).toBe(doc);
          expect(view.state.selection.main.from).toBe(record.fullRange.from);
          expect(view.state.selection.main.to).toBe(record.fullRange.to);
        } finally {
          destroy();
        }
      },
    );

    it("stays active while the caret is still on the virtual line, so Escape does not drop typing into the block", () => {
      // 激活态跟光标走：光标没离开虚拟行，Escape 不能把它熄灭。
      // 否则 Escape 之后再打字，字会被 CM6 写进文末合成的那一行，并进块里。
      const { view, destroy } = activate();
      try {
        pressKey(view, "Escape");
        expect(view.state.field(virtualTrailingLineActiveField)).toBe(true);
        expect(view.state.doc.toString()).toBe(snippet);
      } finally {
        destroy();
      }
    });

    it("does not swallow Backspace, Delete or ArrowLeft when the virtual line is inactive", () => {
      // 高优先级键位的返回值就是“是否接管”。未激活时必须放行，否则正文末尾的 Backspace 会失灵。
      // 普通段落里没有任何其他处理器会接管这三个键，所以 defaultPrevented 只可能来自虚拟行键位。
      const { view, destroy } = createHarness("Hello world");
      try {
        expect(view.state.field(virtualTrailingLineActiveField)).toBe(false);
        const swallowed: string[] = [];
        for (const key of ["Backspace", "Delete", "ArrowLeft"]) {
          const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
          view.focus();
          view.contentDOM.dispatchEvent(event);
          if (event.defaultPrevented) swallowed.push(key);
        }
        // 用数组收集再整体断言：失败时能直接看到是哪个键被吞了。
        expect(swallowed).toEqual([]);
      } finally {
        destroy();
      }
    });
  });

  describe("materialization", () => {
    it("is a no-op when the virtual line is not active", () => {
      const { view, destroy } = createHarness("<div>End</div>");
      try {
        expect(materializeVirtualTrailingLine(view, "x", "input.type")).toBe(false);
        expect(view.state.doc.toString()).toBe("<div>End</div>");
      } finally {
        destroy();
      }
    });

    it("writes the block-separating prefix and the text in one transaction, one undo reverts both", () => {
      const snippet = "<div>End</div>";
      const { view, destroy } = createHarness(snippet);
      try {
        view.dispatch({
          selection: EditorSelection.cursor(snippet.length),
          effects: setVirtualTrailingLineActiveEffect.of(true),
        });
        expect(materializeVirtualTrailingLine(view, "hi", "input.type")).toBe(true);
        expect(view.state.doc.toString()).toBe(`${snippet}\n\nhi`);
        expect(view.state.selection.main.head).toBe(view.state.doc.length);
        expect(view.state.field(virtualTrailingLineActiveField)).toBe(false);

        expect(undo(view)).toBe(true);
        expect(view.state.doc.toString()).toBe(snippet);
      } finally {
        destroy();
      }
    });

    it("adds no prefix when the document already ends with a newline after a block", () => {
      // 块后只剩一个换行时，虚拟行仍在；只需补一个换行把正文与块隔开。
      const snippet = "| A |\n| --- |\n| 1 |\n";
      const { view, destroy } = createHarness(snippet);
      try {
        view.dispatch({
          selection: EditorSelection.cursor(snippet.length),
          effects: setVirtualTrailingLineActiveEffect.of(true),
        });
        expect(materializeVirtualTrailingLine(view, "x", "input.type")).toBe(true);
        expect(view.state.doc.toString()).toBe(`${snippet}\nx`);
      } finally {
        destroy();
      }
    });
  });

  describe("paste on the virtual line", () => {
    const snippet = "<div>End</div>";

    function activate() {
      const harness = createHarness(snippet);
      harness.view.dispatch({
        selection: EditorSelection.cursor(snippet.length),
        effects: setVirtualTrailingLineActiveEffect.of(true),
      });
      return harness;
    }

    it("materializes plain text and prevents the browser default", () => {
      const { view, destroy } = activate();
      try {
        const event = pasteEvent({ "text/plain": "hello" });
        view.contentDOM.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);
        expect(view.state.doc.toString()).toBe(`${snippet}\n\nhello`);
        expect(view.state.field(virtualTrailingLineActiveField)).toBe(false);
      } finally {
        destroy();
      }
    });

    it("converts rich HTML to Markdown, same as the regular smart paste", () => {
      const { view, destroy } = activate();
      try {
        view.contentDOM.dispatchEvent(
          pasteEvent({
            "text/plain": "Title",
            "text/html": "<h2>Title</h2><ul><li>one</li><li>two</li></ul>",
          }),
        );
        const doc = view.state.doc.toString();
        expect(doc.startsWith(`${snippet}\n\n`)).toBe(true);
        expect(doc).toContain("## Title");
        expect(doc).toContain("one");
        expect(doc).not.toContain("<h2>");
      } finally {
        destroy();
      }
    });

    it("keeps plain text when Shift is held", () => {
      const { view, destroy } = activate();
      try {
        view.contentDOM.dispatchEvent(
          pasteEvent({ "text/plain": "Title", "text/html": "<h2>Title</h2>" }, { shiftKey: true }),
        );
        expect(view.state.doc.toString()).toBe(`${snippet}\n\nTitle`);
      } finally {
        destroy();
      }
    });

    it("does not materialize anything for an empty clipboard", () => {
      const { view, destroy } = activate();
      try {
        // 不用 defaultPrevented 判断：CM6 自带的 paste 处理器对空剪贴板也会 preventDefault。
        view.contentDOM.dispatchEvent(pasteEvent({}));
        expect(view.state.doc.toString()).toBe(snippet);
        expect(view.state.field(virtualTrailingLineActiveField)).toBe(true);
      } finally {
        destroy();
      }
    });

    it("falls through to the default paste when the virtual line is inactive", () => {
      const { view, destroy } = createHarness(snippet);
      try {
        view.contentDOM.dispatchEvent(pasteEvent({ "text/plain": "hello" }));
        // 交给 CM6 默认粘贴：文本直接落在光标处，没有虚拟行物化才会补的 `\n\n` 前缀。
        const doc = view.state.doc.toString();
        expect(doc).toContain("hello");
        expect(doc).not.toContain("\n\nhello");
      } finally {
        destroy();
      }
    });
  });

  describe("IME composition on the virtual line", () => {
    const snippet = "<div>End</div>";

    function activate(doc = snippet) {
      const harness = createHarness(doc);
      harness.view.dispatch({
        selection: EditorSelection.cursor(doc.length),
        effects: setVirtualTrailingLineActiveEffect.of(true),
      });
      return harness;
    }

    it("compositionstart materializes the separating newlines so the DOM has a real anchor", () => {
      const { view, destroy } = activate();
      try {
        view.contentDOM.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
        expect(view.state.doc.toString()).toBe(`${snippet}\n\n`);
        expect(view.state.field(virtualTrailingLineActiveField)).toBe(false);
      } finally {
        destroy();
      }
    });

    it("compositionend with no committed text removes the prefix and re-activates the virtual line", () => {
      const { view, destroy } = activate();
      try {
        view.contentDOM.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
        expect(view.state.doc.toString()).toBe(`${snippet}\n\n`);

        view.contentDOM.dispatchEvent(
          new CompositionEvent("compositionend", { bubbles: true, data: "" }),
        );

        expect(view.state.doc.toString()).toBe(snippet);
        expect(view.state.field(virtualTrailingLineActiveField)).toBe(true);
        expect(view.state.selection.main.head).toBe(snippet.length);
      } finally {
        destroy();
      }
    });

    it("compositionend with committed text keeps the prefix", () => {
      const { view, destroy } = activate();
      try {
        view.contentDOM.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
        view.dispatch({
          changes: { from: view.state.doc.length, insert: "字" },
          selection: EditorSelection.cursor(view.state.doc.length + 1),
          userEvent: "input.type.compose",
        });
        view.contentDOM.dispatchEvent(
          new CompositionEvent("compositionend", { bubbles: true, data: "字" }),
        );
        expect(view.state.doc.toString()).toBe(`${snippet}\n\n字`);
      } finally {
        destroy();
      }
    });

    it("does nothing at compositionend when the user already edited past the prefix", () => {
      const { view, destroy } = activate();
      try {
        view.contentDOM.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
        // 组字期间文档又长了：回收前导换行会误删用户内容，必须放弃回收。
        view.dispatch({
          changes: { from: view.state.doc.length, insert: "x" },
          selection: EditorSelection.cursor(view.state.doc.length + 1),
        });
        view.contentDOM.dispatchEvent(
          new CompositionEvent("compositionend", { bubbles: true, data: "" }),
        );
        expect(view.state.doc.toString()).toBe(`${snippet}\n\nx`);
      } finally {
        destroy();
      }
    });

    it("compositionstart does nothing when no prefix is needed", () => {
      // 普通段落末尾（无虚拟行语义）也可能被置为激活；此时 prefix 为空，不应派发多余事务。
      const { view, destroy } = activate("Hello\n");
      try {
        const before = view.state.doc.toString();
        view.contentDOM.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
        expect(view.state.doc.toString()).toBe(before);
      } finally {
        destroy();
      }
    });
  });

  describe("IME prefix undo", () => {
    it("undoes the materialized prefix together with the composed text", () => {
      const snippet = "<div>End</div>";
      const { view, destroy } = createHarness(snippet);
      try {
        view.dispatch({
          selection: EditorSelection.cursor(view.state.doc.length),
          effects: setVirtualTrailingLineActiveEffect.of(true),
        });
        expect(materializeVirtualTrailingLine(view, "", "input.type.compose.start")).toBe(true);
        expect(view.state.doc.toString()).toBe(`${snippet}\n\n`);

        view.dispatch({
          changes: { from: view.state.doc.length, insert: "字" },
          selection: EditorSelection.cursor(view.state.doc.length + 1),
          userEvent: "input.type.compose",
        });
        expect(view.state.doc.toString()).toBe(`${snippet}\n\n字`);

        expect(undo(view)).toBe(true);
        expect(view.state.doc.toString()).toBe(snippet);
      } finally {
        destroy();
      }
    });
  });
});

function mockDocumentGeometry(
  view: EditorView,
  lastChildBottom: number,
  contentBottom: number,
): void {
  vi.spyOn(view.contentDOM, "getBoundingClientRect").mockReturnValue(
    new DOMRect(40, 0, 560, contentBottom),
  );
  vi.spyOn(view.scrollDOM, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, 640, contentBottom),
  );
  for (const child of view.contentDOM.children) {
    vi.spyOn(child, "getBoundingClientRect").mockReturnValue(
      new DOMRect(40, lastChildBottom - 20, 560, 20),
    );
  }
}

function clickContent(view: EditorView, clientX: number, clientY: number): void {
  view.contentDOM.dispatchEvent(
    new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX,
      clientY,
    }),
  );
}

function pressKey(view: EditorView, key: string): void {
  view.focus();
  view.contentDOM.dispatchEvent(
    new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
  );
}

/** 构造带 clipboardData 的 paste 事件。jsdom 没有 DataTransfer，用最小实现代替。 */
function pasteEvent(data: Record<string, string>, init: { shiftKey?: boolean } = {}): Event {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: {
      types: Object.keys(data),
      getData: (format: string) => data[format] ?? "",
    },
  });
  Object.defineProperty(event, "shiftKey", { value: init.shiftKey === true });
  return event;
}
