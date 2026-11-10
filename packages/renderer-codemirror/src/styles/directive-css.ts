/**
 * @file directive-css.ts
 * @description 容器指令 / Admonition（渲染器自持样式片段，由 `index.ts` 汇总注入）。
 *
 * 选择器带 `.cm-md-editor.cm-editor` scope 前缀（该 class 由渲染器经
 * `EditorView.editorAttributes` 挂到 `.cm-editor` 上），特异性 (0,2,0) 与
 * CodeMirror 自带 `baseTheme` 的 `.<id> .cm-*` 平级，靠注入顺序取胜。
 * 所有 `var(--theme-*)` 均带 fallback。
 */

export const directiveCss = String.raw`
Container Directive (Admonition) Styling
   ───────────────────────────────────────────────────────────── */
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-directive-line, .cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-alert {
  padding-left: 1rem;
  border-left: 3.5px solid var(--directive-border, var(--theme-primary, #0969da));
  background-color: var(--directive-bg, var(--theme-primary-soft, rgba(9, 105, 218, 0.06)));
  box-sizing: border-box;
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-directive-line--first, .cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-alert--first {
  border-top-left-radius: var(--theme-radius-base, 6px);
  border-top-right-radius: var(--theme-radius-base, 6px);
  padding-top: 0.35rem;
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-directive-line--last, .cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-alert--last {
  border-bottom-left-radius: var(--theme-radius-base, 6px);
  border-bottom-right-radius: var(--theme-radius-base, 6px);
  padding-bottom: 0.65rem;
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-alert--empty {
  min-height: 0.4rem;
  line-height: 0.8;
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-directive--info, .cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-alert--note, .cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-alert--info {
  --directive-border: #0969da;
  --directive-bg: rgba(9, 105, 218, 0.07);
  --directive-color: #0969da;
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-directive--tip, .cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-directive--note, .cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-alert--tip {
  --directive-border: #1a7f37;
  --directive-bg: rgba(26, 127, 55, 0.07);
  --directive-color: #1a7f37;
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-directive--important, .cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-alert--important {
  --directive-border: #8250df;
  --directive-bg: rgba(130, 80, 223, 0.08);
  --directive-color: #8250df;
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-directive--warning, .cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-alert--warning {
  --directive-border: #d97706;
  --directive-bg: rgba(217, 119, 6, 0.08);
  --directive-color: #d97706;
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-directive--danger, .cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-directive--caution, .cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-alert--danger, .cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-alert--caution {
  --directive-border: #d1242f;
  --directive-bg: rgba(209, 36, 47, 0.08);
  --directive-color: #d1242f;
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-directive__header-content {
  display: flex;
  width: 100%;
  box-sizing: border-box;
  align-items: center;
  gap: 0.45rem;
  font-size: 0.85em;
  font-weight: 700;
  letter-spacing: 0.02em;
  line-height: 1.2;
  color: var(--directive-color, var(--theme-primary, #0969da));
  user-select: none;
  padding-bottom: 0.15rem;
  min-height: 1.25rem;
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-directive__icon-wrap {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: currentColor;
  flex-shrink: 0;
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-directive__title {
  color: currentColor;
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-marker--directive {
  color: var(--theme-marker-dim, var(--theme-muted, #8c959f));
  font-family: var(--theme-mono-font, monospace);
  font-size: 0.9em;
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-directive__footer-placeholder {
  display: inline-block;
  height: 0;
  width: 0;
}
/* ==========================================================================
`;
