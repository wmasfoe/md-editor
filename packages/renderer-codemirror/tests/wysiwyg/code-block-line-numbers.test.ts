import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import {
  createCodeBlockLineNumberDecorations,
  type CodeBlockLogicalLine,
} from "../../src/../src/wysiwyg/code-block-line-numbers.ts";

describe("code-block line-number decorations", () => {
  it("decorates semantic line starts without introducing a global gutter", () => {
    const state = EditorState.create({ doc: "before\nfirst\nsecond\nafter" });
    const lines: readonly CodeBlockLogicalLine[] = [
      { from: state.doc.line(2).from, blockId: "block-a", lineNumber: 1, gutterDigits: 2 },
      { from: state.doc.line(3).from, blockId: "block-a", lineNumber: 2, gutterDigits: 2 },
    ];
    const decorations = createCodeBlockLineNumberDecorations(lines);
    const observed: Array<{ from: number; attributes: Record<string, string> }> = [];

    decorations.between(0, state.doc.length, (from, _to, decoration) => {
      observed.push({
        from,
        attributes: decoration.spec.attributes as Record<string, string>,
      });
    });

    expect(observed).toEqual([
      {
        from: state.doc.line(2).from,
        attributes: {
          class: "cm-md-code-line-numbered",
          "data-md-code-block-id": "block-a",
          "data-md-code-line-number": "1",
          style: "--md-code-line-number-width: 2ch",
        },
      },
      {
        from: state.doc.line(3).from,
        attributes: {
          class: "cm-md-code-line-numbered",
          "data-md-code-block-id": "block-a",
          "data-md-code-line-number": "2",
          style: "--md-code-line-number-width: 2ch",
        },
      },
    ]);
  });
});
