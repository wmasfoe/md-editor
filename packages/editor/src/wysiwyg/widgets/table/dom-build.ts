/**
 * @file dom-build.ts
 * @description 表格 widget 的 DOM 骨架构建（wrapper / 滚动视口 / grid / 操作菜单）。
 *
 * 从 `table-widget.ts` 抽出，原因是该文件已触及 renderer 的 800 行硬上限
 * （见 `scripts/structure/check.mjs`）。这里只负责**结构与 class 契约**，
 * 事件绑定、提交语义仍在 widget 内，避免把交互逻辑搬散。
 *
 * ## 结构契约（改动前必读）
 *
 * ```html
 * <div class="cm-md-table-widget">        <!-- 定位锚点：手柄/菜单挂在这里，overflow: visible -->
 *   <div class="cm-md-table-widget__viewport">  <!-- 横向滚动层（仅溢出时启用） -->
 *     <table class="cm-md-table-widget__grid"> ... </table>
 *   </div>
 *   <div class="cm-md-table-widget__menu" hidden> ... </div>
 * </div>
 * ```
 *
 * 为什么滚动层必须是内层 viewport，而不是把 wrapper 变成滚动容器：
 * 行/列手柄（`left: -1.35rem` / `right: -0.65rem`）与行操作菜单**故意溢出**到表格外侧
 * （Notion 式块手柄），wrapper 一旦带 `overflow`，它们就会被裁掉 —— 实测
 * `elementFromPoint` 落到 `.cm-content`，手柄完全点不到。
 *
 * 溢出与否由 `overflow.ts` 写入 `data-table-overflow`，样式据此切换两套几何
 * （见 `styles/table-css.ts` 与 `docs/agent/specs/wysiwyg_table_editing_and_lifecycle_spec.md` §5）。
 */
import type { TableGridValue } from "./table-widget.ts";
import { createColumnHandle, createEditableCell, createRowHandle } from "./dom.ts";

/** 构建完成的骨架节点。 */
export interface TableWidgetSkeleton {
  readonly wrapper: HTMLElement;
  readonly viewport: HTMLElement;
  readonly grid: HTMLTableElement;
  readonly menu: HTMLElement;
}

/** 按 `TableGridValue` 构建表格骨架（不含事件绑定）。 */
export function buildTableWidgetSkeleton(
  document: Document,
  value: TableGridValue,
): TableWidgetSkeleton {
  const wrapper = document.createElement("div");
  wrapper.className = "cm-md-table-widget";
  wrapper.setAttribute("role", "group");
  wrapper.setAttribute("aria-label", "Markdown table");
  wrapper.setAttribute("tabindex", "-1");

  const grid = document.createElement("table");
  grid.className = "cm-md-table-widget__grid";
  grid.setAttribute("role", "grid");

  const tableHead = document.createElement("thead");
  const headerRow = document.createElement("tr");
  value.headerCells.forEach((cellText, colIndex) => {
    const cell = createEditableCell(document, "th", cellText, "header", 0, colIndex, value);
    // 列块手柄：贴在第 colIndex 列右缘，点击弹出列操作菜单（插入左/右、删除本列）。
    cell.append(createColumnHandle(document, colIndex));
    headerRow.append(cell);
  });
  tableHead.append(headerRow);
  grid.append(tableHead);

  const tableBody = document.createElement("tbody");
  value.bodyRows.forEach((row, rowIndex) => {
    const tr = document.createElement("tr");
    // 列数以表头/正文/对齐三者最大值为准：正文行可能比表头短（GFM 允许省略尾随单元格）。
    const columnCount = Math.max(value.headerCells.length, row.length, value.alignments.length);
    for (let colIndex = 0; colIndex < columnCount; colIndex += 1) {
      const cell = createEditableCell(
        document,
        "td",
        row[colIndex] ?? "",
        "body",
        rowIndex,
        colIndex,
        value,
      );
      // 行块手柄：贴在本行第一列左侧，点击弹出行操作菜单（插入上/下、删除本行）。
      if (colIndex === 0) {
        cell.append(createRowHandle(document, rowIndex));
      }
      tr.append(cell);
    }
    tableBody.append(tr);
  });
  grid.append(tableBody);

  // 行/列操作浮层菜单：由行/列块手柄触发，点击菜单项执行增删与对齐切换。
  const menu = document.createElement("div");
  menu.className = "cm-md-table-widget__menu";
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", "Table actions");
  menu.hidden = true;

  const viewport = document.createElement("div");
  viewport.className = "cm-md-table-widget__viewport";
  viewport.append(grid);

  wrapper.append(viewport);
  wrapper.append(menu);

  return { wrapper, viewport, grid, menu };
}
