/**
 * @file mermaid-css.ts
 * @description Mermaid 图表 widget 与错误卡片（渲染器自持样式片段，由 `index.ts` 汇总注入）。
 *
 * 选择器带 `.cm-md-editor.cm-editor` scope 前缀（该 class 由渲染器经
 * `EditorView.editorAttributes` 挂到 `.cm-editor` 上），特异性 (0,2,0) 与
 * CodeMirror 自带 `baseTheme` 的 `.<id> .cm-*` 平级，靠注入顺序取胜。
 * 所有 `var(--theme-*)` 均带 fallback。
 */

export const mermaidCss = String.raw`
Mermaid Diagram Widgets & Error Cards
   ========================================================================== */
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-mermaid-container {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 1.5rem 1.25rem;
  margin: 0;
  border-radius: 8px;
  border: 1px solid var(--theme-border, #d8dee4);
  background: var(--theme-surface, #ffffff);
  cursor: pointer;
  min-height: 90px;
  overflow-x: auto;
  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease;
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-mermaid-container:hover {
  border-color: var(--theme-primary, #0969da);
  box-shadow: var(--theme-shadow, 0 1px 3px rgba(0, 0, 0, 0.06));
}
/* 图表块外层包装：承载悬浮工具栏。
   工具栏必须放在**滚动层之外**：\`.cm-md-mermaid-container\` 带 \`overflow-x: auto\`，
   绝对定位的工具栏若位于其中，超宽图横向滚动时会被裁剪/滚走（AC19）。 */
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-mermaid-block {
  position: relative;
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-mermaid-toolbar {
  position: absolute;
  top: 0.4rem;
  right: 0.4rem;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 0.35rem;
  opacity: 0;
  pointer-events: none;
  transition: opacity var(--cm-transition-fast, 120ms cubic-bezier(0.22, 1, 0.36, 1));
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-mermaid-block:hover .cm-md-mermaid-toolbar {
  opacity: 1;
  pointer-events: auto;
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-mermaid-toolbar__viewer, .cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-mermaid-toolbar__edit {
  border: 1px solid var(--theme-border, #d8dee4);
  border-radius: 4px;
  background: var(--theme-surface, #fff);
  color: var(--theme-control-subtle, var(--theme-muted, #6e7781));
  cursor: pointer;
  font-family: var(--theme-ui-font, var(--theme-font, system-ui, sans-serif));
  font-size: 0.76rem;
  line-height: 1;
  padding: 0.28rem 0.45rem;
  transition:
    background var(--cm-transition-fast, 120ms cubic-bezier(0.22, 1, 0.36, 1)),
    color var(--cm-transition-fast, 120ms cubic-bezier(0.22, 1, 0.36, 1)),
    border-color var(--cm-transition-fast, 120ms cubic-bezier(0.22, 1, 0.36, 1));
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-mermaid-toolbar__viewer:hover, .cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-mermaid-toolbar__edit:hover {
  background: var(--theme-primary-soft, rgba(0, 0, 0, 0.06));
  color: var(--theme-primary, var(--theme-text, currentColor));
  border-color: var(--theme-border-strong, var(--theme-border, #afb8c1));
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-mermaid-toolbar__viewer[disabled] {
  opacity: 0.45;
  cursor: default;
  pointer-events: none;
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-mermaid-loading {
  font-size: 0.85rem;
  color: var(--theme-muted, #6e7781);
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-mermaid-error {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  width: 100%;
  padding: 0.75rem 1rem;
  background: var(--theme-danger-bg, rgba(207, 34, 46, 0.08));
  border-left: 3px solid var(--theme-danger-text, #cf222e);
  border-radius: 4px;
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-mermaid-error__title {
  font-weight: 600;
  font-size: 0.875rem;
  color: var(--theme-danger-text, #cf222e);
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-mermaid-error__message {
  font-size: 0.75rem;
  font-family: var(--theme-mono-font, monospace);
  margin: 0;
  white-space: pre-wrap;
  color: var(--theme-text, #24292f);
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-mermaid-error__hint {
  font-size: 0.75rem;
  color: var(--theme-muted, #6e7781);
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-marker--mermaid {
  color: var(--theme-marker-dim, var(--theme-muted, #8c959f));
  font-family: var(--theme-mono-font, monospace);
  font-size: 0.9em;
}
/* ==========================================================================
`;
