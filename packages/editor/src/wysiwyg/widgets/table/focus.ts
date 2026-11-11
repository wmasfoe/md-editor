/** Table focus navigation, remembered cell addresses, and grid presentation. */
import type { EditorView } from "@codemirror/view";
import { markdownRangeIndexField } from "../../../markdown/range-index.ts";
import { clearWysiwygAtomSelectionEffect } from "../../state/types.ts";
import type { TableCellAddress } from "../../editing/table-editing.ts";
import type { TableGridValue } from "./table-widget.ts";
import { cssEscape } from "./dom.ts";

/** 最近一次退出编辑的单元格地址（按 recordId 记忆），供 Tab/Enter 重新进入。 */
export const lastEditingCellByRecordId = new Map<string, TableCellAddress>();

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
  const editor = target.querySelector?.<HTMLElement>(".cm-md-table-widget__cell-editor") ?? target;
  editor.focus?.();
  selectElementContents(editor);
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

export function cellElementFromEvent(event: Event): HTMLElement | null {
  const target = event.target;
  if (!target || (typeof Element !== "undefined" && !(target instanceof Element))) {
    return null;
  }
  return (target as Element).closest?.(".cm-md-table-widget__cell") ?? null;
}

export function moveCellFocus(
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
    const editor = next.querySelector<HTMLElement>(".cm-md-table-widget__cell-editor") ?? next;
    editor.focus();
    selectElementContents(editor);
  }
}

export function selectElementContents(element: HTMLElement): void {
  const selection = element.ownerDocument?.defaultView?.getSelection?.();
  if (!selection) {
    return;
  }
  const range = element.ownerDocument?.createRange?.();
  if (!range) {
    return;
  }
  range.selectNodeContents(element);
  selection.removeAllRanges?.();
  selection.addRange?.(range);
}

export function updateTableGridDom(dom: HTMLElement, value: TableGridValue): void {
  dom.dataset.recordId = value.recordId;
  dom.classList.toggle("cm-md-table-widget--selected", value.selected);
  dom.setAttribute("aria-selected", String(value.selected));
}

export function equalStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((cell, index) => cell === right[index]);
}

export function equalStringRows(left: readonly string[], right: readonly string[]): boolean {
  return equalStrings(left, right);
}

export function equalBodyRows(
  left: readonly (readonly string[])[],
  right: readonly (readonly string[])[],
): boolean {
  return (
    left.length === right.length && left.every((row, index) => equalStrings(row, right[index]))
  );
}
