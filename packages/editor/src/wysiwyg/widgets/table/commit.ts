/** Commit cell input while preserving the active editing session. */
import type { EditorView } from "@codemirror/view";
import { commitTableCell, type TableCellAddress } from "../../editing/table-editing.ts";
import type { TableGridValue } from "./table-widget.ts";
import { lastEditingCellByRecordId } from "./focus.ts";

/** 正在编辑的单元格地址；blur 时提交，避免 updateDOM 打断输入。 */
export const editingCellByDom = new WeakMap<HTMLElement, TableCellAddress>();

/**
 * 从 cell 编辑器抽取待提交文本（flushCellCommit 与 M4 pending 判定**共用**，防提取逻辑漂移）。
 */
export function extractCellEditorText(cell: HTMLElement): string {
  const editor = cell.querySelector<HTMLElement>(".cm-md-table-widget__cell-editor") ?? cell;
  const clone = editor.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(".cm-md-table-widget__handle").forEach((handle) => handle.remove());
  return (clone.innerText || clone.textContent || "")
    .replace(/\u00a0/g, " ")
    .replace(/\r?\n/g, " ")
    .trim();
}

/**
 * MEDIUM-4：cell 是否有**未提交输入**（编辑器抽取文本 ≠ 记录中的已提交文本）。
 * 无此判定时，带建议按 Tab → accept 腿先跑 → doc 变更触发 widget 重渲染 →
 * 未提交的 cell DOM 输入静默丢失；E18 无输入故套件不绿不了（评审批次新边）。
 */
export function hasUncommittedCellInput(cell: HTMLElement, value: TableGridValue): boolean {
  const address = addressFromCell(cell, value.recordId);
  if (!address) {
    return false;
  }
  const committed =
    address.rowKind === "header"
      ? value.headerCells[address.colIndex]
      : value.bodyRows[address.rowIndex]?.[address.colIndex];
  if (committed === undefined) {
    return false;
  }
  return extractCellEditorText(cell) !== committed;
}

export function flushCellCommit(
  view: EditorView,
  wrapper: HTMLElement,
  cell: HTMLElement,
  recordId: string,
): void {
  const address = addressFromCell(cell, recordId);
  if (!address) {
    return;
  }
  const text = extractCellEditorText(cell);
  commitTableCell(view, address, text);
  lastEditingCellByRecordId.set(recordId, address);
  editingCellByDom.delete(wrapper);
}

/**
 * 单元格失焦时的提交：仅当存在未提交输入才回写源码。
 * 无输入变化时只更新记忆、不产生文档变更（参见 focusout 注释）。
 */
export function commitCellOnFocusOut(
  view: EditorView,
  wrapper: HTMLElement,
  cell: HTMLElement,
  value: TableGridValue,
): void {
  const address = addressFromCell(cell, value.recordId);
  if (!address) {
    return;
  }
  if (hasUncommittedCellInput(cell, value)) {
    flushCellCommit(view, wrapper, cell, value.recordId);
    return;
  }
  lastEditingCellByRecordId.set(value.recordId, address);
  editingCellByDom.delete(wrapper);
}

/**
 * 立即刷写当前正在编辑的所有表格单元格（用于模式切换、文档保存或外部命令触发前）。
 */
export function flushActiveTableCell(view: EditorView): boolean {
  if (!view.dom) {
    return false;
  }
  const editingCells = [
    ...view.dom.querySelectorAll<HTMLElement>(".cm-md-table-widget__cell--editing"),
  ];

  const activeElement = view.dom.ownerDocument?.activeElement;
  if (
    activeElement &&
    (typeof HTMLElement === "undefined" || activeElement instanceof HTMLElement)
  ) {
    const activeCell = (activeElement as HTMLElement).closest<HTMLElement>(
      ".cm-md-table-widget__cell",
    );
    if (activeCell && !editingCells.includes(activeCell)) {
      editingCells.push(activeCell);
    }
  }

  let flushed = false;
  for (const cell of editingCells) {
    const wrapper = cell.closest<HTMLElement>(".cm-md-table-widget");
    if (wrapper) {
      const recordId = wrapper.dataset.recordId;
      if (recordId) {
        flushCellCommit(view, wrapper, cell, recordId);
        cell.classList.remove("cm-md-table-widget__cell--editing");
        flushed = true;
      }
    }
  }
  return flushed;
}

export function addressFromCell(cell: HTMLElement, recordId: string): TableCellAddress | null {
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

export function sourceCellText(value: TableGridValue, address: TableCellAddress): string {
  if (address.rowKind === "header") {
    return value.headerCells[address.colIndex] ?? "";
  }
  return value.bodyRows[address.rowIndex]?.[address.colIndex] ?? "";
}
