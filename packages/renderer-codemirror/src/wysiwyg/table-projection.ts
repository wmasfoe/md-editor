import type { EditorState, Extension, Range } from "@codemirror/state";
import { Decoration, EditorView } from "@codemirror/view";
import { getWysiwygDiagnostics } from "../diagnostics.ts";
import type { MarkdownRangeRecord, SourceRange } from "../markdown/range-types.ts";
import { TableGridWidget, type TableGridValue } from "./widgets/table-widget.ts";

export function isProjectableTable(record: MarkdownRangeRecord): boolean {
  return (
    record.kind === "table" &&
    record.parserCoverage === "complete" &&
    record.tableBlock !== undefined &&
    record.tableBlock.delimiterRowRange !== null
  );
}

/**
 * 始终显示可视化网格：单元格在 widget 内 contenteditable 编辑，
 * 不再因光标进入而回显 GFM 源码。
 */
export function buildTableLayoutDecorations(
  record: MarkdownRangeRecord,
  _active: boolean,
  selected: boolean,
  state: EditorState,
): readonly Range<Decoration>[] {
  if (!isProjectableTable(record) || !record.tableBlock) {
    return [];
  }
  const value = buildTableGridValue(record, state);
  if (!value) {
    return [];
  }
  const replacementTo = trailingLineBreakEnd(record, state);
  return [
    Decoration.replace({
      widget: new TableGridWidget({ ...value, selected }),
      inclusive: false,
      block: true,
      wysiwygRecordId: record.id,
      wysiwygRole: "table-widget",
    }).range(record.fullRange.from, replacementTo),
  ];
}

/** 整表始终 atomic，光标无法落入源码管道文本。 */
export function buildTableAtomicRanges(
  record: MarkdownRangeRecord,
  _active: boolean,
): readonly Range<Decoration>[] {
  if (!isProjectableTable(record)) {
    return [];
  }
  return [
    Decoration.mark({
      wysiwygRecordId: record.id,
      wysiwygRole: "table-widget-atomic",
    }).range(record.fullRange.from, record.fullRange.to),
  ];
}

/** 整表始终 protected；单元格编辑经 authorizeWysiwygProtectedChange 授权写入。 */
export function getTableProtectedRanges(
  record: MarkdownRangeRecord,
  _active: boolean,
): readonly SourceRange[] {
  if (!isProjectableTable(record)) {
    return [];
  }
  return [record.fullRange];
}

export const tableProjectionTheme: Extension = EditorView.baseTheme({
  ".cm-md-table-line": {
    color: "var(--theme-text, currentColor)",
  },
  ".cm-md-table-line--header": {
    fontWeight: "600",
  },
  ".cm-md-table-line--delimiter": {
    color: "var(--theme-muted, currentColor)",
  },
  ".cm-md-table-line--body": {},
});

function buildTableGridValue(
  record: MarkdownRangeRecord,
  state: EditorState,
): TableGridValue | null {
  const table = record.tableBlock;
  if (!table || !table.headerRowRange) {
    return null;
  }
  const headerCells = splitTableRowCells(
    state.sliceDoc(table.headerRowRange.from, table.headerRowRange.to),
    table.hasLeadingPipes,
  );
  const bodyRows = table.bodyRowRanges.map((range) =>
    splitTableRowCells(state.sliceDoc(range.from, range.to), table.hasLeadingPipes),
  );
  return {
    recordId: record.id,
    headerCells,
    bodyRows,
    alignments: table.alignments,
    selected: false,
    diagnostics: getWysiwygDiagnostics(state),
  };
}

/**
 * 按 GFM 管道语义切分一行表格源码：先去掉行首/行尾可选管道，
 * 再按未转义的 `|` 切分，并 trim 每格空白。
 */
export function splitTableRowCells(line: string, hasLeadingPipes: boolean): readonly string[] {
  let trimmed = line.trim();
  if (hasLeadingPipes) {
    trimmed = trimmed.replace(/^\|/, "");
  }
  trimmed = trimmed.replace(/\|$/, "");
  if (!trimmed.trim()) {
    return [];
  }
  const cells: string[] = [];
  let buffer = "";
  let escaped = false;
  for (const char of trimmed) {
    if (escaped) {
      buffer += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      buffer += char;
      continue;
    }
    if (char === "|") {
      cells.push(buffer.trim());
      buffer = "";
      continue;
    }
    buffer += char;
  }
  cells.push(buffer.trim());
  return cells;
}

function trailingLineBreakEnd(record: MarkdownRangeRecord, state: EditorState): number {
  return record.fullRange.to < state.doc.length &&
    state.sliceDoc(record.fullRange.to, record.fullRange.to + 1) === "\n"
    ? record.fullRange.to + 1
    : record.fullRange.to;
}
