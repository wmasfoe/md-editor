export const graphicalCodeEditorCss = `
.md-editor-graphical-code-editor {
  margin: auto;
  width: min(72rem, calc(100vw - 2rem));
  max-width: calc(100vw - 2rem);
  max-height: calc(100dvh - 2rem);
  padding: 1.25rem;
  border: 1px solid var(--theme-border, #cbd5e1);
  border-radius: 0.75rem;
  color: var(--theme-text, #0f172a);
  background: var(--theme-surface, #fff);
  box-shadow: 0 1rem 3rem rgb(0 0 0 / 24%);
}
.md-editor-graphical-code-editor::backdrop { background: rgb(15 23 42 / 48%); }
.md-editor-graphical-code-editor h2 { margin: 0 0 1rem; font-size: 1.125rem; font-weight: 600; }
.md-editor-graphical-code-editor__surface { min-height: 20rem; max-height: 65dvh; overflow: auto; }
.md-editor-graphical-code-editor [role="status"] { min-height: 1.5em; color: var(--theme-muted, #475569); }
.md-editor-graphical-code-editor > button {
  margin: 0.75rem 0.5rem 0 0;
  padding: 0.5rem 0.875rem;
  border: 1px solid var(--theme-border, #cbd5e1);
  border-radius: 0.4rem;
  color: inherit;
  background: var(--theme-surface, #fff);
  cursor: pointer;
}
.md-editor-graphical-code-editor > button:focus-visible { outline: 2px solid var(--theme-accent, #2563eb); outline-offset: 2px; }
.md-editor-graphical-code-editor > button:disabled { opacity: 0.5; cursor: wait; }
`;
