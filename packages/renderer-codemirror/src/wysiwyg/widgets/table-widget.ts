import { WidgetType, type EditorView } from "@codemirror/view";
import type { WysiwygDiagnostics } from "../../diagnostics.ts";
import { markdownRangeIndexField } from "../../markdown/range-index.ts";
import { selectWysiwygAtom } from "../atom-selection.ts";
import { clearWysiwygAtomSelectionEffect } from "../projection-state.ts";
import type { MarkdownTableCellAlignment } from "../../markdown/range-types.ts";
import {
  commitTableCell,
  deleteTableBodyRow,
  deleteTableColumn,
  insertTableBodyRow,
  insertTableColumn,
  type TableCellAddress,
  type TableRowKind,
} from "../table-editing.ts";

/**
 * 可视化表格网格数据。单元格文本来自源码行切分（GFM 管道表格），
 * 对齐来自 M3-A 已解析的 delimiter 行对齐数组。
 */
export interface TableGridValue {
  readonly recordId: string;
  readonly headerCells: readonly string[];
  readonly bodyRows: readonly (readonly string[])[];
  readonly alignments: readonly MarkdownTableCellAlignment[];
  readonly selected: boolean;
  readonly diagnostics: WysiwygDiagnostics | null;
}

interface TableWidgetListeners {
  readonly pointerdown: EventListener;
  readonly focusin: EventListener;
  readonly focusout: EventListener;
  readonly keydown: EventListener;
  readonly actionClick: EventListener;
}

const listenersByDom = new WeakMap<HTMLElement, TableWidgetListeners>();
/** 正在编辑的单元格地址；blur 时提交，避免 updateDOM 打断输入。 */
const editingCellByDom = new WeakMap<HTMLElement, TableCellAddress>();
/** 最近一次退出编辑的单元格地址（按 recordId 记忆），供 Tab/Enter 重新进入。 */
const lastEditingCellByRecordId = new Map<string, TableCellAddress>();

/**
 * 始终显示的可视化表格（类 Excel）：
 * - 单元格 contenteditable 就地编辑，blur/Enter/Tab 回写 GFM 源码；
 * - 左键单击单元格即进入编辑（不拦截 pointerdown 默认行为）；
 * - 点击非单元格区域原子选中整表，Delete/Backspace 整块删除；
 * - 行/列分隔线悬停手柄：插入（分隔线下方/右侧）+ 删除（上方行/左侧列）。
 *   不引入嵌套 CM6 编辑器。
 */
export class TableGridWidget extends WidgetType {
  constructor(readonly value: TableGridValue) {
    super();
  }

  eq(other: TableGridWidget): boolean {
    const left = this.value;
    const right = other.value;
    return (
      left.recordId === right.recordId &&
      left.selected === right.selected &&
      equalStringRows(left.headerCells, right.headerCells) &&
      equalBodyRows(left.bodyRows, right.bodyRows) &&
      equalStrings(left.alignments, right.alignments)
    );
  }

  /** 允许单元格与手柄自行处理指针/键盘事件，不被 CM6 吞掉。 */
  ignoreEvent(event: Event): boolean {
    const target = event.target;
    if (!(target instanceof Element)) {
      return false;
    }
    return Boolean(
      target.closest(
        ".cm-md-table-widget__cell, .cm-md-table-widget__handle, .cm-md-table-widget__btn",
      ),
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const document = view.dom.ownerDocument;
    const wrapper = document.createElement("div");
    wrapper.className = "cm-md-table-widget";
    wrapper.setAttribute("role", "group");
    wrapper.setAttribute("aria-label", "Markdown table");
    wrapper.setAttribute("tabindex", "-1");

    const table = document.createElement("table");
    table.className = "cm-md-table-widget__grid";
    table.setAttribute("role", "grid");

    const tableHead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    this.value.headerCells.forEach((cellText, colIndex) => {
      const cell = createEditableCell(document, "th", cellText, "header", 0, colIndex, this.value);
      // 列分隔线手柄：悬停第 colIndex 列右边界 → 删除左侧列 / 在右侧插入列。
      cell.append(createColumnHandle(document, colIndex, this.value.headerCells.length));
      headerRow.append(cell);
    });
    tableHead.append(headerRow);
    table.append(tableHead);

    const tableBody = document.createElement("tbody");
    this.value.bodyRows.forEach((row, rowIndex) => {
      const tr = document.createElement("tr");
      const columnCount = Math.max(
        this.value.headerCells.length,
        row.length,
        this.value.alignments.length,
      );
      for (let colIndex = 0; colIndex < columnCount; colIndex += 1) {
        const cell = createEditableCell(
          document,
          "td",
          row[colIndex] ?? "",
          "body",
          rowIndex,
          colIndex,
          this.value,
        );
        // 行分隔线手柄放在每行第一列顶部：悬停该行上边界。
        if (colIndex === 0) {
          cell.append(createRowHandle(document, rowIndex, this.value.bodyRows.length));
        }
        tr.append(cell);
      }
      tableBody.append(tr);
    });
    table.append(tableBody);

    wrapper.append(table);

    const pointerdown: EventListener = (event) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      if (target.closest(".cm-md-table-widget__cell, .cm-md-table-widget__btn")) {
        // 单元格/手柄按钮：不拦截默认行为（让浏览器把焦点交给 contenteditable）；
        // 若表格正处于原子选中态，先清除选中高亮。
        if (this.value.selected) {
          view.dispatch({
            effects: clearWysiwygAtomSelectionEffect.of(null),
            userEvent: "select",
          });
        }
        return;
      }
      // 点击表格空白/边框：原子选中整表，便于 Delete 整块删除。
      event.preventDefault();
      selectWysiwygAtom(
        view,
        wrapper.dataset.recordId ?? this.value.recordId,
        (event as MouseEvent).metaKey || (event as MouseEvent).ctrlKey,
      );
    };

    const focusin: EventListener = (event) => {
      const cell = cellElementFromEvent(event);
      if (!cell) {
        return;
      }
      const address = addressFromCell(cell, this.value.recordId);
      if (address) {
        editingCellByDom.set(wrapper, address);
        lastEditingCellByRecordId.set(this.value.recordId, address);
      }
      cell.classList.add("cm-md-table-widget__cell--editing");
    };

    const focusout: EventListener = (event) => {
      const cell = cellElementFromEvent(event);
      if (!cell) {
        return;
      }
      cell.classList.remove("cm-md-table-widget__cell--editing");
      // relatedTarget 仍在同一表格内时，由 keydown 导航负责提交；否则 blur 提交。
      const next = (event as FocusEvent).relatedTarget;
      if (next instanceof Node && wrapper.contains(next)) {
        return;
      }
      flushCellCommit(view, wrapper, cell, this.value.recordId);
    };

    const keydown: EventListener = (event) => {
      const keyEvent = event as KeyboardEvent;
      const cell = cellElementFromEvent(event);
      if (!cell) {
        return;
      }
      if (keyEvent.key === "Enter") {
        keyEvent.preventDefault();
        keyEvent.stopPropagation();
        flushCellCommit(view, wrapper, cell, this.value.recordId);
        moveCellFocus(wrapper, cell, "down");
        return;
      }
      if (keyEvent.key === "Tab") {
        keyEvent.preventDefault();
        keyEvent.stopPropagation();
        flushCellCommit(view, wrapper, cell, keyEvent.shiftKey ? "left" : "right");
        return;
      }
      if (keyEvent.key === "Escape") {
        keyEvent.preventDefault();
        keyEvent.stopPropagation();
        // 取消：恢复源码文本并退出编辑，同时记住退出位置。
        const address = addressFromCell(cell, this.value.recordId);
        if (address) {
          cell.textContent = sourceCellText(this.value, address);
          lastEditingCellByRecordId.set(this.value.recordId, address);
        }
        editingCellByDom.delete(wrapper);
        cell.blur();
        view.focus();
        return;
      }
      // 单元格内 Cmd/Ctrl+A：先提交当前单元格编辑，再原子选中整表；
      // 焦点随之回到 CM6，再次 Cmd+A 由 CM6 默认 selectAll 扩展到全文。
      // （contenteditable 的浏览器默认只会选中当前单元格文本。）
      if (keyEvent.key === "a" && (keyEvent.metaKey || keyEvent.ctrlKey)) {
        flushCellCommit(view, wrapper, cell, this.value.recordId);
        if (selectWysiwygAtom(view, wrapper.dataset.recordId ?? this.value.recordId)) {
          keyEvent.preventDefault();
          keyEvent.stopPropagation();
        }
        return;
      }
    };

    const actionClick: EventListener = (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }
      const button = target.closest<HTMLElement>("[data-table-action]");
      if (!button) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const recordId = wrapper.dataset.recordId ?? this.value.recordId;
      const action = button.dataset.tableAction;
      if (action === "add-row") {
        insertTableBodyRow(view, recordId, Number(button.dataset.rowIndex ?? -1));
      } else if (action === "del-row") {
        deleteTableBodyRow(view, recordId, Number(button.dataset.rowIndex));
      } else if (action === "add-col") {
        insertTableColumn(view, recordId, Number(button.dataset.colIndex));
      } else if (action === "del-col") {
        deleteTableColumn(view, recordId, Number(button.dataset.colIndex));
      }
    };

    wrapper.addEventListener("pointerdown", pointerdown);
    wrapper.addEventListener("focusin", focusin);
    wrapper.addEventListener("focusout", focusout);
    wrapper.addEventListener("keydown", keydown);
    wrapper.addEventListener("click", actionClick);
    listenersByDom.set(wrapper, { pointerdown, focusin, focusout, keydown, actionClick });
    updateTableGridDom(wrapper, this.value);
    this.value.diagnostics?.recordWidgetLifecycle("table", "create");
    return wrapper;
  }

  updateDOM(dom: HTMLElement): boolean {
    // 单元格正在编辑时跳过结构同步，避免打断 IME / 输入。
    if (editingCellByDom.has(dom) && dom.contains(dom.ownerDocument.activeElement)) {
      updateTableGridDom(dom, this.value);
      this.value.diagnostics?.recordWidgetLifecycle("table", "update");
      return true;
    }
    // 结构变化时返回 false，让 CM6 重建 widget（行列数变化）。
    const grid = dom.querySelector(".cm-md-table-widget__grid");
    if (!grid) {
      return false;
    }
    const headerCells = [...grid.querySelectorAll("thead th")];
    const bodyRows = [...grid.querySelectorAll("tbody tr")];
    if (
      headerCells.length !== this.value.headerCells.length ||
      bodyRows.length !== this.value.bodyRows.length
    ) {
      return false;
    }
    headerCells.forEach((cell, index) => {
      if (dom.ownerDocument.activeElement !== cell) {
        cell.textContent = this.value.headerCells[index] ?? "";
      }
    });
    bodyRows.forEach((row, rowIndex) => {
      const cells = [...row.querySelectorAll("td")];
      const sourceRow = this.value.bodyRows[rowIndex] ?? [];
      cells.forEach((cell, colIndex) => {
        if (dom.ownerDocument.activeElement !== cell) {
          cell.textContent = sourceRow[colIndex] ?? "";
        }
        const alignment = this.value.alignments[colIndex] ?? "none";
        (cell as HTMLElement).style.textAlign = alignment === "none" ? "" : alignment;
      });
    });
    updateTableGridDom(dom, this.value);
    this.value.diagnostics?.recordWidgetLifecycle("table", "update");
    return true;
  }

  destroy(dom: HTMLElement): void {
    const listeners = listenersByDom.get(dom);
    if (listeners) {
      dom.removeEventListener("pointerdown", listeners.pointerdown);
      dom.removeEventListener("focusin", listeners.focusin);
      dom.removeEventListener("focusout", listeners.focusout);
      dom.removeEventListener("keydown", listeners.keydown);
      dom.removeEventListener("click", listeners.actionClick);
      listenersByDom.delete(dom);
    }
    editingCellByDom.delete(dom);
    this.value.diagnostics?.recordWidgetLifecycle("table", "destroy");
  }
}

/**
 * 聚焦指定表格的第一个可编辑单元格（优先回到最近一次退出的单元格）。
 * 供整表原子选中态下 Tab/Enter 进入编辑使用。
 */
export function focusTableCellForRecord(view: EditorView, recordId: string): HTMLElement | null {
  const wrapper = view.dom.querySelector<HTMLElement>(
    `.cm-md-table-widget[data-record-id="${cssEscape(recordId)}"]`,
  );
  if (!wrapper) {
    return null;
  }
  const remembered = lastEditingCellByRecordId.get(recordId);
  let target: HTMLElement | null = null;
  if (remembered) {
    target = wrapper.querySelector<HTMLElement>(
      `[data-row-kind="${remembered.rowKind}"][data-row-index="${remembered.rowIndex}"][data-col-index="${remembered.colIndex}"]`,
    );
  }
  target ??= wrapper.querySelector<HTMLElement>(
    '.cm-md-table-widget__cell[data-row-kind="header"][data-col-index="0"]',
  );
  if (!target) {
    return null;
  }
  target.focus();
  selectElementContents(target);
  return target;
}

/**
 * 整表原子选中态下进入单元格编辑（Tab/Enter）。
 * 命中条件：主选区恰好等于某个 table record 的 fullRange。
 */
export function enterSelectedTableCell(view: EditorView): boolean {
  const range = view.state.selection.main;
  if (range.empty) {
    return false;
  }
  const record = view.state
    .field(markdownRangeIndexField)
    .records.find(
      (candidate) =>
        candidate.kind === "table" &&
        candidate.parserCoverage === "complete" &&
        candidate.fullRange.from === range.from &&
        candidate.fullRange.to === range.to,
    );
  if (!record) {
    return false;
  }
  view.dispatch({
    effects: clearWysiwygAtomSelectionEffect.of(null),
    userEvent: "select",
  });
  return focusTableCellForRecord(view, record.id) !== null;
}

function cssEscape(value: string): string {
  return value.replace(/["\\]/g, "\\$&");
}

function createEditableCell(
  document: Document,
  tag: "th" | "td",
  text: string,
  rowKind: TableRowKind,
  rowIndex: number,
  colIndex: number,
  value: TableGridValue,
): HTMLElement {
  const cell = document.createElement(tag);
  cell.className = "cm-md-table-widget__cell";
  cell.contentEditable = "plaintext-only";
  // 兼容不支持 plaintext-only 的 WebView。
  if (cell.contentEditable !== "plaintext-only") {
    cell.contentEditable = "true";
  }
  cell.spellcheck = false;
  cell.dataset.rowKind = rowKind;
  cell.dataset.rowIndex = String(rowIndex);
  cell.dataset.colIndex = String(colIndex);
  cell.textContent = text;
  if (tag === "th") {
    cell.scope = "col";
  }
  const alignment = value.alignments[colIndex] ?? "none";
  if (alignment !== "none") {
    cell.style.textAlign = alignment;
  }
  return cell;
}

/**
 * 行分隔线手柄：悬停第 rowIndex 行上边界。
 * - 插入：新增行落在分隔线下方（afterBodyIndex = rowIndex - 1，表头下时 -1）；
 * - 删除：删除分隔线上方行（rowIndex - 1）；表头与第一行之间的手柄不提供删除。
 */
function createRowHandle(document: Document, rowIndex: number, bodyRowCount: number): HTMLElement {
  const handle = document.createElement("span");
  handle.className = "cm-md-table-widget__handle cm-md-table-widget__handle--row";
  handle.setAttribute("aria-hidden", "true");
  handle.append(createActionButton(document, "add-row", "插入行", String(rowIndex - 1)));
  // 第 0 行上方是表头（不可删），只提供插入。
  if (rowIndex > 0) {
    handle.append(createActionButton(document, "del-row", "删除行", String(rowIndex - 1)));
  }
  // 末行下边界额外提供表尾追加。
  if (rowIndex === bodyRowCount - 1) {
    handle.append(createActionButton(document, "add-row", "表尾追加行", String(rowIndex)));
  }
  return handle;
}

/**
 * 列分隔线手柄：悬停第 colIndex 列右边界。
 * - 插入：新增列落在分隔线右侧（atColIndex = colIndex + 1）；
 * - 删除：删除分隔线左侧列（colIndex）；最右列右侧的手柄不提供删除。
 */
function createColumnHandle(
  document: Document,
  colIndex: number,
  columnCount: number,
): HTMLElement {
  const handle = document.createElement("span");
  handle.className = "cm-md-table-widget__handle cm-md-table-widget__handle--col";
  handle.setAttribute("aria-hidden", "true");
  handle.append(createActionButton(document, "add-col", "插入列", String(colIndex + 1)));
  if (colIndex < columnCount - 1) {
    handle.append(createActionButton(document, "del-col", "删除列", String(colIndex)));
  }
  return handle;
}

function createActionButton(
  document: Document,
  action: "add-row" | "del-row" | "add-col" | "del-col",
  label: string,
  index: string,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "cm-md-table-widget__btn";
  button.dataset.tableAction = action;
  button.setAttribute("aria-label", label);
  button.title = label;
  const symbol = action === "add-row" || action === "add-col" ? "＋" : "−";
  button.textContent = symbol;
  if (action === "add-row" || action === "del-row") {
    button.dataset.rowIndex = index;
  } else {
    button.dataset.colIndex = index;
  }
  return button;
}

function flushCellCommit(
  view: EditorView,
  wrapper: HTMLElement,
  cell: HTMLElement,
  recordId: string,
): void {
  const address = addressFromCell(cell, recordId);
  if (!address) {
    return;
  }
  const text = cell.innerText
    .replace(/\u00a0/g, " ")
    .replace(/\r?\n/g, " ")
    .trim();
  commitTableCell(view, address, text);
  lastEditingCellByRecordId.set(recordId, address);
  editingCellByDom.delete(wrapper);
}

function addressFromCell(cell: HTMLElement, recordId: string): TableCellAddress | null {
  const rowKind = cell.dataset.rowKind;
  const rowIndex = Number(cell.dataset.rowIndex);
  const colIndex = Number(cell.dataset.colIndex);
  if (
    (rowKind !== "header" && rowKind !== "body") ||
    Number.isNaN(rowIndex) ||
    Number.isNaN(colIndex)
  ) {
    return null;
  }
  return { recordId, rowKind, rowIndex, colIndex };
}

function sourceCellText(value: TableGridValue, address: TableCellAddress): string {
  if (address.rowKind === "header") {
    return value.headerCells[address.colIndex] ?? "";
  }
  return value.bodyRows[address.rowIndex]?.[address.colIndex] ?? "";
}

function cellElementFromEvent(event: Event): HTMLElement | null {
  const target = event.target;
  if (!(target instanceof Element)) {
    return null;
  }
  return target.closest(".cm-md-table-widget__cell");
}

function moveCellFocus(
  wrapper: HTMLElement,
  current: HTMLElement,
  direction: "left" | "right" | "down",
): void {
  const cells = [...wrapper.querySelectorAll<HTMLElement>(".cm-md-table-widget__cell")];
  const index = cells.indexOf(current);
  if (index < 0) {
    return;
  }
  const colCount = Math.max(1, wrapper.querySelectorAll("thead .cm-md-table-widget__cell").length);
  let nextIndex = index;
  if (direction === "right") {
    nextIndex = Math.min(cells.length - 1, index + 1);
  } else if (direction === "left") {
    nextIndex = Math.max(0, index - 1);
  } else {
    nextIndex = Math.min(cells.length - 1, index + colCount);
  }
  const next = cells[nextIndex];
  if (next) {
    next.focus();
    selectElementContents(next);
  }
}

function selectElementContents(element: HTMLElement): void {
  const selection = element.ownerDocument.defaultView?.getSelection();
  if (!selection) {
    return;
  }
  const range = element.ownerDocument.createRange();
  range.selectNodeContents(element);
  selection.removeAllRanges();
  selection.addRange(range);
}

function updateTableGridDom(dom: HTMLElement, value: TableGridValue): void {
  dom.dataset.recordId = value.recordId;
  dom.classList.toggle("cm-md-table-widget--selected", value.selected);
  dom.setAttribute("aria-selected", String(value.selected));
}

function equalStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((cell, index) => cell === right[index]);
}

function equalStringRows(left: readonly string[], right: readonly string[]): boolean {
  return equalStrings(left, right);
}

function equalBodyRows(
  left: readonly (readonly string[])[],
  right: readonly (readonly string[])[],
): boolean {
  return (
    left.length === right.length && left.every((row, index) => equalStrings(row, right[index]))
  );
}
