import { describe, expect, it } from "vitest";
import { Schema } from "@milkdown/kit/prose/model";
import { EditorState, NodeSelection, TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import {
  createCodeBlockToolsProsePlugin,
  findAdjacentCalloutPreviewNodePosition,
  findCurrentCodeBlockTextRange,
  findCurrentCalloutPreviewNodePosition,
  getLanguageSuggestions,
  isCalloutPreviewCodeBlockNode,
  normalizeCodeLanguage,
  parseCalloutPreviewSource,
  planCodeBlockTabIndent,
} from "../utils/code-block-tools";

describe("code block tools", () => {
  it("plans tab insertion only inside code blocks", () => {
    expect(planCodeBlockTabIndent("paragraph", "", 4, 4)).toBeNull();
    expect(planCodeBlockTabIndent("code_block", "", 4, 4)).toEqual({
      from: 4,
      to: 4,
      text: "  ",
    });
  });

  it("plans selected line indentation and outdentation", () => {
    expect(planCodeBlockTabIndent("code_block", "a\nb", 10, 13)).toEqual({
      from: 10,
      to: 13,
      text: "  a\n  b",
    });
    expect(planCodeBlockTabIndent("code_block", "  a\n\tb\nc", 10, 19, true)).toEqual({
      from: 10,
      to: 19,
      text: "a\nb\nc",
    });
  });

  it("suggests languages fuzzily while preserving free-form input elsewhere", () => {
    expect(getLanguageSuggestions("ts")).toContain("typescript");
    expect(getLanguageSuggestions("jx")).toContain("jsx");
    expect(getLanguageSuggestions("totally-custom-language")).toEqual([]);
  });

  it("normalizes free-form language labels before writing fenced info", () => {
    expect(normalizeCodeLanguage(" Type Script ")).toBe("Type-Script");
    expect(normalizeCodeLanguage("`custom lang`")).toBe("custom-lang");
    expect(normalizeCodeLanguage(null)).toBe("");
  });

  it("extracts registered Callout preview data from raw MDX source", () => {
    expect(
      parseCalloutPreviewSource(
        '<Callout type="warning" title="Heads up">\n  Read this.\n</Callout>',
      ),
    ).toEqual({
      type: "warning",
      title: "Heads up",
      children: "Read this.",
    });
    expect(parseCalloutPreviewSource("<Unknown />")).toBeNull();
  });

  it("selects an adjacent Callout preview on the first Delete and removes it on the second", () => {
    const { state, positions } = createCalloutDeleteState();
    const view = createMutableEditorView(
      state.apply(
        state.tr.setSelection(TextSelection.create(state.doc, positions.beforeCalloutCursor)),
      ),
    );
    const plugin = createCodeBlockToolsProsePlugin();
    const firstDelete = createKeyboardEventLike("Delete");

    expect(findAdjacentCalloutPreviewNodePosition(view.state, "forward")).toBe(positions.callout);
    expect(plugin.props.handleKeyDown?.call(plugin, view, firstDelete)).toBe(true);
    expect(firstDelete.defaultPrevented).toBe(true);
    expect(view.state.selection).toBeInstanceOf(NodeSelection);
    expect(view.state.selection.from).toBe(positions.callout);

    const secondDelete = createKeyboardEventLike("Delete");

    expect(plugin.props.handleKeyDown?.call(plugin, view, secondDelete)).toBe(true);
    expect(secondDelete.defaultPrevented).toBe(true);
    expect(view.state.doc.textContent).toBe("beforeafter");
  });

  it("selects an adjacent Callout preview before the cursor on Backspace", () => {
    const { state, positions } = createCalloutDeleteState();
    const view = createMutableEditorView(
      state.apply(
        state.tr.setSelection(TextSelection.create(state.doc, positions.afterCalloutCursor)),
      ),
    );
    const plugin = createCodeBlockToolsProsePlugin();
    const event = createKeyboardEventLike("Backspace");

    expect(findAdjacentCalloutPreviewNodePosition(view.state, "backward")).toBe(positions.callout);
    expect(plugin.props.handleKeyDown?.call(plugin, view, event)).toBe(true);
    expect(event.defaultPrevented).toBe(true);
    expect(view.state.selection).toBeInstanceOf(NodeSelection);
    expect(view.state.selection.from).toBe(positions.callout);
  });

  it("selects the whole Callout preview when the cursor is inside its hidden source", () => {
    const { state, positions } = createCalloutDeleteState();
    const view = createMutableEditorView(
      state.apply(
        state.tr.setSelection(TextSelection.create(state.doc, positions.insideCalloutCursor)),
      ),
    );
    const plugin = createCodeBlockToolsProsePlugin();
    const event = createKeyboardEventLike("Delete");

    expect(findCurrentCalloutPreviewNodePosition(view.state)).toBe(positions.callout);
    expect(plugin.props.handleKeyDown?.call(plugin, view, event)).toBe(true);
    expect(event.defaultPrevented).toBe(true);
    expect(view.state.selection).toBeInstanceOf(NodeSelection);
    expect(view.state.selection.from).toBe(positions.callout);
  });

  it("leaves ordinary code blocks and text selections to the default Delete behavior", () => {
    const schema = createCodeBlockTestSchema();
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.paragraph.create(null, schema.text("before")),
      schema.nodes.code_block.create(null, schema.text("const value = 1;")),
      schema.nodes.paragraph.create(null, schema.text("after")),
    ]);
    const view = createMutableEditorView(
      EditorState.create({
        doc,
        selection: TextSelection.create(doc, 7),
      }),
    );
    const plugin = createCodeBlockToolsProsePlugin();
    const event = createKeyboardEventLike("Delete");

    expect(findAdjacentCalloutPreviewNodePosition(view.state, "forward")).toBeNull();
    expect(plugin.props.handleKeyDown?.call(plugin, view, event)).toBe(false);
    expect(event.defaultPrevented).toBe(false);
    expect(view.state.doc.eq(doc)).toBe(true);

    const nonCollapsedSelection = TextSelection.create(doc, 2, 5);
    const selectedTextState = view.state.apply(view.state.tr.setSelection(nonCollapsedSelection));
    const selectedTextView = createMutableEditorView(selectedTextState);

    expect(findAdjacentCalloutPreviewNodePosition(selectedTextView.state, "forward")).toBeNull();
    expect(
      plugin.props.handleKeyDown?.call(plugin, selectedTextView, createKeyboardEventLike("Delete")),
    ).toBe(false);
  });

  it("identifies only Callout code blocks as selectable component previews", () => {
    const schema = createCodeBlockTestSchema();
    const callout = schema.nodes.code_block.create(null, schema.text("<Callout>内容</Callout>"));
    const ordinary = schema.nodes.code_block.create(null, schema.text("const value = 1;"));

    expect(isCalloutPreviewCodeBlockNode(callout)).toBe(true);
    expect(isCalloutPreviewCodeBlockNode(ordinary)).toBe(false);
    expect(isCalloutPreviewCodeBlockNode(schema.nodes.paragraph.create())).toBe(false);
  });

  it("selects only the current code block text for Mod-a inside a code block", () => {
    const schema = createCodeBlockTestSchema();
    const code = "const value = 1;\nreturn value;";
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.paragraph.create(null, schema.text("before")),
      schema.nodes.code_block.create(null, schema.text(code)),
      schema.nodes.paragraph.create(null, schema.text("after")),
    ]);
    const codePosition = findFirstCodeBlockPosition(doc);
    const codeStart = codePosition + 1;
    const view = createMutableEditorView(
      EditorState.create({
        doc,
        selection: TextSelection.create(doc, codeStart + 6),
      }),
    );
    const plugin = createCodeBlockToolsProsePlugin();
    const event = createKeyboardEventLike("a", { metaKey: true });

    expect(findCurrentCodeBlockTextRange(view.state)).toEqual({
      from: codeStart,
      to: codeStart + code.length,
    });
    expect(plugin.props.handleKeyDown?.call(plugin, view, event)).toBe(true);
    expect(event.defaultPrevented).toBe(true);
    expect(view.state.selection.from).toBe(codeStart);
    expect(view.state.selection.to).toBe(codeStart + code.length);
    expect(
      view.state.doc.textBetween(view.state.selection.from, view.state.selection.to, "\n"),
    ).toBe(code);
  });

  it("leaves Mod-a inside Callout previews to the default ProseMirror keymap", () => {
    const { state, positions } = createCalloutDeleteState();
    const view = {
      state: state.apply(
        state.tr.setSelection(TextSelection.create(state.doc, positions.insideCalloutCursor)),
      ),
      dispatch: () => {
        throw new Error("code block tools must not dispatch for Callout preview Mod-a");
      },
    } as unknown as EditorView;
    const event = createKeyboardEventLike("a", { metaKey: true });
    const plugin = createCodeBlockToolsProsePlugin();

    expect(findCurrentCodeBlockTextRange(view.state)).toBeNull();
    expect(plugin.props.handleKeyDown?.call(plugin, view, event)).toBe(false);
    expect(event.defaultPrevented).toBe(false);
  });

  it("leaves Mod-a outside code blocks to the default ProseMirror keymap", () => {
    const schema = createCodeBlockTestSchema();
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.paragraph.create(null, schema.text("before")),
      schema.nodes.code_block.create(null, schema.text("const value = 1;")),
      schema.nodes.paragraph.create(null, schema.text("after")),
    ]);
    const view = {
      state: EditorState.create({ doc }),
      dispatch: () => {
        throw new Error("code block tools must not dispatch for Mod-a");
      },
    } as unknown as EditorView;
    const event = {
      key: "a",
      metaKey: true,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
    } as KeyboardEvent;

    const plugin = createCodeBlockToolsProsePlugin();

    expect(plugin.props.handleKeyDown?.call(plugin, view, event)).toBe(false);
  });

  it("leaves cross-block Mod-a selections to the default ProseMirror keymap", () => {
    const schema = createCodeBlockTestSchema();
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.paragraph.create(null, schema.text("before")),
      schema.nodes.code_block.create(null, schema.text("const value = 1;")),
      schema.nodes.paragraph.create(null, schema.text("after")),
    ]);
    const view = {
      state: EditorState.create({
        doc,
        selection: TextSelection.create(doc, 2, doc.content.size - 1),
      }),
      dispatch: () => {
        throw new Error("code block tools must not dispatch for cross-block Mod-a");
      },
    } as unknown as EditorView;
    const event = createKeyboardEventLike("a", { metaKey: true });
    const plugin = createCodeBlockToolsProsePlugin();

    expect(findCurrentCodeBlockTextRange(view.state)).toBeNull();
    expect(plugin.props.handleKeyDown?.call(plugin, view, event)).toBe(false);
    expect(event.defaultPrevented).toBe(false);
  });
});

function createCalloutDeleteState() {
  const schema = createCodeBlockTestSchema();
  const calloutSource = '<Callout type="info" title="提示">\n  内容\n</Callout>';
  const doc = schema.nodes.doc.create(null, [
    schema.nodes.paragraph.create(null, schema.text("before")),
    schema.nodes.code_block.create(null, schema.text(calloutSource)),
    schema.nodes.paragraph.create(null, schema.text("after")),
  ]);
  let callout = -1;
  doc.descendants((node, position) => {
    if (node.type.name === "code_block" && isCalloutPreviewCodeBlockNode(node)) {
      callout = position;
      return false;
    }
  });

  return {
    state: EditorState.create({ doc }),
    positions: {
      beforeCalloutCursor: callout - 1,
      callout,
      insideCalloutCursor: callout + 1,
      afterCalloutCursor: callout + doc.nodeAt(callout)!.nodeSize + 1,
    },
  };
}

function createCodeBlockTestSchema(): Schema {
  return new Schema({
    nodes: {
      doc: { content: "block+" },
      paragraph: { content: "text*", group: "block" },
      code_block: { content: "text*", group: "block", code: true },
      text: {},
    },
  });
}

function findFirstCodeBlockPosition(doc: ReturnType<Schema["nodes"]["doc"]["create"]>): number {
  let codePosition = -1;
  doc.descendants((node, position) => {
    if (node.type.name === "code_block") {
      codePosition = position;
      return false;
    }
  });
  expect(codePosition).toBeGreaterThanOrEqual(0);
  return codePosition;
}

function createMutableEditorView(initialState: EditorState): EditorView {
  let currentState = initialState;
  const view = {
    get state() {
      return currentState;
    },
    dispatch(transaction: Parameters<EditorView["dispatch"]>[0]) {
      currentState = currentState.apply(transaction);
    },
    focus() {},
  } as unknown as EditorView;

  return view;
}

function createKeyboardEventLike(
  key: string,
  options: Partial<Pick<KeyboardEvent, "altKey" | "ctrlKey" | "metaKey" | "shiftKey">> = {},
) {
  return {
    key,
    metaKey: options.metaKey ?? false,
    ctrlKey: options.ctrlKey ?? false,
    altKey: options.altKey ?? false,
    shiftKey: options.shiftKey ?? false,
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
  } as KeyboardEvent & { defaultPrevented: boolean };
}
