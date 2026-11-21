/** Provider chrome stays outside the measured canvas so fitting never hides graph content. */
export const mermaidGraphicalEditorCss = `
.cm-md-mermaid-graphical-editor {
  display: flex; flex-direction: column; min-height: 18rem;
  border: 1px solid var(--theme-border, #d8dee4); border-radius: 8px; overflow: hidden;
  color: var(--theme-text, #24292f); background: var(--theme-surface, #fff);
  --mw-accent: var(--theme-primary, #0969da);
  --mw-chrome-bg: var(--theme-surface, #fff);
  --mw-chrome-fg: var(--theme-text, #24292f);
  --mw-chrome-border: var(--theme-border, #d8dee4);
  /*
   * Visimer 的弹层/菜单还会读 --mw-chrome-dim（次级文字）与 --mw-chrome-hover（悬停底色）。
   * 不声明时它们回退到深色默认值（#a1a1a1 / #1f1f1f），在浅色主题下就是
   * 「浅灰文字 + 深底深字」的低对比组合。
   */
  --mw-chrome-dim: var(--theme-muted, #57606a);
  --mw-chrome-hover: var(--theme-primary-soft, #f0f3f6);
  /* 行内标签编辑框的底色混合基准（深色主题下不能回退到白色）。 */
  --mw-editor-bg: var(--theme-surface, #fff);
}
.cm-md-mermaid-graphical-editor .mw-canvas { flex: 1; min-height: 10rem; }
.cm-md-mermaid-graphical-toolbar {
  flex: none; padding: 8px 12px; border-bottom: 1px solid var(--theme-border, #d8dee4);
}
.cm-md-mermaid-graphical-toolbar__actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.cm-md-mermaid-graphical-toolbar__hint { margin-inline-start: auto; font-size: 12px; color: var(--theme-muted, #57606a); }
.cm-md-mermaid-graphical-toolbar button {
  min-height: 32px; padding: 4px 8px; border: 1px solid transparent; border-radius: 6px;
  background: transparent; color: inherit; cursor: pointer; font: inherit; font-size: 13px;
}
.cm-md-mermaid-graphical-toolbar button:hover:not(:disabled) { background: var(--theme-primary-soft, #f0f3f6); }
.cm-md-mermaid-graphical-toolbar button[aria-pressed="true"] {
  background: var(--theme-primary-soft, #ddf4ff); color: var(--theme-primary, #0969da);
  border-color: currentColor;
}
.cm-md-mermaid-graphical-toolbar button:focus-visible {
  outline: 2px solid var(--theme-primary, #0969da); outline-offset: 2px;
}
.cm-md-mermaid-graphical-toolbar button:disabled { cursor: not-allowed; opacity: 0.5; }
.cm-md-mermaid-graphical-toolbar button[data-context] { border-inline-start-color: var(--theme-border, #d8dee4); }
.cm-md-mermaid-graphical-toolbar output { display: block; font-size: 12px; margin-top: 8px; }
.cm-md-mermaid-graphical-toolbar output:empty { display: none; }
.cm-md-mermaid-graphical-input {
  display: flex; flex-wrap: wrap; align-items: end; gap: 8px; margin-top: 8px;
  padding-top: 12px; border-top: 1px solid var(--theme-border, #d8dee4);
}
.cm-md-mermaid-graphical-input__field { display: grid; gap: 4px; flex: 1 1 140px; min-width: 0; }
.cm-md-mermaid-graphical-input label { font-size: 12px; }
.cm-md-mermaid-graphical-input input, .cm-md-mermaid-graphical-input select {
  box-sizing: border-box; width: 100%; min-height: 36px; min-width: 0; padding: 6px 8px;
  border: 1px solid var(--theme-border, #d8dee4); border-radius: 6px;
  background: var(--theme-surface, #fff); color: inherit; font: inherit; font-size: 13px;
}
.cm-md-mermaid-graphical-input input:focus-visible, .cm-md-mermaid-graphical-input select:focus-visible {
  outline: 2px solid var(--theme-primary, #0969da); outline-offset: 1px;
}
.cm-md-mermaid-graphical-input button { min-height: 36px; }
.cm-md-mermaid-graphical-input button:first-of-type { background: var(--theme-text, #24292f); color: var(--theme-surface, #fff); }
/* The provider exposes one context toolbar; upstream popovers duplicate its actions. */
.cm-md-mermaid-graphical-editor .mw-popover { display: none !important; }
.cm-md-mermaid-graphical-editor .mw-canvas [data-mw-entity]:hover { filter: none; }
/* Style the actual SVG geometry: an outline around an edge's bounds obscures nearby nodes. */
.cm-md-mermaid-graphical-editor .mw-canvas :is(.mw-selected, .mw-connect-source) { filter: none !important; }
.cm-md-mermaid-graphical-editor .mw-canvas :is(.mw-selected, .mw-connect-source):is([data-mw-entity^="node:"], [data-mw-entity^="participant:"]) :is(rect, circle, ellipse, polygon, path),
.cm-md-mermaid-graphical-editor .mw-canvas .mw-selected[data-mw-entity^="participant:"]:is(rect, circle, ellipse, polygon, path, line) {
  stroke: var(--mw-accent) !important; stroke-width: 3px !important;
  vector-effect: non-scaling-stroke;
}
.cm-md-mermaid-graphical-editor .mw-canvas .mw-selected:is(path, line, polyline):not([data-mw-hit-overlay]),
.cm-md-mermaid-graphical-editor .mw-canvas .mw-selected[data-mw-entity^="edge:"] path:not([data-mw-hit-overlay]) {
  stroke: var(--mw-accent) !important; stroke-width: 3px !important;
  vector-effect: non-scaling-stroke;
}
.cm-md-mermaid-graphical-editor .mw-canvas .mw-connect-source :is(rect, circle, ellipse, polygon, path) { stroke-dasharray: 4 3; }
.cm-md-mermaid-graphical-editor .mw-canvas .mw-ghost-edge { stroke: var(--mw-accent); stroke-width: 2px; filter: none; }
/* Connection handles: one dot per node edge, revealed only for a single selected node. */
.cm-md-mermaid-graphical-editor .mw-canvas .mw-connect-handles {
  position: absolute; inset: 0; pointer-events: none; z-index: 8;
}
.cm-md-mermaid-graphical-editor .mw-canvas .mw-connect-handle {
  position: absolute; width: 14px; height: 14px; padding: 0; margin: 0;
  transform: translate(-50%, -50%); border-radius: 50%; pointer-events: auto;
  border: 2px solid var(--mw-accent); background: var(--theme-surface, #fff);
  cursor: crosshair; touch-action: none;
}
.cm-md-mermaid-graphical-editor .mw-canvas .mw-connect-handle:hover,
.cm-md-mermaid-graphical-editor .mw-canvas .mw-connect-handle:focus-visible {
  background: var(--mw-accent); outline: 2px solid var(--mw-accent); outline-offset: 2px;
}
/* The dot sits on the border; growing the hit area keeps a 14px visual. */
.cm-md-mermaid-graphical-editor .mw-canvas .mw-connect-handle::after {
  content: ""; position: absolute; inset: -6px; border-radius: 50%;
}
.cm-md-mermaid-graphical-editor .mw-canvas .mw-connect-ghost {
  position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none;
  display: none; overflow: visible;
}
.cm-md-mermaid-graphical-editor .mw-canvas .mw-connect-ghost--active { display: block; }
.cm-md-mermaid-graphical-editor .mw-canvas .mw-connect-ghost line {
  stroke: var(--mw-accent); stroke-width: 2px; stroke-dasharray: 6 4;
}
/* While dragging, the dots must not intercept the drop target hit test. */
.cm-md-mermaid-graphical-editor .mw-canvas .mw-connect-handles--dragging .mw-connect-handle {
  pointer-events: none;
}
/* The node the ghost line is snapped to: same accent, no layout shift. */
.cm-md-mermaid-graphical-editor .mw-canvas .mw-connect-snap-target {
  filter: drop-shadow(0 0 4px var(--mw-accent)) !important;
}
.cm-md-mermaid-graphical-editor .mw-canvas .mw-connect-ghost--snapped line {
  stroke-dasharray: none; stroke-width: 2.5px;
}
/* Dashed placeholder shown while typing a new node's label. */
.cm-md-mermaid-graphical-editor .mw-canvas .mw-new-node {
  position: absolute; z-index: 9; transform: translate(-50%, -50%);
  min-width: 96px; padding: 8px 12px; border: 2px dashed var(--mw-accent);
  border-radius: 6px; background: var(--theme-surface, #fff);
  color: var(--theme-text, #24292f); font: inherit; font-size: 13px;
}
.cm-md-mermaid-graphical-editor .mw-canvas .mw-new-node__input {
  min-width: 72px; outline: none; white-space: pre; text-align: center;
  caret-color: var(--mw-accent);
}
.cm-md-mermaid-graphical-editor .mw-canvas .mw-new-node__input:empty::before {
  content: attr(data-placeholder); color: var(--theme-muted, #57606a);
}
/*
 * Visimer 的浮层/菜单按钮没有自带焦点样式。图形编辑弹窗里的控件必须键盘可达，
 * 这里补一个与工具栏一致的焦点环（菜单项、加号按钮、主工具栏按钮都覆盖）。
 */
.cm-md-mermaid-graphical-editor :is(.mw-popover-btn, .mw-popover-cell, .mw-plus-menu button, .mw-lifeline-plus):focus-visible {
  outline: 2px solid var(--theme-primary, #0969da); outline-offset: 2px;
}
@media (max-width: 600px) {
  .cm-md-mermaid-graphical-toolbar { padding: 8px; }
  .cm-md-mermaid-graphical-toolbar__actions { gap: 4px; }
  .cm-md-mermaid-graphical-toolbar__hint { display: none; }
}
`;
