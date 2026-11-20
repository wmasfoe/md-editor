/**
 * @file table-css.ts
 * @description GFM 表格 widget 与整表选中提示（渲染器自持样式片段，由 `index.ts` 汇总注入）。
 *
 * 选择器带 `.cm-md-editor.cm-editor` scope 前缀（该 class 由渲染器经
 * `EditorView.editorAttributes` 挂到 `.cm-editor` 上），特异性 (0,2,0) 与
 * CodeMirror 自带 `baseTheme` 的 `.<id> .cm-*` 平级，靠注入顺序取胜。
 * 所有 `var(--theme-*)` 均带 fallback。
 */

export const tableCss = String.raw`
/* P2-F 整表选中态操作提示：Delete 删除 · Tab 编辑 · Cmd+C 复制。 */
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-table-widget[aria-selected="true"]::after {
  content: "Delete 删除 · Tab 编辑 · Cmd+C 复制";
  position: absolute;
  top: -1.9rem;
  left: 0;
  z-index: 3;
  padding: 0.22rem 0.6rem;
  border-radius: 6px;
  background: var(--theme-bg-muted, #f1f1f1);
  color: var(--theme-text-muted, #666);
  font-size: 0.72em;
  line-height: 1.4;
  white-space: nowrap;
  pointer-events: none;
  box-shadow: 0 1px 4px rgb(0 0 0 / 0.12);
}
/*
 * 横向滚动视口。
 *
 * 宽表格只在本块内滚动，绝不把 .cm-scroller 撑出页面级横向滚动条。
 * 滚动层必须是内层 .cm-md-table-widget__viewport 而不是 .cm-md-table-widget：
 * 行/列手柄与行操作菜单挂在 wrapper 上并**溢出到表格左/右外侧**（left: -1.35rem /
 * right: -0.65rem），若 wrapper 自己成为滚动容器，它们会被 overflow 裁掉。
 *
 * 关键：overflow-x: auto 即使内容不溢出也会建立裁剪盒，同样会裁掉外侧手柄。
 * 因此由 widget 的 ResizeObserver 在根节点上写 data-table-overflow，按状态切换：
 * - false（绝大多数表格）：overflow: visible，手柄留在表格外侧，无任何裁剪；
 * - true：overflow-x: auto 本地滚动，手柄改贴单元格内缘（见下方规则）——
 *   否则手柄在滚动盒外永远点不到。
 */
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-table-widget__viewport {
  overflow: visible;
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-table-widget[data-table-overflow="true"] .cm-md-table-widget__viewport {
  overflow-x: auto;
  /* 纵向不滚动：行/列手柄的悬浮热区可以溢出到表格上下方，不被裁剪。 */
  overflow-y: hidden;
  /* 溢出时始终显示一条细滚动条：否则表格右缘被切断却没有任何可滚动提示，
     用户不会知道还能横向滚动。 */
  scrollbar-width: thin;
  scrollbar-color: color-mix(in srgb, var(--theme-control-subtle, #6e7781) 40%, transparent) transparent;
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-table-widget[data-table-overflow="true"] .cm-md-table-widget__viewport::-webkit-scrollbar {
  height: 6px;
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-table-widget[data-table-overflow="true"] .cm-md-table-widget__viewport::-webkit-scrollbar-track {
  background: transparent;
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-table-widget[data-table-overflow="true"] .cm-md-table-widget__viewport::-webkit-scrollbar-thumb {
  border-radius: 3px;
  background: color-mix(in srgb, var(--theme-control-subtle, #6e7781) 40%, transparent);
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-table-widget[data-table-overflow="true"] .cm-md-table-widget__viewport::-webkit-scrollbar-thumb:hover {
  background: color-mix(in srgb, var(--theme-control-subtle, #6e7781) 65%, transparent);
}
/*
 * 宽度策略（混合，实测依据见 apps/desktop/e2e/codemirror-m3-table-overflow.spec.ts）：
 * 1. width: 100% + table-layout: auto：表格默认撑满正文列，列宽按内容比例自动分配，
 *    超长文本在单元格内换行 ⇒ 绝大多数表格**不需要任何横向滚动**；
 * 2. 单元格可读下限（__cell-editor 的 min-width）保证列不会被压成单字宽；
 * 3. 当「列数 × 可读下限」超出可用宽度时，表格 min-content 撑破 100%，由 viewport 承接滚动。
 * 禁止改回 width: max-content：它按最宽单元格内容撑开表格，.cm-md-table-widget 的
 * max-width: 100% 只约束 wrapper 自身盒模型、**不约束 table 子元素的溢出**，
 * 溢出会直接穿透到 .cm-scroller 产生页面级横向滚动条（本文件的历史缺陷）。
 */
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-table-widget__grid {
  border-collapse: collapse;
  font-size: 0.92em;
  width: 100%;
  table-layout: auto;
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-table-widget__cell {
  box-sizing: border-box;
  position: relative;
  min-width: 2.5rem;
  padding: 0.32rem 0.65rem;
  border: 1px solid var(--theme-border, currentColor) !important;
  vertical-align: top;
  outline: none;
  cursor: text;
  white-space: pre-wrap;
  word-break: break-word;
  font-variant-numeric: tabular-nums;
  transition:
    background var(--cm-transition-fast, 120ms cubic-bezier(0.22, 1, 0.36, 1)),
    box-shadow var(--cm-transition-fast, 120ms cubic-bezier(0.22, 1, 0.36, 1));
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-table-widget__cell--editing, .cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-table-widget__cell:focus, .cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-table-widget__cell:focus-within {
  outline: none;
  box-shadow: inset 0 0 0 1.5px var(--theme-primary, currentColor);
  background: var(--theme-surface, transparent);
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-table-widget__cell--range-selected {
  background: color-mix(in srgb, var(--theme-primary, #4c8bf5) 18%, transparent);
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-table-widget__resize-grip {
  position: absolute;
  z-index: 4;
  top: 0;
  right: -3px;
  width: 7px;
  height: 100%;
  cursor: col-resize;
  touch-action: none;
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-table-widget__cell-editor {
  min-height: 1.35em;
  width: 100%;
  /* 列宽可读下限：列被压到低于此宽度时表格不再继续压缩，改由 viewport 横向滚动。
     值刻意留在 editor 而非 cell：cell 还带 0.65rem×2 内边距，下限要作用在**文字区**上。 */
  min-width: 3.5rem;
  outline: none;
  /* 单元格由浏览器绘制原生光标，不能继承正文自绘光标所需的透明 caret-color。 */
  caret-color: var(--theme-text, currentColor);
  cursor: text;
  white-space: pre-wrap;
  word-break: break-word;
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-table-widget__grid th.cm-md-table-widget__cell {
  font-weight: 600;
  background: var(--theme-bg-muted, var(--theme-surface, transparent));
}
`;
