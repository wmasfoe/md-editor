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
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-table-widget__grid {
  border-collapse: collapse;
  font-size: 0.92em;
  width: 100%;
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
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-table-widget__cell-editor {
  min-height: 1.35em;
  width: 100%;
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
