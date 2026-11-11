/**
 * @file code-block-css.ts
 * @description 代码块卡片、三段式 Header 与行号（渲染器自持样式片段，由 `index.ts` 汇总注入）。
 *
 * 选择器带 `.cm-md-editor.cm-editor` scope 前缀（该 class 由渲染器经
 * `EditorView.editorAttributes` 挂到 `.cm-editor` 上），特异性 (0,2,0) 与
 * CodeMirror 自带 `baseTheme` 的 `.<id> .cm-*` 平级，靠注入顺序取胜。
 * 所有 `var(--theme-*)` 均带 fallback。
 */

export const codeBlockCss = String.raw`
/* ── 代码块卡片与三段式 Header ── */
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-code-toolbar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.28rem 0.65rem;
  border-top-left-radius: var(--theme-radius-base, 6px);
  border-top-right-radius: var(--theme-radius-base, 6px);
  background: var(--theme-code-gutter-bg, var(--theme-bg-muted, #f6f8fa));
  border: 1px solid var(--theme-code-border, var(--theme-border, #d8dee4));
  border-bottom: 1px solid var(--theme-border, rgba(0, 0, 0, 0.06));
  color: var(--theme-control-subtle, var(--theme-muted, #6e7781));
  font-size: 0.76rem;
  user-select: none;
  transition:
    background var(--cm-transition-fast, 120ms cubic-bezier(0.22, 1, 0.36, 1)),
    border-color var(--cm-transition-fast, 120ms cubic-bezier(0.22, 1, 0.36, 1)),
    color var(--cm-transition-fast, 120ms cubic-bezier(0.22, 1, 0.36, 1));
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-code-toolbar--active {
  color: var(--theme-text, currentColor);
  border-color: var(--theme-border-strong, var(--theme-border, #afb8c1));
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-code-toolbar__language {
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  color: var(--theme-title, var(--theme-text, currentColor));
  font-family: var(--theme-mono-font, ui-monospace, monospace);
  font-size: 0.82em;
  font-weight: 600;
  padding: 0.12rem 0.35rem;
  cursor: pointer;
  outline: none;
  transition:
    background var(--cm-transition-fast, 120ms cubic-bezier(0.22, 1, 0.36, 1)),
    border-color var(--cm-transition-fast, 120ms cubic-bezier(0.22, 1, 0.36, 1)),
    color var(--cm-transition-fast, 120ms cubic-bezier(0.22, 1, 0.36, 1));
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-code-toolbar__language:hover, .cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-code-toolbar__language:focus-visible {
  background: var(--theme-primary-soft, rgba(0, 0, 0, 0.05));
  border-color: var(--theme-border, currentColor);
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-code-toolbar__select, .cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-code-toolbar__copy {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  color: var(--theme-control-subtle, var(--theme-muted, currentColor));
  font-size: 0.78em;
  padding: 0.12rem 0.45rem;
  cursor: pointer;
  outline: none;
  transition:
    background var(--cm-transition-fast, 120ms cubic-bezier(0.22, 1, 0.36, 1)),
    border-color var(--cm-transition-fast, 120ms cubic-bezier(0.22, 1, 0.36, 1)),
    color var(--cm-transition-fast, 120ms cubic-bezier(0.22, 1, 0.36, 1)),
    transform var(--cm-transition-fast, 120ms cubic-bezier(0.22, 1, 0.36, 1));
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-code-toolbar__select:hover, .cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-code-toolbar__copy:hover {
  background: var(--theme-primary-soft, rgba(0, 0, 0, 0.06));
  color: var(--theme-primary, var(--theme-text, currentColor));
  border-color: var(--theme-border, currentColor);
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-code-toolbar__select:active, .cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-code-toolbar__copy:active {
  transform: scale(0.95);
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-code-toolbar__status {
  font-size: 0.78em;
  color: var(--theme-primary, currentColor);
  font-weight: 500;
  transition: opacity var(--cm-transition-fast, 120ms cubic-bezier(0.22, 1, 0.36, 1));
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-code-line {
  box-sizing: border-box;
  font-family: var(
    --theme-mono-font,
    ui-monospace,
    SFMono-Regular,
    Menlo,
    Monaco,
    Consolas,
    monospace
  );
  font-size: 0.88em;
  line-height: 1.65;
  background: var(--theme-code-bg, var(--theme-bg-muted, #f6f8fa));
  border-left: 1px solid var(--theme-code-border, var(--theme-border, #d8dee4));
  border-right: 1px solid var(--theme-code-border, var(--theme-border, #d8dee4));
  padding-inline: 0.85rem;
  color: var(--theme-code, var(--theme-text, currentColor));
  outline: 0 !important;
  outline-width: 0px !important;
  transition:
    background var(--cm-transition-fast, 120ms cubic-bezier(0.22, 1, 0.36, 1)),
    border-color var(--cm-transition-fast, 120ms cubic-bezier(0.22, 1, 0.36, 1));
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-code-line.cm-md-code-line-numbered {
  position: relative;
  padding-inline-start: calc(var(--md-code-line-number-width, 1ch) + 1.6rem);
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-code-line.cm-md-code-line-numbered::before {
  content: attr(data-md-code-line-number);
  position: absolute;
  inset-inline-start: 0.65rem;
  width: var(--md-code-line-number-width, 1ch);
  color: var(--theme-muted, currentColor);
  font-family: var(
    --theme-mono-font,
    ui-monospace,
    SFMono-Regular,
    Menlo,
    Monaco,
    Consolas,
    monospace
  );
  font-size: 0.88em;
  font-variant-numeric: tabular-nums;
  text-align: end;
  user-select: none;
  pointer-events: none;
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-code-line--first {
  padding-top: 0.45rem;
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-code-line--last {
  border-bottom: 1px solid var(--theme-code-border, var(--theme-border, #d8dee4));
  border-bottom-left-radius: var(--theme-radius-base, 6px);
  border-bottom-right-radius: var(--theme-radius-base, 6px);
  padding-bottom: 0.45rem;
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-code-block-spacer {
  height: 0.65rem;
  pointer-events: none;
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-code-line--active {
  border-left-color: var(--theme-border-strong, var(--theme-border, #afb8c1));
  border-right-color: var(--theme-border-strong, var(--theme-border, #afb8c1));
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-code-line--last.cm-md-code-line--active {
  border-bottom-color: var(--theme-border-strong, var(--theme-border, #afb8c1));
}
/* 行/列块手柄（Notion 式 ⋮⋮）：默认透明，悬停表格时显示。 */
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-table-widget__handle {
  position: absolute;
  display: flex;
  align-items: center;
  gap: 2px;
  z-index: 2;
  opacity: 0;
  transition: opacity var(--cm-transition-fast, 120ms cubic-bezier(0.22, 1, 0.36, 1));
  line-height: 1;
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-table-widget:hover .cm-md-table-widget__handle {
  opacity: 1;
}
/* 行手柄：贴在本行第一列左缘（表格外）。 */
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-table-widget__handle--row {
  top: 0.15rem;
  left: -1.35rem;
}
/* 列手柄：贴在表头右缘。 */
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-table-widget__handle--col {
  top: 0.15rem;
  right: -0.65rem;
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-table-widget__btn {
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.15rem;
  height: 1.15rem;
  margin: 0;
  padding: 0;
  border: 1px solid var(--theme-border, currentColor) !important;
  border-radius: 4px;
  background: var(--theme-surface, transparent);
  color: var(--theme-text, currentColor);
  font: inherit;
  font-size: 0.72em;
  line-height: 1;
  cursor: pointer;
  transition:
    background var(--cm-transition-fast, 120ms cubic-bezier(0.22, 1, 0.36, 1)),
    border-color var(--cm-transition-fast, 120ms cubic-bezier(0.22, 1, 0.36, 1)),
    color var(--cm-transition-fast, 120ms cubic-bezier(0.22, 1, 0.36, 1)),
    transform var(--cm-transition-fast, 120ms cubic-bezier(0.22, 1, 0.36, 1));
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-table-widget__btn:hover {
  border-color: var(--theme-primary, currentColor) !important;
  color: var(--theme-primary, currentColor);
  background: var(--theme-primary-soft, var(--theme-bg-muted, transparent));
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-table-widget__btn:active {
  transform: scale(0.94);
}
/* 行/列操作浮层菜单。 */
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-table-widget__menu {
  position: absolute;
  z-index: 4;
  display: flex;
  flex-direction: column;
  min-width: 8.5rem;
  padding: 0.25rem;
  border: 1px solid var(--theme-border, currentColor) !important;
  border-radius: 6px;
  background: var(--theme-surface, var(--theme-bg, #ffffff));
  box-shadow: 0 2px 10px rgb(0 0 0 / 0.14);
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-table-widget__menu[hidden] {
  display: none;
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-table-widget__menu-item {
  box-sizing: border-box;
  display: block;
  width: 100%;
  height: auto;
  justify-content: flex-start;
  padding: 0.3rem 0.55rem;
  border: none !important;
  border-radius: 4px;
  background: transparent;
  font-size: 0.82em;
  text-align: left;
  white-space: nowrap;
  transition:
    background var(--cm-transition-fast, 120ms cubic-bezier(0.22, 1, 0.36, 1)),
    color var(--cm-transition-fast, 120ms cubic-bezier(0.22, 1, 0.36, 1));
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-table-widget__menu-item:hover {
  background: var(--theme-primary-soft, var(--theme-bg-muted, transparent));
  color: var(--theme-primary, currentColor);
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-table-widget__menu-item--danger {
  color: var(--theme-danger, #d9534f);
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-table-widget__menu-item--danger:hover {
  background: color-mix(in srgb, var(--theme-danger, #d9534f) 12%, transparent);
  color: var(--theme-danger, #d9534f);
}
/* 当前对齐项勾选标记。 */
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-table-widget__menu-item--active::before {
  content: "✓ ";
  color: var(--theme-primary, currentColor);
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-default-atom {
  display: inline-flex;
  box-sizing: border-box;
  min-width: 0;
  align-items: baseline;
  gap: 0.38em;
  border-radius: 3px;
  color: var(--theme-text, currentColor);
  cursor: pointer;
  vertical-align: baseline;
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-default-atom--block {
  display: flex;
  width: 100%;
  padding: 0.12em 0;
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-default-atom__primary {
  min-width: 0;
  overflow-wrap: anywhere;
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-default-atom__secondary {
  min-width: 0;
  overflow: hidden;
  color: var(--theme-muted, currentColor);
  font-family: var(
    --theme-mono-font,
    ui-monospace,
    SFMono-Regular,
    Menlo,
    Monaco,
    Consolas,
    monospace
  );
  font-size: 0.82em;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-default-atom--heading-setext {
  color: var(--theme-title, currentColor);
  font-weight: 650;
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-default-atom--heading-setext[aria-level="1"] {
  font-size: 1.85em;
  line-height: 1.35;
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-default-atom--heading-setext[aria-level="2"] {
  font-size: 1.55em;
  line-height: 1.4;
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-default-atom--autolink, .cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-default-atom--reference-link {
  color: var(--theme-link, var(--theme-accent, currentColor));
  text-decoration: underline;
  text-decoration-thickness: 1px;
  text-underline-offset: 0.14em;
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-default-atom--reference-definition, .cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-default-atom--footnote.cm-md-default-atom--block {
  border-left: 2px solid var(--theme-border, currentColor);
  padding-left: 0.6em;
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-default-atom--footnote:not(.cm-md-default-atom--block) {
  position: relative;
  top: -0.28em;
  color: var(--theme-link, var(--theme-accent, currentColor));
  font-size: 0.78em;
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-default-atom--selected {
  outline: 2px solid var(--theme-focus-ring, var(--theme-accent, currentColor));
  outline-offset: 1px;
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-frontmatter-line {
  box-sizing: border-box;
  padding-right: 0;
  padding-left: 0.8rem;
  border-left: 1px solid var(--theme-border, currentColor);
  background: transparent;
  font-family: var(
    --theme-mono-font,
    ui-monospace,
    SFMono-Regular,
    Menlo,
    Monaco,
    Consolas,
    monospace
  );
  font-size: 0.88em;
  line-height: 1.65;
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-frontmatter-line--header {
  min-height: 0.72rem;
  padding-top: 0;
  padding-bottom: 0;
  font-family: var(--theme-ui-font, inherit);
  font-size: 0.76em;
  line-height: 0.72rem;
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-frontmatter-line--footer {
  min-height: 0.72rem;
  line-height: 0.72rem;
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-frontmatter-line--error {
  border-left-color: var(--theme-danger-text, #cf222e);
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-frontmatter-header {
  display: inline-flex;
  align-items: center;
  color: var(--theme-danger-text, #cf222e);
  font-weight: 500;
  letter-spacing: 0;
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-frontmatter-header[hidden] {
  display: none;
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-frontmatter-header__status {
  font-size: 0.78rem;
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-yaml-key {
  color: var(--theme-title, currentColor);
  font-weight: 600;
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-yaml-string {
  color: var(--theme-string, var(--theme-accent, currentColor));
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-yaml-scalar {
  color: var(--theme-number, var(--theme-link, currentColor));
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-yaml-anchor, .cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-yaml-alias {
  color: var(--theme-keyword, var(--theme-accent, currentColor));
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-yaml-comment {
  color: var(--theme-muted, currentColor);
  font-style: italic;
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-yaml-error {
  text-decoration-color: var(--theme-danger, #c43d4b);
  text-decoration-line: underline;
  text-decoration-style: wavy;
  text-decoration-thickness: 1px;
  text-underline-offset: 0.18em;
}
/* ==========================================================================
`;
