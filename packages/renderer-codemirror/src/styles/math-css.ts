/**
 * @file math-css.ts
 * @description KaTeX 数学 widget 与标记（渲染器自持样式片段，由 `index.ts` 汇总注入）。
 *
 * 选择器带 `.cm-md-editor.cm-editor` scope 前缀（该 class 由渲染器经
 * `EditorView.editorAttributes` 挂到 `.cm-editor` 上），特异性 (0,2,0) 与
 * CodeMirror 自带 `baseTheme` 的 `.<id> .cm-*` 平级，靠注入顺序取胜。
 * 所有 `var(--theme-*)` 均带 fallback。
 */

export const mathCss = String.raw`
LaTeX Math Widgets & Markers (KaTeX)
   ========================================================================== */
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-math-inline {
  display: inline-block;
  vertical-align: baseline;
  cursor: pointer;
  border-radius: 4px;
  padding: 0 0.15em;
  margin: 0;
  line-height: normal;
  box-sizing: border-box;
  user-select: none;
  transition: background 0.15s ease;
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-math-inline .katex {
  font-size: 1.05em;
  line-height: normal;
  vertical-align: baseline;
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-math-inline:hover {
  background: var(--theme-primary-soft, rgba(9, 105, 218, 0.1));
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-math-block {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 1rem 1rem;
  margin: 0;
  cursor: pointer;
  border-radius: 6px;
  overflow-x: auto;
  transition:
    background 0.15s ease,
    border-color 0.15s ease;
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-math-block:hover {
  background: var(--theme-primary-soft, rgba(9, 105, 218, 0.05));
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-math--has-error {
  color: var(--theme-danger-text, #cf222e);
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-marker--math, .cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-marker--math-block {
  color: var(--theme-marker-dim, var(--theme-muted, #8c959f));
  font-family: var(--theme-mono-font, monospace);
  font-size: 0.9em;
}
/* ==========================================================================
`;
