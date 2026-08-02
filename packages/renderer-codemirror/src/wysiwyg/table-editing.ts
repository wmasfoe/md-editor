import { EditorSelection, Transaction, type EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { authorizeWysiwygProtectedChange } from "./change-authorization.ts";
import { markdownRangeIndexField } from "../markdown/range-index.ts";
import type {
  MarkdownRangeRecord,
  MarkdownTableCellAlignment,
  MarkdownTableBlockMetadata,
} from "../markdown/range-types.ts";
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
 * 表格必须以空行终止（GFM 会把紧随表格的非空行并入表格），
 * 因此续写段落要落在终止空行之后的“新空行”上，而不是终止空行本身
 * （否则打字会吞掉终止空行，表格范围随之吞掉后续正文）。
 * record.fullRange.to 是最后一行单元格文本的结尾（行尾换行在记录之外），
 * 故 insertAt 处的 rest 由“行尾换行 + 终止空行/正文”组成。
 */
export function exitTableWithParagraph(view: EditorView, recordId: string): boolean {
  const record = view.state.field(markdownRangeIndexField).get(recordId);
  if (!record) {
    return false;
  }
  const insertAt = record.fullRange.to;
  const rest = view.state.doc.sliceString(insertAt, insertAt + 2);
  let changes: { from: number; to: number; insert: string };
  if (rest.startsWith("\n\n")) {
    // 已有终止空行：在其后补“新空行 + 分隔空行”，光标落到新空行。
    changes = { from: insertAt + 1, to: insertAt + 1, insert: "\n\n" };
  } else if (rest.startsWith("\n")) {
    // 只有行尾换行（其后是正文或文档末尾）：补终止空行 + 新空行 + 分隔空行。
    changes = { from: insertAt + 1, to: insertAt + 1, insert: "\n\n\n" };
  } else {
    // 表格后无换行（文档末尾）：补行尾换行 + 终止空行 + 新空行。
    changes = { from: insertAt, to: insertAt, insert: "\n\n" };
  }
  view.dispatch({
    changes,
    // 光标统一落在“新空行”上（insertAt+1 与 insertAt+2 之间的那条空行）：
    // 在此打字后文档为“行、空行、新段落、空行、后续正文”。
    selection: EditorSelection.cursor(insertAt + 2),
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

/** GFM delimiter 对齐标记：`---`（none）/ `:---`（left）/ `:---:`（center）/ `---:`（right）。 */
export const TABLE_DELIMITER_ALIGNMENT: Record<MarkdownTableCellAlignment, string> = {
  none: "---",
  left: ":---",
  center: ":---:",
  right: "---:",
};

/**
 * 切换某列对齐：只重写 delimiter 行对应列的分隔标记。
 * 对齐效果由 projection 解析 delimiter 后经内联样式呈现。
 */
export function setTableColumnAlignment(
  view: EditorView,
  recordId: string,
  colIndex: number,
  alignment: MarkdownTableCellAlignment,
): boolean {
  const record = view.state.field(markdownRangeIndexField).get(recordId);
  const table = record?.tableBlock;
  if (!record || !table?.delimiterRowRange || colIndex < 0 || colIndex >= table.columnCount) {
    return false;
  }
  const lineText = view.state.sliceDoc(table.delimiterRowRange.from, table.delimiterRowRange.to);
  const cells = [...splitTableRowCells(lineText, table.hasLeadingPipes)];
  while (cells.length <= colIndex) {
    cells.push("");
  }
  cells[colIndex] = TABLE_DELIMITER_ALIGNMENT[alignment];
  view.dispatch({
    changes: {
      from: table.delimiterRowRange.from,
      to: table.delimiterRowRange.to,
      insert: serializeTableRow(cells, table.hasLeadingPipes),
    },
    annotations: [Transaction.addToHistory.of(true), authorizeWysiwygProtectedChange.of(true)],
    userEvent: "input.type",
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
