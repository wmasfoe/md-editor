/**
 * @file core-css.ts
 * @description 编辑器基础排版、选区、光标与行内投影（渲染器自持样式片段，由 `index.ts` 汇总注入）。
 *
 * 选择器带 `.cm-md-editor.cm-editor` scope 前缀（该 class 由渲染器经
 * `EditorView.editorAttributes` 挂到 `.cm-editor` 上），特异性 (0,2,0) 与
 * CodeMirror 自带 `baseTheme` 的 `.<id> .cm-*` 平级，靠注入顺序取胜。
 * 所有 `var(--theme-*)` 均带 fallback。
 */

export const coreEditorCss = String.raw`
.cm-md-editor.cm-editor {
  height: 100%;
  background: transparent;
  /* 窄窗口侧栏折叠时,编辑器必须位于左侧唤起热区之上才能命中 toolbar;
     侧栏打开时遮罩 z-index 29 / aside z-index 30 仍会覆盖编辑器。 */
  z-index: 16;
}
.cm-md-editor.cm-editor .cm-scroller {
  overflow: auto;
  background: transparent;
  /* 文末留白仍属于编辑画布，应保持文本输入指针。 */
  cursor: text;
  font-family: var(
    --theme-font,
    -apple-system,
    BlinkMacSystemFont,
    "PingFang SC",
    system-ui,
    sans-serif
  );
  line-height: var(--theme-editor-line-height, 1.62);
  letter-spacing: var(--theme-letter-spacing, 0);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility;
}
.cm-md-editor.cm-editor .cm-content {
  box-sizing: border-box;
  width: 100%;
  min-height: 100%;
  /* 右侧保持内容居中公式;左侧单独预留行首 toolbar gutter。
      toolbar 自身统一槽位,正文起点不随块类型改变;负边距锚点仍保持在安全区。 */
  padding: 3.25rem max(1.25rem, calc((100% - var(--theme-content-width, 860px)) / 2)) 30vh;
  padding-left: max(5.5rem, calc((100% - var(--theme-content-width, 860px)) / 2));
  caret-color: var(--theme-text, currentColor);
  cursor: text;
}
.cm-md-editor.cm-editor .cm-line {
  padding-inline: 0;
  /* 换行兜底:CM 的 white-space: break-spaces 在部分 WebKit 版本
     (Tauri macOS)不受支持时会退化,连续中文(无空格)因此不断行、
     右侧溢出被裁;pre-wrap + overflow-wrap 兜底保证任意字符处可断行 */
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: break-word;
  line-height: var(--theme-editor-line-height, 1.62);
}
.cm-md-editor.cm-editor .cm-focused {
  outline: none;
}
/* CodeMirror 自绘选区背景（支持代码块文本列垂直对齐）与光标 */
.cm-md-editor.cm-editor .cm-selectionLayer, .cm-md-editor.cm-editor .cm-md-selectionLayer {
  width: 100%;
  /* 提升选区层至内容层（.cm-content）之上，避免被代码块等带有不透明背景的块级行（.cm-md-code-line）遮挡 */
  z-index: 1 !important;
  /* 确保选区层绝不拦截任何鼠标与指针交互事件，点击与划选事件无损透传至内容层 */
  pointer-events: none !important;
  /* 严格约束选区背景的水平范围与正文内容对齐，杜绝跨行选区向左击穿至 Gutter 或向右溢出 */
  clip-path: polygon(
    max(5.5rem, calc((100% - var(--theme-content-width, 860px)) / 2)) -99999px,
    calc(100% - max(1.25rem, calc((100% - var(--theme-content-width, 860px)) / 2))) -99999px,
    calc(100% - max(1.25rem, calc((100% - var(--theme-content-width, 860px)) / 2))) 999999px,
    max(5.5rem, calc((100% - var(--theme-content-width, 860px)) / 2)) 999999px
  );
}
/* 选区色不标 important，宿主的 important 规则可以覆盖。
   未聚焦 (0,3,0) 高于 CM6 baseTheme 的 (0,2,0)。
   聚焦时 CM6 是 (0,5,0)，下一条 (0,6,0) 盖过它。 */
.cm-md-editor.cm-editor .cm-selectionBackground,
.cm-md-editor.cm-editor.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground {
  background: var(--theme-primary-selected, rgba(9, 105, 218, 0.24));
}
.cm-md-editor.cm-editor .cm-cursor {
  border-left-color: var(--theme-text, currentColor);
}


@media (max-width: 760px) {.cm-md-editor.cm-editor .cm-content {
    padding-top: 2rem;
    padding-bottom: 24vh;
  }

}
.cm-md-editor.cm-editor.cm-md-editor--source .cm-scroller {
  font-family: var(
    --theme-mono-font,
    ui-monospace,
    SFMono-Regular,
    Menlo,
    Monaco,
    Consolas,
    monospace
  );
  line-height: var(--theme-source-line-height, 1.66);
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-marker, .cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-marker--heading-atx, .cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-heading-prefix-visible {
  color: var(--theme-marker-dim, var(--theme-control-text, #57606a)) !important;
  font-family: var(
    --theme-mono-font,
    ui-monospace,
    SFMono-Regular,
    Menlo,
    Monaco,
    Consolas,
    monospace
  ) !important;
  font-size: 0.88em !important;
  font-style: normal;
  font-weight: 550 !important;
  opacity: 0.75;
  text-decoration: none;
  vertical-align: 0.04em;
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-bold, .cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-bold * {
  color: var(--theme-title, var(--theme-strong-accent, #111827)) !important;
  font-weight: var(--theme-bold-font-weight, 700) !important;
  -webkit-font-smoothing: antialiased;
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-italic {
  color: var(--theme-em-accent, currentColor);
  font-style: italic;
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-strikethrough {
  color: var(--theme-del-accent, currentColor);
  text-decoration: line-through;
  text-decoration-thickness: 1px;
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-highlight {
  background-color: var(--theme-highlight-bg, rgba(253, 224, 71, 0.38));
  color: var(--theme-highlight-text, inherit);
  border-radius: 3px;
  padding: 0.08em 0.2em;
}
:root.dark .cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-highlight, .dark .cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-highlight {
  background-color: var(--theme-highlight-bg, rgba(234, 179, 8, 0.28));
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-inline-code {
  border-radius: 3px;
  background: var(--theme-inline-code-bg, transparent);
  color: var(--theme-code-accent, currentColor);
  font-family: var(
    --theme-mono-font,
    ui-monospace,
    SFMono-Regular,
    Menlo,
    Monaco,
    Consolas,
    monospace
  );
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-heading {
  font-family: var(--theme-heading-font, var(--theme-font, inherit));
  color: var(--theme-title, #111827);
  -webkit-font-smoothing: antialiased;
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-heading--level-1 {
  font-size: 1.65em;
  line-height: 1.32;
  font-weight: var(--theme-heading-font-weight, 750);
  letter-spacing: -0.016em;
  background: var(
    --theme-heading-divider,
    linear-gradient(
        var(--theme-border, rgba(0, 0, 0, 0.08)),
        var(--theme-border, rgba(0, 0, 0, 0.08))
      )
      bottom 0.4rem left 0 / 100% 1px no-repeat
  );
  padding-top: 0.7em;
  padding-bottom: 0.7rem;
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-heading--level-2 {
  font-size: 1.42em;
  line-height: 1.35;
  font-weight: var(--theme-heading-font-weight, 700);
  letter-spacing: -0.012em;
  padding-top: 0.6em;
  padding-bottom: 0.57rem;
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-heading--level-3 {
  font-size: 1.25em;
  line-height: 1.4;
  font-weight: var(--theme-heading-font-weight, 680);
  letter-spacing: -0.008em;
  padding-top: 0.5em;
  padding-bottom: 0.48rem;
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-heading--level-4 {
  font-size: 1.12em;
  line-height: 1.45;
  font-weight: var(--theme-heading-font-weight, 650);
  padding-top: 0.4em;
  padding-bottom: 0.34rem;
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-heading--level-5 {
  font-size: 1.02em;
  line-height: 1.5;
  font-weight: var(--theme-heading-font-weight, 600);
  padding-top: 0.35em;
  padding-bottom: 0.28rem;
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-heading--level-6 {
  font-size: 0.95em;
  line-height: 1.55;
  font-weight: var(--theme-heading-font-weight, 600);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--theme-muted, #656d76);
  padding-top: 0.3em;
  padding-bottom: 0.23rem;
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-heading--source-only {
  text-decoration-color: var(--theme-heading-accent, currentColor);
  text-decoration-line: underline;
  text-decoration-thickness: 1px;
  text-underline-offset: 0.2em;
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-block-line--quote {
  border-left: var(
    --theme-blockquote-border,
    3px solid var(--theme-primary, var(--theme-border, currentColor))
  );
  padding-left: 0.85rem;
  background: var(--theme-blockquote-bg, var(--theme-primary-soft, transparent));
  border-radius: 0 var(--theme-radius-base, 4px) var(--theme-radius-base, 4px) 0;
  color: var(--theme-blockquote-text, var(--theme-muted, currentColor));
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-block-marker {
  display: inline-flex;
  box-sizing: border-box;
  min-width: 1.25em;
  height: 1em;
  align-items: center;
  justify-content: flex-start;
  color: var(--theme-list-marker, var(--theme-muted, currentColor));
  font-family: var(
    --theme-mono-font,
    ui-monospace,
    SFMono-Regular,
    Menlo,
    Monaco,
    Consolas,
    monospace
  );
  font-size: 0.9em;
  font-variant-numeric: tabular-nums;
  line-height: 1;
  vertical-align: baseline;
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-block-marker--quote {
  display: none;
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-block-marker--list-item-ordered {
  min-width: 2em;
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-task-checkbox {
  display: inline-flex;
  box-sizing: border-box;
  width: 0.95em;
  height: 0.95em;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--theme-checkbox-border, var(--theme-border, currentColor));
  border-radius: 3px;
  margin-right: 0.35em;
  background: var(--theme-checkbox-bg, transparent);
  color: var(--theme-checkbox-check, var(--theme-primary, currentColor));
  cursor: pointer;
  line-height: 1;
  vertical-align: -0.08em;
  transition:
    background var(--cm-transition-fast, 120ms cubic-bezier(0.22, 1, 0.36, 1)),
    border-color var(--cm-transition-fast, 120ms cubic-bezier(0.22, 1, 0.36, 1)),
    transform var(--cm-transition-fast, 120ms cubic-bezier(0.22, 1, 0.36, 1));
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-task-checkbox:hover {
  border-color: var(--theme-primary, currentColor);
  background: var(--theme-primary-soft, rgba(110, 31, 44, 0.08));
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-task-checkbox:active {
  transform: scale(0.92);
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-task-checkbox--checked {
  background: var(--theme-primary-fill, var(--theme-primary, #6e1f2c));
  border-color: var(--theme-primary, #6e1f2c);
  color: var(--theme-bg, #ffffff);
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-task-checkbox--checked::after {
  content: "\2713";
  font-size: 0.78em;
  font-weight: 700;
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-link-label {
  color: var(--theme-link, var(--theme-accent, currentColor));
  text-decoration: underline;
  text-decoration-thickness: 1px;
  text-underline-offset: 0.14em;
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-image-widget {
  position: relative;
  display: inline-flex;
  box-sizing: border-box;
  width: fit-content;
  max-width: 100%;
  min-width: min(12rem, 100%);
  min-height: 4rem;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border: 1px solid var(--theme-border, currentColor);
  border-radius: 6px;
  margin: 0.2em 0;
  background: var(--theme-bg-muted, var(--theme-surface, transparent));
  cursor: pointer;
  vertical-align: middle;
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-image-widget--active {
  display: flex;
  margin-top: 0.7rem;
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-image-widget--selected {
  border-color: var(--theme-primary, currentColor);
  outline: 2px solid var(--theme-primary-soft, var(--theme-primary, currentColor));
  outline-offset: 2px;
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-image-widget__image {
  display: block;
  width: auto;
  max-width: 100%;
  height: auto;
  max-height: 22rem;
  object-fit: contain;
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-image-widget__placeholder {
  display: flex;
  box-sizing: border-box;
  width: 100%;
  max-width: 100%;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.15rem 0.5rem;
  padding: 0.2rem 0;
  overflow: hidden;
  color: var(--theme-muted, currentColor);
  font-size: 0.84em;
  line-height: 1.45;
  overflow-wrap: anywhere;
  text-align: left;
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-image-widget__placeholder[hidden] {
  display: none;
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-image-widget__placeholder-title {
  color: var(--theme-muted, currentColor);
  font-family: var(--theme-ui-font, var(--theme-font, system-ui, sans-serif));
  font-size: 0.86rem;
  font-weight: 500;
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-image-widget__placeholder-title::after {
  content: "\00b7";
  margin-left: 0.5rem;
}
/* 放大查看器按钮(图片右上角,hover 显示) */
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-image-widget__viewer {
  position: absolute;
  top: 0.3rem;
  right: 0.3rem;
  border: 0;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.45);
  color: #fff;
  cursor: pointer;
  font-size: 0.9rem;
  line-height: 1;
  padding: 0.3rem 0.45rem;
  opacity: 0;
  pointer-events: none;
  transition:
    opacity var(--cm-transition-fast, 120ms cubic-bezier(0.22, 1, 0.36, 1)),
    background var(--cm-transition-fast, 120ms cubic-bezier(0.22, 1, 0.36, 1));
  z-index: 2;
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-image-widget:hover .cm-md-image-widget__viewer {
  opacity: 1;
  pointer-events: auto;
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-image-widget__viewer:hover {
  background: rgba(0, 0, 0, 0.65);
}
/* 图片源码编辑行(选中时显示在图片下方) */
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-image-widget__source-row {
  display: block;
  width: 100%;
  box-sizing: border-box;
  padding: 0.3rem 0.4rem;
  border-top: 1px solid var(--theme-border, currentColor);
  background: var(--theme-surface, transparent);
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-image-widget__source-row[hidden] {
  display: none;
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-image-widget__source {
  display: block;
  width: 100%;
  box-sizing: border-box;
  border: 1px solid var(--theme-border, currentColor);
  border-radius: 4px;
  background: var(--theme-bg, #fff);
  color: var(--theme-text, currentColor);
  font-family: var(--theme-mono-font, ui-monospace, monospace);
  font-size: 0.82em;
  line-height: 1.4;
  padding: 0.25rem 0.4rem;
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-image-widget--source-invalid .cm-md-image-widget__source {
  border-color: #d33;
}
/* 放大查看器浮层样式已迁出：
   原 \`.cm-md-image-viewer*\` 规则挂在 React 宿主 div 上，
   而浮层是 \`document.body\` 的子节点 ⇒ 规则永不匹配（浮层长期“全裸”，见 PR 的 fix commit）。
   现由 \`@md-editor/editor\` 的 \`media-viewer/styles.ts\` 自持注入
   （无祖先前缀 \`.cm-md-media-viewer*\`）。改动此块前请先读
   docs/agent/architecture/markdown_syntax_plugin_architecture.md。 */
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-image-widget__placeholder-alt {
  display: block;
  max-width: 100%;
  align-self: center;
  overflow: hidden;
  color: var(--theme-text, currentColor);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-image-widget__placeholder-source {
  display: block;
  flex-basis: 100%;
  width: 100%;
  margin-top: 0;
  padding-top: 0;
  overflow: hidden;
  color: var(--theme-control-subtle, var(--theme-muted, currentColor));
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
  font-weight: 400;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-image-widget--failed {
  width: 100%;
  min-width: 0;
  justify-content: flex-start;
  border: 0;
  border-radius: 0;
  background: transparent;
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-image-widget--failed.cm-md-image-widget--selected {
  outline: 0;
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-image-widget--failed.cm-md-image-widget--selected .cm-md-image-widget__placeholder {
  padding-left: 0.65rem;
  border-left: 2px solid var(--theme-primary, currentColor);
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-thematic-break-widget {
  display: flex;
  align-items: center;
  /* 不用 border-box：统一间距由核心层（block-replacement.ts）以 **padding** 交付，
     而 padding 必须计进 border-box 才算入 CM6 高度图。若在此声明 border-box，
     1.85rem 会把那 2×8px padding 吃回去（间距消失），且高度图依旧漏算 ⇒ 点击偏行。 */
  box-sizing: content-box;
  width: 100%;
  /* 这里只是"符号本体"（那根线）的高度，不含统一间距。 */
  height: 1.85rem;
  /* 垂直间距不在本 widget 声明：分割线属于"符号型块"（data-md-block-category="symbol"），
     由 renderer 核心层 block-replacement.ts 统一提供（--theme-block-symbol-gap）。
     在此写间距会覆盖统一规则，导致逐 widget 硬编码。 */
  cursor: pointer;
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-thematic-break-widget::before {
  content: "";
  display: block;
  width: 100%;
  border-top: 1px solid var(--theme-border, currentColor);
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-thematic-break-widget--selected {
  outline: 2px solid var(--theme-focus-ring, var(--theme-accent, currentColor));
  outline-offset: -2px;
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-table-widget {
  box-sizing: border-box;
  position: relative;
  width: fit-content;
  max-width: 100%;
  margin: 0;
  border: 1px solid var(--theme-border, currentColor) !important;
  border-radius: 6px;
  cursor: default;
}
.cm-md-editor.cm-editor.cm-md-editor--wysiwyg .cm-md-table-widget--selected {
  border-color: var(--theme-primary, currentColor) !important;
  outline: 2px solid var(--theme-primary-soft, var(--theme-primary, currentColor));
  outline-offset: 2px;
}
`;
