import {
  Facet,
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
  type Range,
} from "@codemirror/state";
import { Decoration, EditorView } from "@codemirror/view";
import { getWysiwygDiagnostics } from "../diagnostics.ts";
import type {
  MarkdownCodeBlockMetadata,
  MarkdownRangeRecord,
  SourceRange,
} from "../markdown/range-types.ts";
import { type CodeBlockLogicalLine } from "./code-block-line-numbers.ts";
import { CodeBlockToolbarWidget } from "./widgets/code-block-toolbar-widget.ts";

export const setCodeBlockLineNumbersEffect = StateEffect.define<boolean>();

export const initialCodeBlockLineNumbersFacet = Facet.define<boolean, boolean>({
  combine(values) {
    return values.at(-1) ?? false;
  },
});

export const codeBlockLineNumbersField = StateField.define<boolean>({
  create(state) {
    return state.facet(initialCodeBlockLineNumbersFacet);
  },
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setCodeBlockLineNumbersEffect)) {
        return effect.value;
      }
    }
    return value;
  },
});

export function isProjectableCodeBlock(record: MarkdownRangeRecord): boolean {
  return (
    record.kind === "deferred-code" &&
    record.parserCoverage === "complete" &&
    record.codeBlock?.blockStatus === "closed"
  );
}

export function getFencedCodeBlockBodyRange(
  state: EditorState,
  record: MarkdownRangeRecord,
): SourceRange | null {
  const metadata = record.codeBlock;
  if (
    metadata?.blockKind !== "fenced" ||
    !metadata.openingFenceRange ||
    !metadata.closingFenceRange
  ) {
    return null;
  }
  const openingLine = state.doc.lineAt(metadata.openingFenceRange.to);
  const closingLine = state.doc.lineAt(metadata.closingFenceRange.from);
  return {
    from: Math.min(openingLine.to + 1, state.doc.length),
    to: closingLine.from,
  };
}

export function getEmptyFencedCodeBlockBodyAnchor(
  state: EditorState,
  record: MarkdownRangeRecord,
): number | null {
  const bodyRange = getFencedCodeBlockBodyRange(state, record);
  return bodyRange && bodyRange.from === bodyRange.to ? bodyRange.from : null;
}

export function buildCodeBlockLayoutDecorations(
  record: MarkdownRangeRecord,
  active: boolean,
  lineNumbers: boolean,
  state: EditorState,
): readonly Range<Decoration>[] {
  if (!isProjectableCodeBlock(record) || !record.codeBlock) {
    return [];
  }

  return [
    ...buildHiddenSyntaxDecorations(record),
    ...buildStructuralLineDecorations(record, state),
    ...buildBodyLineDecorations(record, active, lineNumbers, state),
    Decoration.widget({
      widget: new CodeBlockToolbarWidget({
        recordId: record.id,
        blockKind: record.codeBlock.blockKind,
        languageLabel:
          record.codeBlock.languageInfo.resolvedName ??
          (record.codeBlock.languageInfo.token || "Plain"),
        active,
        diagnostics: getWysiwygDiagnostics(state),
      }),
      block: true,
      side: -1,
      wysiwygRecordId: record.id,
    }).range(record.codeBlock.sourceBlockRange.from),
  ];
}

export function buildCodeBlockAtomicRanges(
  record: MarkdownRangeRecord,
  _state: EditorState,
): readonly Range<Decoration>[] {
  return getCodeBlockProtectedRanges(record).map((range) =>
    Decoration.replace({
      inclusive: true,
      wysiwygRecordId: record.id,
      atomic: true,
    }).range(range.from, range.to),
  );
}

export function getCodeBlockProtectedRanges(record: MarkdownRangeRecord): readonly SourceRange[] {
  if (!isProjectableCodeBlock(record) || !record.codeBlock) {
    return [];
  }
  return freezeRanges(
    [
      record.codeBlock.openingFenceRange,
      record.codeBlock.rawInfoRange,
      record.codeBlock.closingFenceRange,
      ...record.codeBlock.syntaxIndentRanges,
    ].filter((range): range is SourceRange => range !== null && range.from < range.to),
  );
}

export const codeBlockProjectionTheme: Extension = EditorView.baseTheme({
  ".cm-md-code-toolbar": {
    display: "flex",
    gap: "0.375rem",
    alignItems: "center",
    paddingBlock: "0.125rem",
    color: "var(--theme-muted, currentColor)",
    fontSize: "0.75rem",
  },
  ".cm-md-code-toolbar--active": {
    color: "var(--theme-text, currentColor)",
  },
  ".cm-md-code-toolbar button, .cm-md-code-toolbar select": {
    font: "inherit",
  },
  ".cm-md-code-toolbar__status": {
    display: "inline-block",
    minWidth: "5.5rem",
  },
  ".cm-md-code-line": {
    fontFamily: "var(--md-editor-code-font-family, ui-monospace, SFMono-Regular, Menlo, monospace)",
    backgroundColor: "var(--theme-code-bg, var(--theme-bg-muted, transparent))",
  },
  ".cm-md-code-line--active": {
    backgroundColor: "var(--theme-code-bg, var(--theme-bg-muted, transparent))",
  },
  ".cm-md-code-structural-line-hidden": {
    height: "0",
    lineHeight: "0",
    overflow: "hidden",
    paddingBlock: "0",
  },
});

function buildHiddenSyntaxDecorations(record: MarkdownRangeRecord): readonly Range<Decoration>[] {
  const ranges = getCodeBlockProtectedRanges(record);
  return ranges.map((range) =>
    Decoration.replace({
      inclusive: true,
      wysiwygRecordId: record.id,
      hiddenCodeBlockSyntax: true,
    }).range(range.from, range.to),
  );
}

function buildStructuralLineDecorations(
  record: MarkdownRangeRecord,
  state: EditorState,
): readonly Range<Decoration>[] {
  if (!record.codeBlock || record.codeBlock.blockKind !== "fenced") {
    return [];
  }
  const emptyBodyAnchor = getEmptyFencedCodeBlockBodyAnchor(state, record);
  return [record.codeBlock.openingFenceRange, record.codeBlock.closingFenceRange]
    .filter((range): range is SourceRange => range !== null)
    .filter((range) => range.from !== emptyBodyAnchor)
    .map((range) =>
      Decoration.line({
        attributes: {
          class: "cm-md-code-structural-line-hidden",
          "aria-hidden": "true",
          "data-md-code-block-id": record.id,
          "data-md-code-structural-line": "fence",
        },
        wysiwygRecordId: record.id,
      }).range(range.from),
    );
}

function buildBodyLineDecorations(
  record: MarkdownRangeRecord,
  active: boolean,
  lineNumbers: boolean,
  state: EditorState,
): readonly Range<Decoration>[] {
  if (!record.codeBlock) {
    return [];
  }
  const logicalLines = collectCodeBlockLogicalLines(record, state);
  return logicalLines.map((line, index) => {
    const classes = ["cm-md-code-line"];
    if (index === 0) {
      classes.push("cm-md-code-line--first");
    }
    if (index === logicalLines.length - 1) {
      classes.push("cm-md-code-line--last");
    }
    if (active) {
      classes.push("cm-md-code-line--active");
    }
    const numbered = lineNumbers ? line : null;
    if (numbered) {
      classes.push("cm-md-code-line-numbered");
    }
    return Decoration.line({
      attributes: {
        class: classes.join(" "),
        "data-md-code-block-id": record.id,
        ...(numbered
          ? {
              "data-md-code-line-number": String(numbered.lineNumber),
              style: `--md-code-line-number-width: ${String(numbered.gutterDigits)}ch`,
            }
          : {}),
      },
      wysiwygRecordId: record.id,
    }).range(line.from);
  });
}

function collectCodeBlockLogicalLines(
  record: MarkdownRangeRecord,
  state: EditorState,
): readonly CodeBlockLogicalLine[] {
  const metadata = record.codeBlock;
  if (!metadata) {
    return [];
  }
  const starts = collectSemanticLineStarts(metadata, state);
  const gutterDigits = Math.max(1, String(starts.length).length);
  return Object.freeze(
    starts.map((from, index) =>
      Object.freeze({
        from,
        blockId: record.id,
        lineNumber: index + 1,
        gutterDigits,
      }),
    ),
  );
}

function collectSemanticLineStarts(
  metadata: MarkdownCodeBlockMetadata,
  state: EditorState,
): readonly number[] {
  const starts = new Set<number>();
  if (
    metadata.blockKind === "fenced" &&
    metadata.bodySegments.length === 0 &&
    metadata.closingFenceRange
  ) {
    starts.add(metadata.closingFenceRange.from);
  }
  for (const segment of metadata.bodySegments) {
    if (segment.from > segment.to) {
      continue;
    }
    let position = segment.from;
    while (position <= segment.to && position <= state.doc.length) {
      const line = state.doc.lineAt(Math.min(position, state.doc.length));
      const lineStart = metadata.blockKind === "indented" ? line.from : position;
      starts.add(lineStart);
      if (line.to >= segment.to || line.to === state.doc.length) {
        break;
      }
      position = line.to + 1;
    }
  }
  const orderedStarts = [...starts];
  // oxlint-disable-next-line unicorn/no-array-sort -- The production TypeScript target is ES2022.
  orderedStarts.sort((left, right) => left - right);
  return Object.freeze(orderedStarts);
}

function freezeRanges(ranges: readonly SourceRange[]): readonly SourceRange[] {
  return Object.freeze(ranges.map((range) => Object.freeze({ ...range })));
}
