import { markdown } from "@codemirror/lang-markdown";
import { EditorSelection, EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { provideWysiwygDiagnostics, WysiwygDiagnostics } from "../../src/diagnostics.ts";
import { M1_MARKDOWN_EXTENSIONS } from "../../src/markdown/extensions.ts";
import { markdownRangeIndexField } from "../../src/markdown/range-index.ts";
import { editorModeField } from "../../src/mode.ts";
import { wysiwygChangeProtection } from "../../src/wysiwyg/change-protection.ts";
import { codeBlockSelectionExtension } from "../../src/wysiwyg/code-block-selection.ts";
import {
  codeBlockLineNumbersField,
  CodeBlockSpacerWidget,
} from "../../src/wysiwyg/code-block-projection.ts";
import {
  configureWysiwygProjectionFeatures,
  wysiwygProjectionField,
} from "../../src/wysiwyg/projection-state.ts";

function createHarness(doc: string, selection: EditorSelection = EditorSelection.single(0)) {
  const diagnostics = new WysiwygDiagnostics();
  const state = EditorState.create({
    doc,
    selection,
    extensions: [
      markdown({ extensions: M1_MARKDOWN_EXTENSIONS, addKeymap: false }),
      EditorState.allowMultipleSelections.of(true),
      provideWysiwygDiagnostics(diagnostics),
      editorModeField,
      markdownRangeIndexField,
      configureWysiwygProjectionFeatures(["blocks"]),
      codeBlockLineNumbersField,
      wysiwygProjectionField,
      wysiwygChangeProtection,
      codeBlockSelectionExtension,
    ],
  });
  return { state, diagnostics };
}

describe("code block atomic selection and deletion", () => {
  const doc = "hello\n\n```js\nconsole.log(1);\n```\n\nworld\n";
  // Indices:
  // "hello\n\n" -> 0..7
  // "```js\nconsole.log(1);\n```" -> 7..33
  // "\n\nworld\n" -> 33..41

  it("atomically expands selection to full code block when dragging from preceding text into code block", () => {
    const { state } = createHarness(doc);
    const codeBlockStart = doc.indexOf("```js");
    const codeBodyPos = doc.indexOf("console");

    // Select from "hello" (pos 0) into code block body
    const transaction = state.update({
      selection: EditorSelection.range(0, codeBodyPos + 5),
      userEvent: "select.pointer",
    });

    // The selection should atomically expand to cover the full code block (including trailing newline)
    const codeBlockEnd = doc.indexOf("```\n", codeBlockStart) + 4; // includes trailing newline
    expect(transaction.selection?.main.from).toBe(0);
    expect(transaction.selection?.main.to).toBe(codeBlockEnd);

    // Pressing Delete on this expanded selection should delete the code block and preceding text
    const deleteTransaction = transaction.state.update({
      changes: {
        from: transaction.selection!.main.from,
        to: transaction.selection!.main.to,
        insert: "",
      },
      userEvent: "delete.selection",
    });

    expect(deleteTransaction.docChanged).toBe(true);
    expect(deleteTransaction.state.doc.toString()).toBe("\nworld\n");
  });

  it("atomically expands selection to full code block when dragging backwards from subsequent text into code block", () => {
    const { state } = createHarness(doc);
    const codeBlockStart = doc.indexOf("```js");
    const worldPos = doc.indexOf("world");
    const codeBodyPos = doc.indexOf("console");

    // Select backwards from "world" into code block body
    const transaction = state.update({
      selection: EditorSelection.range(worldPos + 5, codeBodyPos),
      userEvent: "select.pointer",
    });

    // Backward selection: head snaps to codeBlockStart, anchor stays at world + 5
    expect(transaction.selection?.main.head).toBe(codeBlockStart);
    expect(transaction.selection?.main.anchor).toBe(worldPos + 5);

    // Pressing Delete should delete the code block and "world"
    const deleteTransaction = transaction.state.update({
      changes: {
        from: transaction.selection!.main.from,
        to: transaction.selection!.main.to,
        insert: "",
      },
      userEvent: "delete.selection",
    });

    expect(deleteTransaction.docChanged).toBe(true);
    expect(deleteTransaction.state.doc.toString()).toBe("hello\n\n\n");
  });

  it("atomically expands selection to full code block when dragging from inside code block to outside", () => {
    const { state } = createHarness(doc);
    const codeBlockStart = doc.indexOf("```js");
    const worldPos = doc.indexOf("world");
    const codeBodyPos = doc.indexOf("console");

    // Drag from inside code block body out to "world"
    const transaction = state.update({
      selection: EditorSelection.range(codeBodyPos, worldPos + 5),
      userEvent: "select.pointer",
    });

    // Anchor should expand backwards to codeBlockStart
    expect(transaction.selection?.main.from).toBe(codeBlockStart);
    expect(transaction.selection?.main.to).toBe(worldPos + 5);

    // Delete should succeed
    const deleteTransaction = transaction.state.update({
      changes: {
        from: transaction.selection!.main.from,
        to: transaction.selection!.main.to,
        insert: "",
      },
      userEvent: "delete.selection",
    });

    expect(deleteTransaction.docChanged).toBe(true);
    expect(deleteTransaction.state.doc.toString()).toBe("hello\n\n\n");
  });

  it("preserves internal selection within code block body without expanding", () => {
    const multiDoc = "```js\nconst a = 1;\nconst b = 2;\n```\n";
    const { state } = createHarness(multiDoc);
    const aPos = multiDoc.indexOf("const a");
    const bPos = multiDoc.indexOf("const b");

    // Select text within code block body
    const transaction = state.update({
      selection: EditorSelection.range(aPos, bPos + 6),
      userEvent: "select",
    });

    // Selection should remain precisely within body
    expect(transaction.selection?.main.from).toBe(aPos);
    expect(transaction.selection?.main.to).toBe(bPos + 6);

    // Delete should edit code text inside body without deleting fences
    const deleteTransaction = transaction.state.update({
      changes: {
        from: transaction.selection!.main.from,
        to: transaction.selection!.main.to,
        insert: "",
      },
      userEvent: "delete.selection",
    });

    expect(deleteTransaction.docChanged).toBe(true);
    expect(deleteTransaction.state.doc.toString()).toBe("```js\nb = 2;\n```\n");
  });

  it("allows direct deletion of entire code block when selected", () => {
    const { state } = createHarness(doc);
    const codeBlockStart = doc.indexOf("```js");
    const codeBlockEnd = doc.indexOf("```\n", codeBlockStart) + 4;

    const selected = state.update({
      selection: EditorSelection.range(codeBlockStart, codeBlockEnd),
    }).state;

    const deleteTransaction = selected.update({
      changes: { from: codeBlockStart, to: codeBlockEnd, insert: "" },
      userEvent: "delete.selection",
    });

    expect(deleteTransaction.docChanged).toBe(true);
    expect(deleteTransaction.state.doc.toString()).toBe("hello\n\n\nworld\n");
  });

  it("provides CodeBlockSpacerWidget with valid DOM and height", () => {
    const widget = new CodeBlockSpacerWidget();
    expect(widget.estimatedHeight).toBe(10);
    expect(widget.eq()).toBe(true);
  });
});
