import { RangeSetBuilder, type Extension } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";

export interface CodeBlockLogicalLine {
  readonly from: number;
  readonly blockId: string;
  readonly lineNumber: number;
  readonly gutterDigits: number;
}

export function createCodeBlockLineNumberDecorations(
  lines: readonly CodeBlockLogicalLine[],
): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const line of lines) {
    builder.add(
      line.from,
      line.from,
      Decoration.line({
        attributes: {
          class: "cm-md-code-line-numbered",
          "data-md-code-block-id": line.blockId,
          "data-md-code-line-number": String(line.lineNumber),
          style: `--md-code-line-number-width: ${String(line.gutterDigits)}ch`,
        },
      }),
    );
  }
  return builder.finish();
}

export const codeBlockLineNumberTheme: Extension = EditorView.baseTheme({
  ".cm-content .cm-md-code-line-numbered": {
    position: "relative",
    paddingInlineStart: "calc(var(--md-code-line-number-width) + 1.25rem)",
  },
  ".cm-content .cm-md-code-line-numbered::before": {
    content: "attr(data-md-code-line-number)",
    position: "absolute",
    insetInlineStart: "0.25rem",
    width: "var(--md-code-line-number-width)",
    color: "var(--theme-muted, currentColor)",
    fontVariantNumeric: "tabular-nums",
    textAlign: "end",
    userSelect: "none",
  },
});
