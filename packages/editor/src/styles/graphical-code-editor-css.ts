export const graphicalCodeEditorCss = `
.md-editor-graphical-code-editor {
  margin: auto;
  width: min(64rem, calc(100vw - 2rem));
  max-width: calc(100vw - 2rem);
  max-height: calc(100dvh - 2rem);
  padding: 1rem;
  border: 1px solid var(--theme-border, #cbd5e1);
  border-radius: 0.75rem;
  color: var(--theme-text, #0f172a);
  background: var(--theme-surface, #fff);
  font-family: var(--theme-ui-font, var(--theme-font, system-ui, sans-serif));
  box-shadow: 0 0.75rem 2rem rgb(0 0 0 / 16%);
}
.md-editor-graphical-code-editor::backdrop { background: rgb(15 23 42 / 48%); }
.md-editor-graphical-code-editor[open] { display: flex; flex-direction: column; height: min(44rem, calc(100dvh - 2rem)); overflow: hidden; }
.md-editor-graphical-code-editor h2 { margin: 0 0 1rem; font-size: 1rem; font-weight: 600; }
.md-editor-graphical-code-editor__surface { flex: 1 1 0; min-height: 0; overflow: auto; }
.md-editor-graphical-code-editor__footer { display: flex; align-items: center; gap: 8px; margin-top: 12px; }
.md-editor-graphical-code-editor__footer > [role="status"] { flex: 1; margin: 0; font-size: 12px; color: var(--theme-muted, #475569); }
.md-editor-graphical-code-editor__footer > button {
  flex: none;
  min-height: 36px;
  padding: 6px 16px;
  border: 1px solid var(--theme-border, #cbd5e1);
  border-radius: 0.4rem;
  color: inherit;
  background: var(--theme-surface, #fff);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}
.md-editor-graphical-code-editor__footer > .md-editor-graphical-code-editor__apply { background: var(--theme-text, #0f172a); color: var(--theme-surface, #fff); border-color: transparent; }
.md-editor-graphical-code-editor__footer > button:focus-visible { outline: 2px solid var(--theme-accent, #2563eb); outline-offset: 2px; }
.md-editor-graphical-code-editor__footer > button:disabled { opacity: 0.5; cursor: wait; }
@media (max-width: 600px) {
  .md-editor-graphical-code-editor { width: calc(100vw - 16px); max-width: calc(100vw - 16px); padding: 12px; }
  .md-editor-graphical-code-editor__footer { flex-wrap: wrap; }
}
@media (max-height: 600px) {
  .md-editor-graphical-code-editor { padding: 12px; }
  .md-editor-graphical-code-editor h2 { margin-bottom: 8px; }
  .md-editor-graphical-code-editor__footer { margin-top: 8px; }
}
`;
