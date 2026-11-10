/**
 * @file search-css.ts
 * @description 搜索/替换面板（Liquid Glass HUD）（渲染器自持样式片段，由 `index.ts` 汇总注入）。
 *
 * 选择器带 `.cm-md-editor.cm-editor` scope 前缀（该 class 由渲染器经
 * `EditorView.editorAttributes` 挂到 `.cm-editor` 上），特异性 (0,2,0) 与
 * CodeMirror 自带 `baseTheme` 的 `.<id> .cm-*` 平级，靠注入顺序取胜。
 * 所有 `var(--theme-*)` 均带 fallback。
 */

export const searchCss = String.raw`
CodeMirror Search & Replace Panel (Apple Liquid Glass HUD)
   ========================================================================== */
.cm-md-editor.cm-editor .cm-panels {
  position: sticky;
  left: 0;
  right: 0;
  z-index: 40;
  background: transparent;
  border: none;
}
.cm-md-editor.cm-editor .cm-panels-top {
  top: 0;
  border-bottom: none;
  display: flex;
  justify-content: flex-end;
  padding: 0.85rem 1.5rem 0 0;
  pointer-events: none;
}
.cm-md-editor.cm-editor .cm-panels-bottom {
  bottom: 0;
  border-top: 1px solid var(--theme-glass-border, rgba(0, 0, 0, 0.08));
  background: var(--theme-surface-glass, rgba(255, 255, 255, 0.92));
  backdrop-filter: blur(24px) saturate(190%);
  -webkit-backdrop-filter: blur(24px) saturate(190%);
  box-shadow:
    0 -4px 20px -2px rgba(0, 0, 0, 0.08),
    inset 0 1px 0 0 rgba(255, 255, 255, 0.6);
  pointer-events: auto;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}
:root[data-theme="dark"] .cm-md-editor.cm-editor .cm-panels-bottom {
  border-top-color: var(--theme-glass-border, rgba(255, 255, 255, 0.1));
  background: var(--theme-surface-glass, rgba(24, 24, 27, 0.92));
  box-shadow:
    0 -4px 20px -2px rgba(0, 0, 0, 0.4),
    inset 0 1px 0 0 rgba(255, 255, 255, 0.08);
}
.cm-md-editor.cm-editor .cm-panel.cm-panel-lint {
  position: relative;
  display: flex;
  flex-direction: column;
  padding: 0.6rem 0.85rem;
  box-sizing: border-box;
  font-family: var(--theme-font, system-ui, -apple-system, sans-serif);
  color: var(--theme-text, #1f2328);
}
:root[data-theme="dark"] .cm-md-editor.cm-editor .cm-panel.cm-panel-lint {
  color: var(--theme-text, #f1f3f5);
}
.cm-md-editor.cm-editor .cm-panel.cm-panel-lint ul {
  max-height: 180px;
  overflow-y: auto;
  margin: 0;
  padding: 0 2.2rem 0 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  outline: none;
}
.cm-md-editor.cm-editor .cm-panel.cm-panel-lint ul::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}
.cm-md-editor.cm-editor .cm-panel.cm-panel-lint ul::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.15);
  border-radius: 3px;
}
:root[data-theme="dark"] .cm-md-editor.cm-editor .cm-panel.cm-panel-lint ul::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.2);
}
.cm-md-editor.cm-editor .cm-panel.cm-panel-lint li.cm-diagnostic {
  padding: 0.45rem 0.65rem !important;
  border-radius: 8px !important;
  transition: background 0.12s ease !important;
  cursor: pointer !important;
  border-top: none !important;
  margin: 0 !important;
}
.cm-md-editor.cm-editor .cm-panel.cm-panel-lint li.cm-diagnostic:hover, .cm-md-editor.cm-editor .cm-panel.cm-panel-lint li.cm-diagnostic[aria-selected="true"] {
  background: rgba(0, 0, 0, 0.05) !important;
}
:root[data-theme="dark"] .cm-md-editor.cm-editor .cm-panel.cm-panel-lint li.cm-diagnostic:hover, :root[data-theme="dark"] .cm-md-editor.cm-editor .cm-panel.cm-panel-lint li.cm-diagnostic[aria-selected="true"] {
  background: rgba(255, 255, 255, 0.08) !important;
}
.cm-md-editor.cm-editor .cm-panel.cm-panel-lint [name="close"] {
  position: absolute;
  top: 0.6rem;
  right: 0.85rem;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  margin: 0;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--theme-muted, #656d76);
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
  transition: all 0.15s ease;
  user-select: none;
}
.cm-md-editor.cm-editor .cm-panel.cm-panel-lint [name="close"]:hover {
  background: rgba(0, 0, 0, 0.08);
  color: var(--theme-text, #1f2328);
}
:root[data-theme="dark"] .cm-md-editor.cm-editor .cm-panel.cm-panel-lint [name="close"] {
  color: var(--theme-muted, #8b949e);
}
:root[data-theme="dark"] .cm-md-editor.cm-editor .cm-panel.cm-panel-lint [name="close"]:hover {
  background: rgba(255, 255, 255, 0.12);
  color: var(--theme-text, #f1f3f5);
}
.cm-md-editor.cm-editor .cm-search-liquid-panel {
  pointer-events: auto;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  padding: 0.5rem 0.65rem;
  min-width: 380px;
  max-width: min(540px, 92vw);
  border-radius: 14px;
  background: var(--theme-surface-glass, rgba(255, 255, 255, 0.85));
  backdrop-filter: blur(24px) saturate(190%);
  -webkit-backdrop-filter: blur(24px) saturate(190%);
  border: 1px solid var(--theme-glass-border, rgba(0, 0, 0, 0.08));
  box-shadow:
    0 10px 30px -4px rgba(0, 0, 0, 0.14),
    0 2px 8px -2px rgba(0, 0, 0, 0.06),
    inset 0 1px 0 0 rgba(255, 255, 255, 0.6);
  color: var(--theme-text, #1f2328);
  font-family: var(--theme-font, system-ui, -apple-system, sans-serif);
  font-size: 13px;
  animation: cm-search-appear 0.18s cubic-bezier(0.16, 1, 0.3, 1);
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}


@keyframes cm-search-appear {
  from {
    opacity: 0;
    transform: translateY(-8px) scale(0.97);
  }

  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }

}
.cm-md-editor.cm-editor .cm-search-row, .cm-md-editor.cm-editor .cm-replace-row {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}
.cm-md-editor.cm-editor .cm-search-icon-slot {
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  color: var(--theme-muted, #8c959f);
  flex-shrink: 0;
}
.cm-md-editor.cm-editor .cm-search-input {
  flex: 1 1 auto;
  min-width: 100px;
  height: 28px;
  padding: 0 0.55rem;
  border-radius: 7px;
  border: 1px solid var(--theme-control-border, rgba(0, 0, 0, 0.1));
  background: var(--theme-input-bg, rgba(255, 255, 255, 0.8));
  color: var(--theme-text, inherit);
  font-size: 12.5px;
  font-family: inherit;
  outline: none;
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.03);
  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease,
    background-color 0.15s ease;
}
.cm-md-editor.cm-editor .cm-search-input:focus {
  border-color: var(--theme-primary, #0969da);
  background: var(--theme-input-focus-bg, #ffffff);
  box-shadow:
    0 0 0 2.5px var(--theme-primary-soft, rgba(9, 105, 218, 0.18)),
    inset 0 1px 2px rgba(0, 0, 0, 0.02);
}
.cm-md-editor.cm-editor .cm-search-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.12rem 0.45rem;
  height: 18px;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  font-weight: 500;
  color: var(--theme-muted, #656d76);
  background: var(--theme-control-hover, rgba(0, 0, 0, 0.05));
  border-radius: 9999px;
  white-space: nowrap;
  user-select: none;
  flex-shrink: 0;
}
.cm-md-editor.cm-editor .cm-search-badge.no-match {
  color: var(--theme-danger-text, #cf222e);
  background: var(--theme-danger-soft, rgba(207, 34, 46, 0.1));
}
.cm-md-editor.cm-editor .cm-search-icon-button {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border-radius: 6px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--theme-control-text, #57606a);
  cursor: pointer;
  flex-shrink: 0;
  transition:
    background-color 0.12s ease,
    color 0.12s ease,
    border-color 0.12s ease;
}
.cm-md-editor.cm-editor .cm-search-icon-button:hover {
  background: var(--theme-control-hover, rgba(0, 0, 0, 0.06));
  color: var(--theme-title, #1f2328);
}
.cm-md-editor.cm-editor .cm-search-icon-button:active {
  background: var(--theme-control-active, rgba(0, 0, 0, 0.1));
}
.cm-md-editor.cm-editor .cm-search-icon-button.active {
  background: var(--theme-primary-soft, rgba(9, 105, 218, 0.12));
  color: var(--theme-primary, #0969da);
}
.cm-md-editor.cm-editor .cm-search-divider {
  width: 1px;
  height: 16px;
  background: var(--theme-glass-border, rgba(0, 0, 0, 0.1));
  margin: 0 0.1rem;
  flex-shrink: 0;
}
.cm-md-editor.cm-editor .cm-search-filter-group {
  display: flex;
  align-items: center;
  background: var(--theme-control-hover, rgba(0, 0, 0, 0.04));
  padding: 2px;
  border-radius: 7px;
  border: 1px solid var(--theme-control-border, rgba(0, 0, 0, 0.06));
  flex-shrink: 0;
}
.cm-md-editor.cm-editor .cm-search-filter-btn {
  display: grid;
  place-items: center;
  height: 20px;
  padding: 0 0.4rem;
  border-radius: 5px;
  border: none;
  background: transparent;
  color: var(--theme-muted, #656d76);
  font-size: 11px;
  font-weight: 600;
  font-family: var(--theme-mono-font, monospace);
  cursor: pointer;
  user-select: none;
  transition: all 0.12s ease;
}
.cm-md-editor.cm-editor .cm-search-filter-btn:hover {
  color: var(--theme-title, #1f2328);
}
.cm-md-editor.cm-editor .cm-search-filter-btn.active {
  background: var(--theme-surface, #ffffff);
  color: var(--theme-primary, #0969da);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}
.cm-md-editor.cm-editor .cm-search-close-button {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  padding: 0;
  margin-left: 0.15rem;
  border-radius: 50%;
  border: none;
  background: transparent;
  color: var(--theme-muted, #8c959f);
  cursor: pointer;
  flex-shrink: 0;
  transition:
    background-color 0.12s ease,
    color 0.12s ease;
}
.cm-md-editor.cm-editor .cm-search-close-button:hover {
  background: var(--theme-control-hover, rgba(0, 0, 0, 0.08));
  color: var(--theme-title, #1f2328);
}
.cm-md-editor.cm-editor .cm-search-pill-button {
  height: 26px;
  padding: 0 0.65rem;
  border-radius: 6px;
  border: 1px solid var(--theme-control-border, rgba(0, 0, 0, 0.1));
  background: var(--theme-control-bg, rgba(0, 0, 0, 0.04));
  color: var(--theme-text, inherit);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  white-space: nowrap;
  flex-shrink: 0;
  transition:
    background-color 0.12s ease,
    border-color 0.12s ease,
    transform 0.08s ease;
}
.cm-md-editor.cm-editor .cm-search-pill-button:hover {
  background: var(--theme-control-hover, rgba(0, 0, 0, 0.08));
  border-color: var(--theme-control-border, rgba(0, 0, 0, 0.16));
}
.cm-md-editor.cm-editor .cm-search-pill-button:active {
  transform: scale(0.98);
}
.cm-md-editor.cm-editor .cm-search-pill-button--primary {
  background: var(--theme-primary, #0969da);
  color: #ffffff;
  border-color: var(--theme-primary, #0969da);
}
.cm-md-editor.cm-editor .cm-search-pill-button--primary:hover {
  background: var(--theme-primary-hover, #085cc0);
  border-color: var(--theme-primary-hover, #085cc0);
}
.cm-md-editor.cm-editor .cm-search-match {
  background-color: var(--theme-search-match, rgba(255, 212, 0, 0.35));
  border-radius: 2px;
}
.cm-md-editor.cm-editor .cm-search-match-selected {
  background-color: var(--theme-search-match-active, rgba(255, 150, 0, 0.65));
  outline: 1.5px solid var(--theme-search-match-outline, rgba(255, 120, 0, 0.9));
  border-radius: 2px;
}
/* ─────────────────────────────────────────────────────────────
`;
