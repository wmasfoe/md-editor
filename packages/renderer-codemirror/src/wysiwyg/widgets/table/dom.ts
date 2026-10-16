/** DOM construction and action-menu presentation for table widgets. */
import type { MarkdownTableCellAlignment } from "../../../markdown/range-types.ts";
import type { TableRowKind } from "../../editing/table-editing.ts";
import type { TableGridValue } from "./table-widget.ts";

export function cssEscape(value: string): string {
  return value.replace(/["\\]/g, "\\$&");
}

export function createEditableCell(
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
  cell.dataset.rowKind = rowKind;
  cell.dataset.rowIndex = String(rowIndex);
  cell.dataset.colIndex = String(colIndex);
  if (tag === "th") {
    cell.scope = "col";
  }
  const alignment = value.alignments[colIndex] ?? "none";
  if (alignment !== "none") {
    cell.style.textAlign = alignment;
  }

  const editor = document.createElement("div");
  editor.className = "cm-md-table-widget__cell-editor";
  editor.contentEditable = "plaintext-only";
  // 兼容不支持 plaintext-only 的 WebView。
  if (editor.contentEditable !== "plaintext-only") {
    editor.contentEditable = "true";
  }
  editor.spellcheck = false;
  // S2 根因修复：文档内容**不得参与浏览器的 Tab 焦点链**。
  // 此前单元格编辑器漏设 tabindex（并非唯一 —— 代码块工具栏/图片 widget 亦然，
  // 同批一并修复，并由「文档内可聚焦元素枚举」护栏测试长期看守），于是 CM6 腿 fallthrough、
  // Tab 交还浏览器时，默认 Tab 导航把焦点移进单元格（视觉上“光标跳进表格”）。
  // 其余文档内 widget（折叠按钮 / HTML / MDX / 分割线 / default-atom / 表格 wrapper / 图片）
  // 均已是 tabindex="-1"；此处补上以保持一致。程序化 `focus()` 不受影响。
  editor.tabIndex = -1;
  editor.textContent = text;
  cell.append(editor);

  return cell;
}

/**
 * 行块手柄：贴在本行第一列左侧（表格外），点击弹出该行操作菜单。
 * 菜单项：插入上方行（afterBodyIndex = rowIndex - 1）、插入下方行（rowIndex）、删除本行。
 */
export function createRowHandle(document: Document, rowIndex: number): HTMLElement {
  const handle = document.createElement("span");
  handle.className = "cm-md-table-widget__handle cm-md-table-widget__handle--row";
  handle.setAttribute("aria-hidden", "true");
  // 手柄是单元格的子节点，必须声明为非编辑区域：
  // 否则 End/光标会越过手柄，键入内容会落在手柄之后并混入提交文本。
  handle.contentEditable = "false";
  handle.append(createHandleButton(document, "row", String(rowIndex)));
  return handle;
}

/**
 * 列块手柄：贴在第 colIndex 列表头右缘，点击弹出该列操作菜单。
 * 菜单项：插入左侧列（colIndex）、插入右侧列（colIndex + 1）、删除本列
 * （列数 > 1 时可用，含最右列——下限由 deleteTableColumn 校验）。
 */
export function createColumnHandle(document: Document, colIndex: number): HTMLElement {
  const handle = document.createElement("span");
  handle.className = "cm-md-table-widget__handle cm-md-table-widget__handle--col";
  handle.setAttribute("aria-hidden", "true");
  handle.contentEditable = "false";
  handle.append(createHandleButton(document, "col", String(colIndex)));
  return handle;
}

export function createHandleButton(
  document: Document,
  toggle: "row" | "col",
  index: string,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  // 文档内控件不参与浏览器 Tab 焦点链（与单元格编辑器/其它 widget 一致）：
  // 否则 CM6 腿 fallthrough、Tab 交还浏览器时会落到手柄上（S2 同类缺陷）。
  button.tabIndex = -1;
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
export function openTableMenu(
  wrapper: HTMLElement,
  menu: HTMLElement,
  documentClick: EventListener,
  toggle: "row" | "col",
  index: number,
  currentAlignment?: MarkdownTableCellAlignment,
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
    // 对齐分组：当前对齐项带勾选标记，点击经 delimiter 重写切换。
    const alignmentLabel = {
      none: "无对齐",
      left: "左对齐",
      center: "居中",
      right: "右对齐",
    } as const;
    for (const [alignment, label] of Object.entries(alignmentLabel) as [
      MarkdownTableCellAlignment,
      string,
    ][]) {
      const item = createMenuButton(document, `align-${alignment}`, label, "col", index);
      if (alignment === currentAlignment) {
        item.classList.toggle("cm-md-table-widget__menu-item--active", true);
        item.setAttribute("aria-checked", "true");
      }
      menu.append(item);
    }
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

export function createMenuButton(
  document: Document,
  action: string,
  label: string,
  toggle: "row" | "col",
  index: number,
  danger = false,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  // 同上：菜单项也不进 Tab 链（菜单打开后由键盘逻辑自行管理焦点）
  button.tabIndex = -1;
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

export function closeTableMenu(
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
