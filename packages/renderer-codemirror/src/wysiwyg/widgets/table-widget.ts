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
  exitTableWithParagraph,
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
  readonly documentClick: EventListener;
}

const listenersByDom = new WeakMap<HTMLElement, TableWidgetListeners>();
/** 正在编辑的单元格地址；blur 时提交，避免 updateDOM 打断输入。 */
const editingCellByDom = new WeakMap<HTMLElement, TableCellAddress>();
/** 最近一次退出编辑的单元格地址（按 recordId 记忆），供 Tab/Enter 重新进入。 */
const lastEditingCellByRecordId = new Map<string, TableCellAddress>();

/**
 * 始终显示的可视化表格（类 Excel / Notion）：
 * - 单元格 contenteditable 就地编辑，blur/Enter/Tab 回写 GFM 源码；
 * - 左键单击单元格即进入编辑（不拦截 pointerdown 默认行为）；
 * - 行/列块手柄（Notion 式 ⋮⋮）：行首/表头固定显隐，点击弹出操作菜单
 *   （行：上方/下方插入、删除本行；列：左侧/右侧插入、删除本列）；
 * - 点击非单元格区域原子选中整表，Delete/Backspace 整块删除；
 * - 整表选中态打字/粘贴等价于替换整表；末尾 Enter 退出表格续写段落。
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
        ".cm-md-table-widget__cell, .cm-md-table-widget__btn, .cm-md-table-widget__handle, .cm-md-table-widget__menu",
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
      // 列块手柄：贴在第 colIndex 列右缘，点击弹出列操作菜单（插入左/右、删除本列）。
      cell.append(createColumnHandle(document, colIndex));
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
        // 行块手柄：贴在本行第一列左侧，点击弹出行操作菜单（插入上/下、删除本行）。
        if (colIndex === 0) {
          cell.append(createRowHandle(document, rowIndex));
        }
        tr.append(cell);
      }
      tableBody.append(tr);
    });
    table.append(tableBody);

    // 行/列操作浮层菜单：由行/列块手柄触发，点击菜单项执行增删。
    const menu = document.createElement("div");
    menu.className = "cm-md-table-widget__menu";
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", "Table actions");
    menu.hidden = true;

    wrapper.append(table);
    wrapper.append(menu);

    const pointerdown: EventListener = (event) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      if (
        target.closest(
          ".cm-md-table-widget__cell, .cm-md-table-widget__btn, .cm-md-table-widget__menu",
        )
      ) {
        // 单元格/手柄按钮/菜单：不拦截默认行为（让浏览器把焦点交给 contenteditable）；
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
        // 最后一行 Enter：退出表格并在下方新增段落续写正文（不再卡在单元格里）。
        const address = addressFromCell(cell, this.value.recordId);
        if (address?.rowKind === "body" && address.rowIndex === this.value.bodyRows.length - 1) {
          exitTableWithParagraph(view, wrapper.dataset.recordId ?? this.value.recordId);
          return;
        }
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
      // 行/列块手柄：打开对应操作菜单。
      const toggle = target.closest<HTMLElement>("[data-table-toggle]");
      if (toggle) {
        event.preventDefault();
        event.stopPropagation();
        if (toggle.dataset.tableToggle === "row") {
          openTableMenu(wrapper, menu, documentClick, "row", Number(toggle.dataset.rowIndex ?? -1));
        } else if (toggle.dataset.tableToggle === "col") {
          openTableMenu(wrapper, menu, documentClick, "col", Number(toggle.dataset.colIndex ?? -1));
        }
        return;
      }
      // 菜单项：执行行/列增删操作。
      const button = target.closest<HTMLElement>("[data-table-action]");
      if (button) {
        event.preventDefault();
        event.stopPropagation();
        const recordId = wrapper.dataset.recordId ?? this.value.recordId;
        const action = button.dataset.tableAction;
        const rowIndex = Number(button.dataset.rowIndex ?? -1);
        const colIndex = Number(button.dataset.colIndex ?? -1);
        if (action === "insert-row-above") {
          insertTableBodyRow(view, recordId, rowIndex - 1);
        } else if (action === "insert-row-below") {
          insertTableBodyRow(view, recordId, rowIndex);
        } else if (action === "delete-row") {
          deleteTableBodyRow(view, recordId, rowIndex);
        } else if (action === "insert-col-left") {
          insertTableColumn(view, recordId, colIndex);
        } else if (action === "insert-col-right") {
          insertTableColumn(view, recordId, colIndex + 1);
        } else if (action === "delete-col") {
          deleteTableColumn(view, recordId, colIndex);
        }
        closeTableMenu(wrapper, menu, documentClick, document);
        return;
      }
      // 点击菜单外的表格区域：关闭菜单。
      if (!menu.hidden && !menu.contains(target)) {
        closeTableMenu(wrapper, menu, documentClick, document);
      }
    };

    // 点击表格外：关闭打开的菜单（capture 阶段先于 wrapper 内 bubble 处理）。
    const documentClick: EventListener = (event) => {
      const target = event.target;
      if (!(target instanceof Node) || !wrapper.contains(target)) {
        closeTableMenu(wrapper, menu, documentClick, document);
      }
    };

    wrapper.addEventListener("pointerdown", pointerdown);
    wrapper.addEventListener("focusin", focusin);
    wrapper.addEventListener("focusout", focusout);
    wrapper.addEventListener("keydown", keydown);
    wrapper.addEventListener("click", actionClick);
    listenersByDom.set(wrapper, {
      pointerdown,
      focusin,
      focusout,
      keydown,
      actionClick,
      documentClick,
    });
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
      dom.ownerDocument.removeEventListener("click", listeners.documentClick, true);
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
 * 行块手柄：贴在本行第一列左侧（表格外），点击弹出该行操作菜单。
 * 菜单项：插入上方行（afterBodyIndex = rowIndex - 1）、插入下方行（rowIndex）、删除本行。
 */
function createRowHandle(document: Document, rowIndex: number): HTMLElement {
  const handle = document.createElement("span");
  handle.className = "cm-md-table-widget__handle cm-md-table-widget__handle--row";
  handle.setAttribute("aria-hidden", "true");
  handle.append(createHandleButton(document, "row", String(rowIndex)));
  return handle;
}

/**
 * 列块手柄：贴在第 colIndex 列表头右缘，点击弹出该列操作菜单。
 * 菜单项：插入左侧列（colIndex）、插入右侧列（colIndex + 1）、删除本列
 * （列数 > 1 时可用，含最右列——下限由 deleteTableColumn 校验）。
 */
function createColumnHandle(document: Document, colIndex: number): HTMLElement {
  const handle = document.createElement("span");
  handle.className = "cm-md-table-widget__handle cm-md-table-widget__handle--col";
  handle.setAttribute("aria-hidden", "true");
  handle.append(createHandleButton(document, "col", String(colIndex)));
  return handle;
}

function createHandleButton(
  document: Document,
  toggle: "row" | "col",
  index: string,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "cm-md-table-widget__btn cm-md-table-widget__btn--handle";
  button.dataset.tableToggle = toggle;
  button.setAttribute(
    "aria-label",
    toggle === "row" ? `Row ${Number(index) + 1} actions` : `Column ${Number(index) + 1} actions`,
  );
  button.title = toggle === "row" ? "行操作" : "列操作";
  // ⋮⋮ 竖排省略号：Notion 式块手柄。
  button.textContent = "⋮⋮";
  if (toggle === "row") {
    button.dataset.rowIndex = index;
  } else {
    button.dataset.colIndex = index;
  }
  return button;
}

/** 打开行/列操作菜单：按目标行/列填充菜单项并定位到对应手柄附近。 */
function openTableMenu(
  wrapper: HTMLElement,
  menu: HTMLElement,
  documentClick: EventListener,
  toggle: "row" | "col",
  index: number,
): void {
  const document = wrapper.ownerDocument;
  menu.replaceChildren();
  if (toggle === "row") {
    menu.append(createMenuButton(document, "insert-row-above", "在上方插入行", "row", index));
    menu.append(createMenuButton(document, "insert-row-below", "在下方插入行", "row", index));
    menu.append(createMenuButton(document, "delete-row", "删除本行", "row", index, true));
  } else {
    menu.append(createMenuButton(document, "insert-col-left", "在左侧插入列", "col", index));
    menu.append(createMenuButton(document, "insert-col-right", "在右侧插入列", "col", index));
    menu.append(createMenuButton(document, "delete-col", "删除本列", "col", index, true));
  }
  // 定位：行菜单从该行第一列左缘向右展开；列菜单从该列表头右缘向右下展开。
  const anchor = wrapper.querySelector<HTMLElement>(
    toggle === "row"
      ? `[data-row-kind="body"][data-row-index="${index}"]`
      : `[data-row-kind="header"][data-col-index="${index}"]`,
  );
  if (anchor) {
    menu.style.left = `${anchor.offsetLeft + (toggle === "col" ? anchor.offsetWidth : -4)}px`;
    menu.style.top = `${anchor.offsetTop + 2}px`;
  }
  menu.hidden = false;
  // 点击表格外时关闭（capture 阶段先于 wrapper 内 bubble 的 actionClick 执行）。
  document.addEventListener("click", documentClick, true);
}

function createMenuButton(
  document: Document,
  action: string,
  label: string,
  toggle: "row" | "col",
  index: number,
  danger = false,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `cm-md-table-widget__btn cm-md-table-widget__menu-item${danger ? " cm-md-table-widget__menu-item--danger" : ""}`;
  button.dataset.tableAction = action;
  button.setAttribute("role", "menuitem");
  button.textContent = label;
  if (toggle === "row") {
    button.dataset.rowIndex = String(index);
  } else {
    button.dataset.colIndex = String(index);
  }
  return button;
}

function closeTableMenu(
  wrapper: HTMLElement,
  menu: HTMLElement,
  documentClick: EventListener,
  document: Document,
): void {
  void wrapper;
  if (!menu.hidden) {
    menu.hidden = true;
    document.removeEventListener("click", documentClick, true);
  }
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
