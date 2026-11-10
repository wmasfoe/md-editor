/**
 * @file lint-css.ts
 * @description Lint tooltip 与诊断信息（渲染器自持样式片段，由 `index.ts` 汇总注入）。
 *
 * 选择器带 `.cm-md-editor.cm-editor` scope 前缀（该 class 由渲染器经
 * `EditorView.editorAttributes` 挂到 `.cm-editor` 上），特异性 (0,2,0) 与
 * CodeMirror 自带 `baseTheme` 的 `.<id> .cm-*` 平级，靠注入顺序取胜。
 * 所有 `var(--theme-*)` 均带 fallback。
 */

export const lintCss = String.raw`
CodeMirror Lint Tooltip & Diagnostics (Theme-Adaptive & Liquid Glass)
   ========================================================================== */
.cm-md-editor.cm-editor .cm-tooltip:has(.cm-tooltip-lint), .cm-md-editor.cm-editor .cm-tooltip.cm-tooltip-lint {
  border: 1px solid var(--theme-border-strong, rgba(0, 0, 0, 0.12)) !important;
  background-color: var(--theme-surface, #ffffff) !important;
  background: color-mix(in srgb, var(--theme-surface, #ffffff) 94%, transparent) !important;
  -webkit-backdrop-filter: blur(24px) saturate(190%) !important;
  backdrop-filter: blur(24px) saturate(190%) !important;
  border-radius: 12px !important;
  box-shadow:
    0 1px 0 0 color-mix(in srgb, var(--theme-surface, #fff) 60%, transparent) inset,
    var(--theme-shadow, 0 12px 32px -4px rgba(0, 0, 0, 0.14)) !important;
  padding: 0 !important;
  max-width: 440px !important;
  min-width: 280px !important;
  z-index: 1000 !important;
  color: var(--theme-text, inherit) !important;
  overflow: hidden !important;
  animation: cm-lint-fade-in 140ms cubic-bezier(0.16, 1, 0.3, 1) !important;
}
.cm-md-editor.cm-editor .cm-tooltip:has(.cm-tooltip-lint) .cm-tooltip-arrow, .cm-md-editor.cm-editor .cm-tooltip.cm-tooltip-lint .cm-tooltip-arrow {
  display: none !important;
}
:root[data-theme-scheme="dark"] .cm-md-editor.cm-editor .cm-tooltip:has(.cm-tooltip-lint), :root[data-theme-scheme="dark"] .cm-md-editor.cm-editor .cm-tooltip.cm-tooltip-lint, :root.dark .cm-md-editor.cm-editor .cm-tooltip:has(.cm-tooltip-lint), :root.dark .cm-md-editor.cm-editor .cm-tooltip.cm-tooltip-lint, .dark .cm-md-editor.cm-editor .cm-tooltip:has(.cm-tooltip-lint), .dark .cm-md-editor.cm-editor .cm-tooltip.cm-tooltip-lint {
  border-color: var(--theme-border-strong, rgba(255, 255, 255, 0.15)) !important;
  background-color: var(--theme-surface, #14171d) !important;
  background: color-mix(in srgb, var(--theme-surface, #14171d) 94%, transparent) !important;
  box-shadow:
    0 1px 0 0 rgba(255, 255, 255, 0.08) inset,
    var(--theme-shadow, 0 16px 40px -4px rgba(0, 0, 0, 0.65)) !important;
  color: var(--theme-text, #d7dae0) !important;
}


@media (prefers-color-scheme: dark) {:root:not([data-theme-scheme="light"]) .cm-md-editor.cm-editor .cm-tooltip:has(.cm-tooltip-lint), :root:not([data-theme-scheme="light"]) .cm-md-editor.cm-editor .cm-tooltip.cm-tooltip-lint {
    border-color: var(--theme-border-strong, rgba(255, 255, 255, 0.15)) !important;
    background-color: var(--theme-surface, #14171d) !important;
    background: color-mix(in srgb, var(--theme-surface, #14171d) 94%, transparent) !important;
    box-shadow:
      0 1px 0 0 rgba(255, 255, 255, 0.08) inset,
      var(--theme-shadow, 0 16px 40px -4px rgba(0, 0, 0, 0.65)) !important;
    color: var(--theme-text, #d7dae0) !important;
  }

}


@keyframes cm-lint-fade-in {
  from {
    opacity: 0;
    transform: translateY(2px) scale(0.98);
  }

  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }

}
.cm-md-editor.cm-editor .cm-tooltip-lint {
  list-style: none !important;
  padding: 0 !important;
  margin: 0 !important;
  background: transparent !important;
}
.cm-md-editor.cm-editor .cm-diagnostic {
  border-left: none !important;
  padding: 8px 12px !important;
  margin: 0 !important;
  display: flex !important;
  flex-direction: row !important;
  align-items: center !important;
  justify-content: space-between !important;
  gap: 12px !important;
  background: transparent !important;
  font-family: var(
    --theme-font,
    -apple-system,
    BlinkMacSystemFont,
    "SF Pro Text",
    system-ui,
    sans-serif
  ) !important;
}
.cm-md-editor.cm-editor .cm-diagnosticText {
  flex: 1 1 auto;
  min-width: 0;
  color: var(--theme-text, inherit);
  font-size: 13px;
  line-height: 1.4;
}
.cm-md-editor.cm-editor .cm-diagnostic + .cm-diagnostic {
  border-top: 1px solid var(--theme-border, rgba(0, 0, 0, 0.06)) !important;
  padding-top: 8px !important;
  margin-top: 0 !important;
}
:root[data-theme-scheme="dark"] .cm-md-editor.cm-editor .cm-diagnostic + .cm-diagnostic, :root.dark .cm-md-editor.cm-editor .cm-diagnostic + .cm-diagnostic, .dark .cm-md-editor.cm-editor .cm-diagnostic + .cm-diagnostic {
  border-top-color: var(--theme-border, rgba(255, 255, 255, 0.08)) !important;
}
.cm-md-editor.cm-editor .cm-diagnosticSource {
  display: none !important;
}
.cm-md-editor.cm-editor .cm-diagnosticAction {
  flex-shrink: 0 !important;
  align-self: center !important;
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  height: 24px !important;
  padding: 0 10px !important;
  border-radius: 5px !important;
  font-size: 11.5px !important;
  font-weight: 500 !important;
  cursor: pointer !important;
  white-space: nowrap !important;
  user-select: none !important;
  background-color: var(--theme-primary-soft, rgba(9, 105, 218, 0.08)) !important;
  border: 1px solid color-mix(in srgb, var(--theme-primary, #0969da) 25%, transparent) !important;
  color: var(--theme-primary, #0969da) !important;
  box-shadow: 0 1px 2px rgba(9, 105, 218, 0.06) !important;
  transition: all 120ms cubic-bezier(0.16, 1, 0.3, 1) !important;
}
.cm-md-editor.cm-editor .cm-diagnosticAction:hover {
  background-color: var(--theme-primary, #0969da) !important;
  border-color: var(--theme-primary, #0969da) !important;
  color: #ffffff !important;
  box-shadow: 0 2px 6px rgba(9, 105, 218, 0.25) !important;
}
.cm-md-editor.cm-editor .cm-diagnosticAction:active {
  transform: scale(0.97) !important;
}
:root[data-theme-scheme="dark"] .cm-md-editor.cm-editor .cm-diagnosticAction, :root.dark .cm-md-editor.cm-editor .cm-diagnosticAction, .dark .cm-md-editor.cm-editor .cm-diagnosticAction {
  background-color: rgba(122, 162, 247, 0.12) !important;
  border-color: rgba(122, 162, 247, 0.25) !important;
  color: #a5c2ff !important;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25) !important;
}
:root[data-theme-scheme="dark"] .cm-md-editor.cm-editor .cm-diagnosticAction:hover, :root.dark .cm-md-editor.cm-editor .cm-diagnosticAction:hover, .dark .cm-md-editor.cm-editor .cm-diagnosticAction:hover {
  background-color: #3b69b5 !important;
  border-color: #7aa2f7 !important;
  color: #ffffff !important;
  box-shadow: 0 2px 6px rgba(122, 162, 247, 0.35) !important;
}
.cm-md-editor.cm-editor .cm-lintRange-error {
  background-image: none !important;
  border-bottom: none !important;
  text-decoration: underline wavy var(--theme-danger-text, #ef4444) !important;
  text-underline-offset: 3.5px !important;
  text-decoration-skip-ink: none !important;
  padding-bottom: 0 !important;
}
.cm-md-editor.cm-editor .cm-lintRange-warning {
  background-image: none !important;
  border-bottom: none !important;
  text-decoration: underline wavy #f59e0b !important;
  text-underline-offset: 3.5px !important;
  text-decoration-skip-ink: none !important;
  padding-bottom: 0 !important;
}
`;
