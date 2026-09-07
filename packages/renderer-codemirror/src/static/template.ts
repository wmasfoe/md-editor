import { renderStaticHtml, type StaticRenderOptions } from "./render.ts";

export interface StaticDocumentOptions extends StaticRenderOptions {
  /** Optional custom CSS string to inject into the document */
  customCss?: string;
}

/**
 * Standard CSS rules aligning with Inkpoint design tokens and typography
 */
export const STATIC_DOCUMENT_BASE_CSS = `
:root {
  color-scheme: light;
  --theme-bg: #ffffff;
  --theme-surface: #ffffff;
  --theme-text: #24292f;
  --theme-title: #1f2328;
  --theme-muted: #57606a;
  --theme-border: #d8dee4;
  --theme-border-subtle: rgba(27, 31, 36, 0.08);
  --theme-primary: #0969da;
  --theme-heading-accent: #0969da;
  --theme-strong-accent: #1f2328;
  --theme-em-accent: #0550ae;
  --theme-del-accent: #cf222e;
  --theme-code-accent: #116329;
  --theme-marker-dim: #8c959f;
  --theme-code-bg: #f6f8fa;
  --theme-inline-code-bg: rgba(175, 184, 193, 0.2);
  --theme-quote-bg: rgba(9, 105, 218, 0.05);
  --theme-quote-border: #0969da;
  --theme-table-header: rgba(0, 0, 0, 0.03);
  --theme-table-stripe: rgba(0, 0, 0, 0.015);
  --theme-accent: #0969da;
  --theme-font: -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "PingFang SC", "Hiragino Sans GB", "Segoe UI", Roboto, sans-serif;
  --theme-mono-font: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, monospace;
}

@media (prefers-color-scheme: dark) {
  :root {
    color-scheme: dark;
    --theme-bg: #1c1b1a;
    --theme-surface: #222120;
    --theme-text: #e6edf3;
    --theme-title: #f0f6fc;
    --theme-muted: #8b949e;
    --theme-border: rgba(240, 246, 252, 0.14);
    --theme-border-subtle: rgba(240, 246, 252, 0.08);
    --theme-primary: #2f81f7;
    --theme-heading-accent: #2f81f7;
    --theme-strong-accent: #f0f6fc;
    --theme-em-accent: #79c0ff;
    --theme-del-accent: #ff7b72;
    --theme-code-accent: #7ee787;
    --theme-marker-dim: #6e7681;
    --theme-code-bg: #161b22;
    --theme-inline-code-bg: rgba(110, 118, 129, 0.3);
    --theme-quote-bg: rgba(47, 129, 247, 0.08);
    --theme-quote-border: #2f81f7;
    --theme-table-header: rgba(255, 255, 255, 0.06);
    --theme-table-stripe: rgba(255, 255, 255, 0.03);
    --theme-accent: #2f81f7;
  }
}

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  background-color: var(--theme-bg);
  color: var(--theme-text);
  font-family: var(--theme-font);
  font-size: 14.5px;
  line-height: 1.68;
  letter-spacing: -0.01em;
  padding: 32px 36px 48px;
  max-width: 860px;
  margin: 0 auto;
  word-wrap: break-word;
  -webkit-font-smoothing: antialiased;
}

/* Headings */
h1, h2, h3, h4, h5, h6 {
  color: var(--theme-title, var(--theme-text));
  font-weight: 700;
  line-height: 1.35;
  margin-top: 1.5em;
  margin-bottom: 0.6em;
  letter-spacing: -0.015em;
  -webkit-font-smoothing: antialiased;
}
h1:first-child, h2:first-child { margin-top: 0; }
h1 {
  font-size: 1.65em;
  line-height: 1.32;
  font-weight: 750;
  letter-spacing: -0.016em;
  border-bottom: 1px solid var(--theme-border);
  padding-bottom: 0.4em;
}
h2 {
  font-size: 1.42em;
  line-height: 1.35;
  font-weight: 700;
  letter-spacing: -0.012em;
  border-bottom: 1px solid var(--theme-border-subtle);
  padding-bottom: 0.3em;
}
h3 { font-size: 1.25em; font-weight: 680; }
h4 { font-size: 1.12em; font-weight: 650; }
h5 { font-size: 1.02em; font-weight: 600; }
h6 { font-size: 0.95em; color: var(--theme-muted); }

/* Inkpoint Inline Syntax Markers */
.cm-md-marker {
  color: var(--theme-marker-dim, #8c959f) !important;
  font-family: var(--theme-mono-font) !important;
  font-size: 0.88em !important;
  font-style: normal;
  font-weight: 550 !important;
  opacity: 0.65;
  text-decoration: none;
  vertical-align: 0.04em;
  user-select: none;
}

.cm-md-bold {
  color: var(--theme-title, var(--theme-strong-accent, inherit)) !important;
  font-weight: 700 !important;
  -webkit-font-smoothing: antialiased;
}

.cm-md-italic {
  color: var(--theme-em-accent, inherit);
  font-style: italic;
}

.cm-md-strikethrough {
  color: var(--theme-del-accent, var(--theme-muted));
  text-decoration: line-through;
  text-decoration-thickness: 1px;
}

.cm-md-highlight {
  background: var(--theme-highlight-bg, rgba(253, 224, 71, 0.38));
  color: var(--theme-highlight-text, inherit);
  border-radius: 3px;
  padding: 0.08em 0.2em;
}

.cm-md-inline-code {
  border-radius: 4px;
  background: var(--theme-inline-code-bg, var(--theme-code-bg));
  color: var(--theme-code-accent, var(--theme-text));
  font-family: var(--theme-mono-font) !important;
  font-size: 0.88em;
  padding: 0.12em 0.35em;
  border: 1px solid var(--theme-border-subtle);
}

/* Inline Elements */
p { margin-bottom: 1em; }
a { color: var(--theme-accent); text-decoration: none; }
a:hover { text-decoration: underline; }

/* Code & Syntax */
code {
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, monospace;
  font-size: 0.9em;
  background-color: var(--theme-code-bg);
  padding: 0.18em 0.42em;
  border-radius: 5px;
  border: 1px solid var(--theme-border-subtle);
}
pre { margin: 1.2em 0; }
pre code {
  display: block;
  padding: 14px 18px;
  font-size: 13px;
  line-height: 1.55;
  background-color: transparent;
  border: none;
  overflow-x: auto;
}

/* Lists */
ul, ol { margin-top: 0.5em; margin-bottom: 1em; padding-left: 1.7em; }
li { margin-bottom: 0.35em; }
li.task-list-item { list-style-type: none; margin-left: -1.4em; }
input[type="checkbox"] {
  margin-right: 0.5em;
  accent-color: var(--theme-accent);
  vertical-align: middle;
}

/* Blockquotes */
blockquote {
  margin: 1.2em 0;
  padding: 0.8em 1.2em;
  background-color: var(--theme-quote-bg);
  border-left: 3.5px solid var(--theme-quote-border);
  border-radius: 0 6px 6px 0;
}
blockquote > p:last-child { margin-bottom: 0; }

/* Callout / Alerts */
.cm-callout {
  margin: 1.2em 0;
  border-radius: 8px;
  border: 1px solid var(--theme-border);
  padding: 12px 16px;
  background-color: var(--theme-code-bg);
}
.cm-callout__header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13.5px;
  font-weight: 600;
  margin-bottom: 6px;
}
.cm-callout__icon {
  display: inline-flex;
  align-items: center;
}
.cm-callout--note { border-left: 4px solid #0071e3; background: rgba(0, 113, 227, 0.05); color: #0071e3; }
.cm-callout--tip { border-left: 4px solid #34c759; background: rgba(52, 199, 89, 0.05); color: #248a3d; }
.cm-callout--important { border-left: 4px solid #af52de; background: rgba(175, 82, 222, 0.05); color: #8944ab; }
.cm-callout--warning { border-left: 4px solid #ff9500; background: rgba(255, 149, 0, 0.05); color: #c97500; }
.cm-callout--danger, .cm-callout--caution { border-left: 4px solid #ff3b30; background: rgba(255, 59, 48, 0.05); color: #d70015; }
.cm-callout__body {
  color: var(--theme-text);
  font-size: 13.5px;
  line-height: 1.55;
}
.cm-callout__body p:last-child { margin-bottom: 0; }

/* Tables */
table {
  border-collapse: collapse;
  width: 100%;
  margin: 1.3em 0;
  font-size: 13.5px;
  border-radius: 7px;
  overflow: hidden;
  border: 1px solid var(--theme-border);
}
th, td { border: 1px solid var(--theme-border); padding: 9px 13px; text-align: left; }
th { background-color: var(--theme-table-header); font-weight: 650; }
tr:nth-child(even) td { background-color: var(--theme-table-stripe); }

/* Images & Divider */
hr { border: none; border-top: 1px solid var(--theme-border); margin: 2em 0; }
img { max-width: 100%; height: auto; border-radius: 6px; border: 1px solid var(--theme-border-subtle); margin: 1em 0; }

/* Highlight.js Syntax Theme */
pre code.hljs { background: #f6f8fa; color: #24292f; border: 1px solid rgba(27, 31, 36, 0.08); border-radius: 8px; }
.hljs-comment, .hljs-punctuation { color: #6e7781; font-style: italic; }
.hljs-tag, .hljs-subst { color: #24292f; }
.hljs-keyword, .hljs-selector-tag { color: #cf222e; font-weight: 600; }
.hljs-string, .hljs-number, .hljs-type { color: #0a3069; }
.hljs-title, .hljs-title.function_ { color: #8250df; font-weight: 600; }
.hljs-variable { color: #953800; }

@media (prefers-color-scheme: dark) {
  pre code.hljs { background: #161b22; color: #c9d1d9; border: 1px solid rgba(240, 246, 252, 0.1); }
  .hljs-comment, .hljs-punctuation { color: #8b949e; }
  .hljs-tag, .hljs-subst { color: #c9d1d9; }
  .hljs-keyword, .hljs-selector-tag { color: #ff7b72; }
  .hljs-string, .hljs-number, .hljs-type { color: #a5d6ff; }
  .hljs-title, .hljs-title.function_ { color: #d2a8ff; }
  .hljs-variable { color: #ffa657; }
}
`;

/**
 * Escapes unsafe characters for HTML titles
 */
function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Renders Markdown into a standalone, complete HTML document suitable for Quick Look,
 * HTML Export, Print, or Headless PDF/Image generation.
 */
export function renderStaticDocument(
  markdown: string,
  options: StaticDocumentOptions = {},
): string {
  const result = renderStaticHtml(markdown, options);
  const title = escapeHtml(result.title);
  const extraCss = options.customCss ?? "";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="color-scheme" content="light dark" />
    <title>${title}</title>
    <style>
${STATIC_DOCUMENT_BASE_CSS}
${extraCss}
    </style>
  </head>
  <body>
    <div id="content">
${result.html}
    </div>
  </body>
</html>`;
}
