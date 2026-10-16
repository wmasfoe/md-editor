import { WidgetType, type EditorView } from "@codemirror/view";
import type { WysiwygDiagnostics } from "../../../diagnostics.ts";
import { markdownRangeIndexField } from "../../../markdown/range-index.ts";
import { selectWysiwygAtom } from "../../blocks/atom-selection.ts";
import { clearWysiwygAtomSelectionEffect } from "../../state/types.ts";
import { wysiwygProjectionField } from "../../state/projection-field.ts";
import { acceptAiSuggestion, aiSuggestionField } from "../../view/suggestion.ts";
import { dispatchTabActions } from "../../input/tab-arbiter.ts";
import { escapeBracketInCellDom } from "../cell-caret.ts";
import type { MarkdownTableCellAlignment } from "../../../markdown/range-types.ts";
import {
  deleteTableBodyRow,
  deleteTableColumn,
  exitTableWithParagraph,
  insertTableBodyRow,
  insertTableColumn,
  setTableColumnAlignment,
} from "../../editing/table-editing.ts";
import {
  createEditableCell,
  createRowHandle,
  createColumnHandle,
  openTableMenu,
  closeTableMenu,
} from "./dom.ts";
import {
  editingCellByDom,
  addressFromCell,
  commitCellOnFocusOut,
  flushCellCommit,
  hasUncommittedCellInput,
  sourceCellText,
} from "./commit.ts";
import {
  lastEditingCellByRecordId,
  equalStringRows,
  equalBodyRows,
  equalStrings,
  cellElementFromEvent,
  moveCellFocus,
  selectElementContents,
  updateTableGridDom,
} from "./focus.ts";

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

// CM6 会就地复用 widget DOM（updateDOM 返回 true 时），但 toDOM 里绑定的
// 事件监听闭包仍指向旧 widget 实例（旧 recordId / 旧单元格文本）。
// 通过 WeakMap 让监听器始终读取“当前”widget 值，避免提交命中旧记录。
const currentTableGridValueByDom = new WeakMap<HTMLElement, TableGridValue>();

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
    if (!target || (typeof Element !== "undefined" && !(target instanceof Element))) {
      return false;
    }
    return Boolean(
      (target as Element).closest?.(
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

    // 事件监听闭包读取“当前”widget 值：CM6 就地复用 DOM 时（updateDOM 返回 true）
    // 闭包仍持有旧实例，必须经由 WeakMap 拿最新值，否则提交/取消命中旧 recordId。
    const currentValue = () => currentTableGridValueByDom.get(wrapper) ?? this.value;

    const pointerdown: EventListener = (event) => {
      const target = event.target;
      if (!target || (typeof Element !== "undefined" && !(target instanceof Element))) {
        return;
      }
      if (
        (target as Element).closest?.(
          ".cm-md-table-widget__cell, .cm-md-table-widget__btn, .cm-md-table-widget__menu",
        )
      ) {
        // 单元格/手柄按钮/菜单：不拦截默认行为（让浏览器把焦点交给 contenteditable）；
        // 若表格正处于原子选中态，先清除选中高亮。
        if (currentValue().selected) {
          view.dispatch({
            effects: clearWysiwygAtomSelectionEffect.of(null),
            userEvent: "select",
          });
        }
        const cell = (target as HTMLElement).closest?.<HTMLElement>(".cm-md-table-widget__cell");
        if (
          cell &&
          !(target as HTMLElement).closest?.(
            ".cm-md-table-widget__btn, .cm-md-table-widget__handle, .cm-md-table-widget__menu",
          )
        ) {
          const editor = cell.querySelector<HTMLElement>(".cm-md-table-widget__cell-editor");
          if (editor && target !== editor) {
            editor.focus();
          }
        }
        return;
      }
      // 点击表格空白/边框：原子选中整表，便于 Delete 整块删除。
      event.preventDefault();
      selectWysiwygAtom(
        view,
        wrapper.dataset.recordId ?? currentValue().recordId,
        (event as MouseEvent).metaKey || (event as MouseEvent).ctrlKey,
      );
    };

    const focusin: EventListener = (event) => {
      const cell = cellElementFromEvent(event);
      if (!cell) {
        return;
      }
      const address = addressFromCell(cell, currentValue().recordId);
      if (address) {
        editingCellByDom.set(wrapper, address);
        lastEditingCellByRecordId.set(currentValue().recordId, address);
      }
      cell.classList.add("cm-md-table-widget__cell--editing");
      // S4（编辑器交互 bug 批）：把**编辑器光标**随 DOM 焦点一起搬进表格范围。
      //
      // 否则状态里的“当前块”与用户可见的光标分裂 —— 直接可见的后果是专注模式
      // 会残留上一个活动块的高亮（属主报的 #6：光标已点进表格，标题仍高亮）。
      // 仅当光标**不在**本表格范围内时才 dispatch（避免无谓事务与重复重建）。
      //
      // ⚠️ 只在焦点落到**单元格编辑器**（可编辑区）时同步：聚焦手柄/菜单等控件
      // 并不等于“把编辑位置搬过去”，否则 Tab 落到控件上会把光标拽进表格（实测过）。
      const focusedEditor = (event.target as Element | null)?.closest?.(
        ".cm-md-table-widget__cell-editor",
      );
      if (!focusedEditor) {
        return;
      }
      // IME/组合期不得搬动编辑器状态：会打断单元格内的组合与会话内 DOM 光标
      //（CI 实测 E19「组合期 Tab 不跳出」因此失败，本地因时序巧合未复现）。
      const projection = view.state.field(wysiwygProjectionField, false);
      if (view.composing || (projection?.compositionGuardRanges.length ?? 0) > 0) {
        return;
      }
      const record = view.state.field(markdownRangeIndexField, false)?.get(currentValue().recordId);
      const head = view.state.selection.main.head;
      if (record && (head < record.fullRange.from || head > record.fullRange.to)) {
        view.dispatch({ selection: { anchor: record.fullRange.from } });
      }
    };

    const focusout: EventListener = (event) => {
      const cell = cellElementFromEvent(event);
      if (!cell) {
        return;
      }
      // 如果焦点仍在当前单元格内部（例如子元素之间转移），不触发提交
      const next = (event as FocusEvent).relatedTarget;
      if (
        next &&
        (typeof Node === "undefined" || next instanceof Node) &&
        cell.contains(next as Node)
      ) {
        return;
      }
      cell.classList.remove("cm-md-table-widget__cell--editing");
      // 仅在**确有未提交输入**时回写源码：
      // 1. 无输入变化的焦点转移（如注入 AI 建议时的 `view.focus()`）不应产生文档变更；
      // 2. 否则 `buildCellReplacement` 会把 padded 行整行重序列化（零文本变更契约被破坏），
      //    并因 doc 变更清掉待处理的 AI 建议（D-1 PM-4 硬闸门）。
      // 无输入变化时仍需更新“最近编辑单元格”记忆，保持 Tab/Enter 重进语义不变。
      commitCellOnFocusOut(view, wrapper, cell, currentValue());
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
        flushCellCommit(view, wrapper, cell, currentValue().recordId);
        // 最后一行 Enter：退出表格并在下方新增段落续写正文（不再卡在单元格里）。
        const address = addressFromCell(cell, currentValue().recordId);
        if (
          address?.rowKind === "body" &&
          address.rowIndex === currentValue().bodyRows.length - 1
        ) {
          exitTableWithParagraph(view, wrapper.dataset.recordId ?? currentValue().recordId);
          // 恢复编辑器焦点：退出后光标已落在新段落，用户可直接续写正文。
          view.focus();
          return;
        }
        moveCellFocus(wrapper, cell, "down");
        return;
      }
      if (keyEvent.key === "Tab") {
        // D2 铁律第 1 步：**IME 组合期放行原生** —— 不仲裁、不 preventDefault。
        // M6：`acceptAiSuggestion` 已有 composing 门控（D-1b），但表格单元格的
        // **DOM 腿**此前没有 —— 而这正是本批最该生效的那条腿，否则组合期按 Tab
        // 会被括号跳出抢走，违反「瞬时模态态 > 结构语义」。
        // M6 → 三闸（E19 取证）：`keyEvent.isComposing` = 真实浏览器 IME 键事件标志；
        // `view.composing` = CM6 组合态；**compositionGuardRanges** = 渲染层
        // domEventObservers(compositionstart) → startWysiwygCompositionGuardEffect
        // 设的选区护栏（E19 的 setCompositionActive seam 正是走这条路径）——
        // 三者与 CM6 腿 `canEscapeBracket` 对称（评审原文：“and the cell equivalent of
        // compositionGuardRanges”）。
        const projection = view.state.field(wysiwygProjectionField, false);
        const compositionGuarded = (projection?.compositionGuardRanges.length ?? 0) > 0;
        // 三闸合一的**真实值**：既用于早退，也作为 arbiter 的 composing 输入。
        // 不得只传 `keyEvent.isComposing`：早退之后它恒为 false，会丢掉
        // `view.composing` / `compositionGuardRanges` 两条闸的信息（信息丢失型 smell）。
        const composing = keyEvent.isComposing || view.composing || compositionGuarded;
        if (composing) {
          // 组合期：**阻断我方链**（Tab 不得冒泡进 CM6 keymap，轮1 concern-6 的 dispatch 级契约前置保障），
          // 并**消费该键**（preventDefault）。
          //
          // 为什么必须 preventDefault（S9 自查 + CI 实测）：只 stopPropagation 时，浏览器默认 Tab 导航
          // 会把焦点移出单元格 ⇒ 组合中未提交的文本随 DOM 焦点丢失（E19 实测 cell 状态从 `3:3:cf()`
          // 变成 `0:0:`）。真实输入法会先消耗 Tab（用于候选选择），故 preventDefault 对真机行为**无影响**；
          // 它只保证「组合期不因 Tab 而丢状态」。
          keyEvent.preventDefault();
          keyEvent.stopPropagation();
          return;
        }
        // ── D-1 单元格内 Tab 仲裁（必须在任何 preventDefault / flushCellCommit 之前）──
        //
        // 背景：本 DOM `keydown` 对 Tab 直接 `preventDefault()+stopPropagation()`，
        // **任何 keymap `Prec` 都够不着**（`ignoreEvent` 已把 cell 事件排除在 CM6 之外）。
        // 这是共识评审 pass-1/pass-2 定位的**唯一真实 AI-Tab 缺陷点**。
        //
        // 仲裁顺序（deep-interview D2）：AI 接受 → 单元格内括号/link 跳出 → 跳下一格。
        //
        // 🔴 PM-4 / T20-cell 硬契约：**括号跳出必须先于 `flushCellCommit`**。
        // `flushCellCommit` 会产生**文档变更**（`table-editing.ts:249-278` 的
        // `buildCellReplacement` 会整行重序列化并规范化空白），
        // 若先 commit 再跳出，T20「零文本变更」会在单元格语境被破坏。
        if (!keyEvent.shiftKey) {
          // D-MB：本处是统一 Tab arbiter 的**表格薄派发器** ——
          // 序列不在此写死，由纯决策函数 `decideTabActions` 给出
          // （表格上下文：accept-suggestion → escape-bracket → table-next-cell，
          // 跳过 code-block），与 CM6 腿**语义单一**，杜绝两套仲裁漂移。
          // 轮1 concern-7：迭代归共享 runner（dispatchTabActions）；本处只供给「动作→执行器」映射
          const outcome = dispatchTabActions(
            {
              // 三闸合一的真实值（此处恒 false，因为上面已对 composing 早退；
              // 传真实值而非 keyEvent.isComposing 可保证将来早退条件收窄时语义不丢）
              composing,
              suggestionActive: view.state.field(aiSuggestionField, false) !== null,
              inTableCell: true,
              // 表格 DOM 腿只存在于所见即所得（单元格是 widget 内部 DOM）
              sourceMode: false,
            },
            {
              "accept-suggestion": () => {
                // MEDIUM-4：cell 有未提交输入时**不得先走接受** —— accept 的 doc 变更会触发
                // widget 重渲染、未提交 DOM 输入静默丢失；跳过接受 → 尾动作 flushCellCommit
                // 落盘输入（suggestion 随 commit 的 docChanged 自清，无陈旧坐标风险）。
                if (hasUncommittedCellInput(cell, currentValue())) {
                  return false;
                }
                if (!acceptAiSuggestion(view)) {
                  return false;
                }
                keyEvent.preventDefault();
                keyEvent.stopPropagation();
                return true;
              },
              "escape-bracket": () => {
                // 🔴 PM-4 / T20-cell：跳出先于任何 flushCellCommit（零文本变更）
                if (!escapeBracketInCellDom(cell)) {
                  return false;
                }
                keyEvent.preventDefault();
                keyEvent.stopPropagation();
                return true;
              },
              // 尾动作：不在此执行 —— fallthrough 到下方既有跳格 / flush 逻辑
              //（**表格腿尾语义**；尾契约全文见 tab-arbiter.ts 的 dispatchTabActions）
              "table-next-cell": () => false,
            },
          );
          if (outcome === "handled") {
            return;
          }
        }
        keyEvent.preventDefault();
        keyEvent.stopPropagation();
        flushCellCommit(view, wrapper, cell, currentValue().recordId);
        if (!keyEvent.shiftKey) {
          const address = addressFromCell(cell, currentValue().recordId);
          const isLastRow =
            address?.rowKind === "body" && address.rowIndex === currentValue().bodyRows.length - 1;
          const isLastCol = address?.colIndex === currentValue().headerCells.length - 1;
          if (isLastRow && isLastCol) {
            const recordId = wrapper.dataset.recordId ?? currentValue().recordId;
            const newRowIndex = address.rowIndex + 1;
            insertTableBodyRow(view, recordId, address.rowIndex);
            lastEditingCellByRecordId.set(recordId, {
              recordId,
              rowKind: "body",
              rowIndex: newRowIndex,
              colIndex: 0,
            });
            setTimeout(() => {
              const newCell = wrapper.querySelector<HTMLElement>(
                `[data-row-kind="body"][data-row-index="${newRowIndex}"][data-col-index="0"]`,
              );
              if (newCell) {
                const editor =
                  newCell.querySelector<HTMLElement>(".cm-md-table-widget__cell-editor") ?? newCell;
                editor.focus();
                selectElementContents(editor);
              }
            }, 0);
            return;
          }
        }
        moveCellFocus(wrapper, cell, keyEvent.shiftKey ? "left" : "right");
        return;
      }
      if (keyEvent.key === "Escape") {
        keyEvent.preventDefault();
        keyEvent.stopPropagation();
        // 取消：恢复源码文本并退出编辑，同时记住退出位置。
        const address = addressFromCell(cell, currentValue().recordId);
        if (address) {
          const editor = cell.querySelector<HTMLElement>(".cm-md-table-widget__cell-editor");
          const originalText = sourceCellText(currentValue(), address);
          if (editor) {
            editor.textContent = originalText;
          } else {
            cell.textContent = originalText;
          }
          lastEditingCellByRecordId.set(currentValue().recordId, address);
        }
        editingCellByDom.delete(wrapper);
        const editor = cell.querySelector<HTMLElement>(".cm-md-table-widget__cell-editor") ?? cell;
        editor.blur();
        view.focus();
        return;
      }
      // 单元格内 Cmd/Ctrl+A：先提交当前单元格编辑，再原子选中整表；
      // 焦点随之回到 CM6，再次 Cmd+A 由 CM6 默认 selectAll 扩展到全文。
      // （contenteditable 的浏览器默认只会选中当前单元格文本。）
      if (keyEvent.key === "a" && (keyEvent.metaKey || keyEvent.ctrlKey)) {
        flushCellCommit(view, wrapper, cell, currentValue().recordId);
        if (selectWysiwygAtom(view, wrapper.dataset.recordId ?? currentValue().recordId)) {
          keyEvent.preventDefault();
          keyEvent.stopPropagation();
        }
        return;
      }
    };

    const actionClick: EventListener = (event) => {
      const target = event.target;
      if (!target || (typeof HTMLElement !== "undefined" && !(target instanceof HTMLElement))) {
        return;
      }
      // 行/列块手柄：打开对应操作菜单。
      const toggle = (target as HTMLElement).closest?.<HTMLElement>("[data-table-toggle]");
      if (toggle) {
        event.preventDefault();
        event.stopPropagation();
        if (toggle.dataset.tableToggle === "row") {
          openTableMenu(wrapper, menu, documentClick, "row", Number(toggle.dataset.rowIndex ?? -1));
        } else if (toggle.dataset.tableToggle === "col") {
          openTableMenu(
            wrapper,
            menu,
            documentClick,
            "col",
            Number(toggle.dataset.colIndex ?? -1),
            currentValue().alignments[Number(toggle.dataset.colIndex ?? -1)] ?? "none",
          );
        }
        return;
      }
      // 菜单项：执行行/列增删操作。
      const button = (target as HTMLElement).closest?.<HTMLElement>("[data-table-action]");
      if (button) {
        event.preventDefault();
        event.stopPropagation();
        const recordId = wrapper.dataset.recordId ?? currentValue().recordId;
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
        } else if (action?.startsWith("align-")) {
          setTableColumnAlignment(
            view,
            recordId,
            colIndex,
            action.slice("align-".length) as MarkdownTableCellAlignment,
          );
        }
        closeTableMenu(wrapper, menu, documentClick, document);
        return;
      }
      // 点击菜单外的表格区域：关闭菜单。
      if (!menu.hidden && !menu.contains(target as Node)) {
        closeTableMenu(wrapper, menu, documentClick, document);
      }
    };

    // 点击表格外：关闭打开的菜单（capture 阶段先于 wrapper 内 bubble 处理）。
    const documentClick: EventListener = (event) => {
      const target = event.target;
      if (
        !target ||
        (typeof Node !== "undefined" && !(target instanceof Node)) ||
        !wrapper.contains(target as Node)
      ) {
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
    currentTableGridValueByDom.set(wrapper, this.value);
    updateTableGridDom(wrapper, this.value);
    this.value.diagnostics?.recordWidgetLifecycle("table", "create");
    return wrapper;
  }

  updateDOM(dom: HTMLElement): boolean {
    // 先刷新监听器读取的“当前值”：即使就地复用 DOM，后续事件也要命中新记录。
    currentTableGridValueByDom.set(dom, this.value);
    // 结构变化时返回 false，让 CM6 重建 widget（行列数变化）。
    // 必须在编辑捷径之前判断：点击行/列手柄后焦点位于单元格内，
    // 若先命中编辑分支，增删行列只会原地更新而不会重建 DOM。
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
    // 单元格正在编辑时跳过文本同步，避免打断 IME / 输入（结构未变时）。
    if (editingCellByDom.has(dom) && dom.contains(dom.ownerDocument.activeElement)) {
      updateTableGridDom(dom, this.value);
      this.value.diagnostics?.recordWidgetLifecycle("table", "update");
      return true;
    }
    headerCells.forEach((cell, index) => {
      const editor = cell.querySelector<HTMLElement>(".cm-md-table-widget__cell-editor");
      if (editor && dom.ownerDocument.activeElement !== editor) {
        editor.textContent = this.value.headerCells[index] ?? "";
      } else if (!editor && dom.ownerDocument.activeElement !== cell) {
        cell.textContent = this.value.headerCells[index] ?? "";
      }
    });
    bodyRows.forEach((row, rowIndex) => {
      const cells = [...row.querySelectorAll("td")];
      const sourceRow = this.value.bodyRows[rowIndex] ?? [];
      cells.forEach((cell, colIndex) => {
        const editor = cell.querySelector<HTMLElement>(".cm-md-table-widget__cell-editor");
        if (editor && dom.ownerDocument.activeElement !== editor) {
          editor.textContent = sourceRow[colIndex] ?? "";
        } else if (!editor && dom.ownerDocument.activeElement !== cell) {
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
    currentTableGridValueByDom.delete(dom);
    this.value.diagnostics?.recordWidgetLifecycle("table", "destroy");
  }
}
