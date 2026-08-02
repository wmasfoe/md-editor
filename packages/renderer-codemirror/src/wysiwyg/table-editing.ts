import { EditorSelection, Transaction, type EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { authorizeWysiwygProtectedChange } from "./change-authorization.ts";
import { markdownRangeIndexField } from "../markdown/range-index.ts";
import type { MarkdownRangeRecord, MarkdownTableBlockMetadata } from "../markdown/range-types.ts";
import { splitTableRowCells } from "./table-projection.ts";

export type TableRowKind = "header" | "body";

export interface TableCellAddress {
  readonly recordId: string;
  readonly rowKind: TableRowKind;
  /** body 行下标；header 固定为 0 */
  readonly rowIndex: number;
  readonly colIndex: number;
}

/**
 * 将单元格文本序列化为 GFM 管道行。
 * 单元格内的 `|` 转义为 `\|`，避免破坏列边界。
 */
export function serializeTableRow(cells: readonly string[], hasLeadingPipes: boolean): string {
  const escaped = cells.map((cell) => escapeTableCellText(cell));
  const body = escaped.join(" | ");
  return hasLeadingPipes ? `| ${body} |` : body;
}

export function escapeTableCellText(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
}

export function commitTableCell(
  view: EditorView,
  address: TableCellAddress,
  nextText: string,
): boolean {
  const record = view.state.field(markdownRangeIndexField).get(address.recordId);
  if (!record?.tableBlock) {
    return false;
  }
  const change = buildCellReplacement(view.state, record, address, nextText);
  if (!change) {
    return false;
  }
  if (change.from === change.to && change.insert === "") {
    return true;
  }
  const current = view.state.sliceDoc(change.from, change.to);
  if (current === change.insert) {
    return true;
  }
  view.dispatch({
    changes: { from: change.from, to: change.to, insert: change.insert },
    annotations: [Transaction.addToHistory.of(true), authorizeWysiwygProtectedChange.of(true)],
    userEvent: "input.type",
  });
  return true;
}

/**
 * 表格末尾 Enter：退出表格并在下方续写新段落。
 * - 表格后已有空行分隔 → 光标落到空行，不新增内容；
 * - 表格后只有单个换行或紧贴正文 → 补足空行后光标落到新段落。
 */
export function exitTableWithParagraph(view: EditorView, recordId: string): boolean {
  const record = view.state.field(markdownRangeIndexField).get(recordId);
  if (!record) {
    return false;
  }
  const insertAt = record.fullRange.to;
  const rest = view.state.doc.sliceString(insertAt, insertAt + 2);
  if (rest.startsWith("\n\n")) {
    view.dispatch({
      selection: EditorSelection.cursor(insertAt + 1),
      annotations: Transaction.addToHistory.of(false),
      userEvent: "select",
    });
    return true;
  }
  const insert = rest.startsWith("\n") ? "\n" : "\n\n";
  view.dispatch({
    changes: { from: insertAt, to: insertAt, insert },
    selection: EditorSelection.cursor(insertAt + insert.length),
    annotations: [Transaction.addToHistory.of(true), authorizeWysiwygProtectedChange.of(true)],
    userEvent: "input.type",
  });
  return true;
}

export function insertTableBodyRow(
  view: EditorView,
  recordId: string,
  afterBodyIndex: number,
): boolean {
  const record = view.state.field(markdownRangeIndexField).get(recordId);
  const table = record?.tableBlock;
  if (!record || !table) {
    return false;
  }
  const columnCount = Math.max(table.columnCount, 1);
  // 使用单个空格占位：纯空单元格在部分 GFM 解析路径上可能不稳定。
  const emptyCells = Array.from({ length: columnCount }, () => " ");
  const rowText = serializeTableRow(emptyCells, table.hasLeadingPipes);
  const anchor =
    afterBodyIndex < 0
      ? table.delimiterRowRange
      : (table.bodyRowRanges[afterBodyIndex] ??
        table.bodyRowRanges.at(-1) ??
        table.delimiterRowRange);
  if (!anchor) {
    return false;
  }
  // 锚点行末若没有换行（文档末尾），先补 `\n` 再写入新行，避免粘成一行。
  const anchorLine = view.state.doc.lineAt(Math.min(anchor.to, view.state.doc.length));
  const needsBreak =
    anchorLine.to >= view.state.doc.length ||
    view.state.sliceDoc(anchorLine.to, anchorLine.to + 1) !== "\n";
  const insertAt = needsBreak ? anchorLine.to : anchorLine.to + 1;
  const insert = needsBreak ? `\n${rowText}\n` : `${rowText}\n`;
  view.dispatch({
    changes: { from: insertAt, to: insertAt, insert },
    annotations: [Transaction.addToHistory.of(true), authorizeWysiwygProtectedChange.of(true)],
    userEvent: "input.type",
  });
  return true;
}

export function deleteTableBodyRow(view: EditorView, recordId: string, bodyIndex: number): boolean {
  const record = view.state.field(markdownRangeIndexField).get(recordId);
  const table = record?.tableBlock;
  if (!record || !table || bodyIndex < 0 || bodyIndex >= table.bodyRowRanges.length) {
    return false;
  }
  // 至少保留表头 + delimiter；允许删除到 0 个 body 行。
  const range = table.bodyRowRanges[bodyIndex];
  const line = view.state.doc.lineAt(range.from);
  const from = line.from;
  // 优先吃掉本行尾换行；若是文档最后一行则只删到行尾。
  const to = line.to < view.state.doc.length ? line.to + 1 : line.to;
  view.dispatch({
    changes: { from, to, insert: "" },
    annotations: [Transaction.addToHistory.of(true), authorizeWysiwygProtectedChange.of(true)],
    userEvent: "delete.forward",
  });
  return true;
}

export function insertTableColumn(view: EditorView, recordId: string, atColIndex: number): boolean {
  const record = view.state.field(markdownRangeIndexField).get(recordId);
  const table = record?.tableBlock;
  if (!record || !table?.headerRowRange || !table.delimiterRowRange) {
    return false;
  }
  const col = Math.max(0, Math.min(atColIndex, table.columnCount));
  const changes = [
    ...rowInsertColumnChange(view.state, table.headerRowRange, table, col, ""),
    ...rowInsertColumnChange(view.state, table.delimiterRowRange, table, col, "---"),
    ...table.bodyRowRanges.flatMap((range) =>
      rowInsertColumnChange(view.state, range, table, col, ""),
    ),
  ];
  if (changes.length === 0) {
    return false;
  }
  view.dispatch({
    changes,
    annotations: [Transaction.addToHistory.of(true), authorizeWysiwygProtectedChange.of(true)],
    userEvent: "input.type",
  });
  return true;
}

export function deleteTableColumn(view: EditorView, recordId: string, colIndex: number): boolean {
  const record = view.state.field(markdownRangeIndexField).get(recordId);
  const table = record?.tableBlock;
  if (!record || !table?.headerRowRange || !table.delimiterRowRange) {
    return false;
  }
  if (table.columnCount <= 1 || colIndex < 0 || colIndex >= table.columnCount) {
    return false;
  }
  const changes = [
    ...rowDeleteColumnChange(view.state, table.headerRowRange, table, colIndex),
    ...rowDeleteColumnChange(view.state, table.delimiterRowRange, table, colIndex),
    ...table.bodyRowRanges.flatMap((range) =>
      rowDeleteColumnChange(view.state, range, table, colIndex),
    ),
  ];
  view.dispatch({
    changes,
    annotations: [Transaction.addToHistory.of(true), authorizeWysiwygProtectedChange.of(true)],
    userEvent: "delete.forward",
  });
  return true;
}

function buildCellReplacement(
  state: EditorState,
  record: MarkdownRangeRecord,
  address: TableCellAddress,
  nextText: string,
): { readonly from: number; readonly to: number; readonly insert: string } | null {
  const table = record.tableBlock;
  if (!table) {
    return null;
  }
  const rowRange =
    address.rowKind === "header"
      ? table.headerRowRange
      : (table.bodyRowRanges[address.rowIndex] ?? null);
  if (!rowRange) {
    return null;
  }
  const lineText = state.sliceDoc(rowRange.from, rowRange.to);
  const cells = [...splitTableRowCells(lineText, table.hasLeadingPipes)];
  while (cells.length <= address.colIndex) {
    cells.push("");
  }
  // serializeTableRow 负责转义；此处只写入原始单元格文本。
  cells[address.colIndex] = nextText.replace(/\r?\n/g, " ").trim();
  return {
    from: rowRange.from,
    to: rowRange.to,
    insert: serializeTableRow(cells, table.hasLeadingPipes),
  };
}

function rowInsertColumnChange(
  state: EditorState,
  rowRange: { readonly from: number; readonly to: number },
  table: MarkdownTableBlockMetadata,
  colIndex: number,
  cellText: string,
): readonly { readonly from: number; readonly to: number; readonly insert: string }[] {
  const lineText = state.sliceDoc(rowRange.from, rowRange.to);
  const cells = [...splitTableRowCells(lineText, table.hasLeadingPipes)];
  while (cells.length < table.columnCount) {
    cells.push("");
  }
  cells.splice(colIndex, 0, cellText);
  return [
    {
      from: rowRange.from,
      to: rowRange.to,
      insert: serializeTableRow(cells, table.hasLeadingPipes),
    },
  ];
}

function rowDeleteColumnChange(
  state: EditorState,
  rowRange: { readonly from: number; readonly to: number },
  table: MarkdownTableBlockMetadata,
  colIndex: number,
): readonly { readonly from: number; readonly to: number; readonly insert: string }[] {
  const lineText = state.sliceDoc(rowRange.from, rowRange.to);
  const cells = [...splitTableRowCells(lineText, table.hasLeadingPipes)];
  if (colIndex >= cells.length) {
    return [];
  }
  cells.splice(colIndex, 1);
  return [
    {
      from: rowRange.from,
      to: rowRange.to,
      insert: serializeTableRow(cells, table.hasLeadingPipes),
    },
  ];
}
