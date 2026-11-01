/**
 * @fileoverview Tw93 Kami 设计系统内置主题 (Kami Light 纸 / Kami Dark 墨)
 *
 * 核心设计哲学：好内容，值得好版面。暖米纸底，单油墨蓝点缀，纯字号衬线排版，严禁冷蓝灰与合成粗体。
 * 参考规范：https://kami.tw93.fun 与 https://github.com/tw93/kami
 */

export const KAMI_LIGHT_THEME_CSS = `
:root {
  color-scheme: light;
  --theme-bg: #f5f4ed;
  --theme-bg-muted: #e8e6dc;
  --theme-chrome: #efede7;
  --theme-surface: #f5f4ed;
  --theme-chrome-soft: var(--theme-surface);
  --theme-text: #504e49;
  --theme-title: #141413;
  --theme-muted: #6b6a64;
  --theme-control-text: #3d3d3a;
  --theme-control-subtle: #6b6a64;
  --theme-disabled: #8a8982;
  --theme-border: #e8e6dc;
  --theme-border-strong: #d8d5c8;
  --theme-primary: #1B365D;
  --theme-primary-fill: var(--theme-primary);
  --theme-primary-soft: rgba(27, 54, 93, 0.08);
  --theme-primary-selected: rgba(27, 54, 93, 0.22);
  --theme-control-hover: #e8e6dc;
  --theme-control-active: #dcd9cd;
  --theme-danger-bg: rgba(181, 51, 51, 0.1);
  --theme-danger-text: #b53333;
  --theme-code: #141413;
  --theme-code-bg: #faf9f5;
  --theme-code-border: #e8e6dc;
  --theme-code-gutter-bg: #f5f4ed;
  --theme-code-gutter-text: #6b6a64;
  --theme-code-keyword: #1B365D;
  --theme-code-string: #504e49;
  --theme-code-comment: #6b6a64;
  --theme-code-number: #1B365D;
  --theme-code-tag: #1B365D;
  --theme-code-attribute: #3d3d3a;
  --theme-code-variable: #141413;
  --theme-inline-code-bg: #f0eee6;
  --theme-shadow: 0 1px 1px rgba(20, 19, 19, 0.04), 0 8px 24px rgba(20, 19, 19, 0.08);
  --theme-heading-accent: #1B365D;
  --theme-strong-accent: #141413;
  --theme-em-accent: #504e49;
  --theme-del-accent: #b53333;
  --theme-code-accent: #1B365D;
  --theme-marker-dim: #6b6a64;
  --theme-mark: rgba(27, 54, 93, 0.22);
  --theme-content-width: 820px;
  --theme-editor-font-size: 16px;
  --theme-editor-line-height: 1.58;
  --theme-editor-line-height-em: 1.58em;
  --theme-editor-paragraph-spacing: 1.0em;
  --theme-editor-heading-line-height: 1.25;
  --theme-source-line-height: 1.62;
  --theme-letter-spacing: 0.02em;
  --theme-body-font-weight: 400;
  --theme-heading-font-weight: 500;
  --theme-bold-font-weight: 500;
  --theme-heading-divider: none;
  --theme-blockquote-border: none;
  --theme-blockquote-bg: transparent;
  --theme-ui-font:
    Charter, Georgia, -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB",
    "Source Han Sans SC", "Microsoft YaHei UI", sans-serif;
  --theme-font:
    Charter, Georgia, "TsangerJinKai02", "Source Han Serif SC", "Noto Serif CJK SC", "Songti SC",
    "STSong", Palatino, serif;
  --theme-mono-font:
    "JetBrains Mono", "SF Mono", "Fira Code", Consolas, Monaco, "TsangerJinKai02",
    "Source Han Serif SC", monospace;
  --cm-transition-fast: 120ms cubic-bezier(0.22, 1, 0.36, 1);
  --cm-transition-base: 200ms cubic-bezier(0.22, 1, 0.36, 1);
  --cm-transition-enter: 280ms cubic-bezier(0.22, 1, 0.36, 1);
}
`;

export const KAMI_DARK_THEME_CSS = `
:root {
  color-scheme: dark;
  --theme-bg: #141413;
  --theme-bg-muted: #1d1d1b;
  --theme-chrome: #1d1d1b;
  --theme-surface: #141413;
  --theme-chrome-soft: var(--theme-surface);
  --theme-text: #d8d5c8;
  --theme-title: #f5f4ed;
  --theme-muted: #a3a096;
  --theme-control-text: #c2beb2;
  --theme-control-subtle: #7a7870;
  --theme-disabled: #5c5a53;
  --theme-border: #2a2a27;
  --theme-border-strong: #3d3d38;
  --theme-primary: #2D5A8A;
  --theme-primary-fill: var(--theme-primary);
  --theme-primary-soft: rgba(45, 90, 138, 0.18);
  --theme-primary-selected: rgba(45, 90, 138, 0.32);
  --theme-control-hover: #262623;
  --theme-control-active: #30302c;
  --theme-danger-bg: rgba(230, 80, 80, 0.15);
  --theme-danger-text: #e65050;
  --theme-code: #f5f4ed;
  --theme-code-bg: #1d1d1b;
  --theme-code-border: #2a2a27;
  --theme-code-gutter-bg: #141413;
  --theme-code-gutter-text: #7a7870;
  --theme-code-keyword: #5a8ec6;
  --theme-code-string: #c2beb2;
  --theme-code-comment: #7a7870;
  --theme-code-number: #5a8ec6;
  --theme-code-tag: #5a8ec6;
  --theme-code-attribute: #a3a096;
  --theme-code-variable: #f5f4ed;
  --theme-inline-code-bg: #22221f;
  --theme-shadow: 0 1px 1px rgba(0, 0, 0, 0.4), 0 8px 24px rgba(0, 0, 0, 0.3);
  --theme-heading-accent: #2D5A8A;
  --theme-strong-accent: #f5f4ed;
  --theme-em-accent: #d8d5c8;
  --theme-del-accent: #e65050;
  --theme-code-accent: #5a8ec6;
  --theme-marker-dim: #7a7870;
  --theme-mark: rgba(45, 90, 138, 0.35);
  --theme-content-width: 820px;
  --theme-editor-font-size: 16px;
  --theme-editor-line-height: 1.58;
  --theme-editor-line-height-em: 1.58em;
  --theme-editor-paragraph-spacing: 1.0em;
  --theme-editor-heading-line-height: 1.25;
  --theme-source-line-height: 1.62;
  --theme-letter-spacing: 0.02em;
  --theme-body-font-weight: 400;
  --theme-heading-font-weight: 500;
  --theme-bold-font-weight: 500;
  --theme-heading-divider: none;
  --theme-blockquote-border: none;
  --theme-blockquote-bg: transparent;
  --theme-ui-font:
    Charter, Georgia, -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB",
    "Source Han Sans SC", "Microsoft YaHei UI", sans-serif;
  --theme-font:
    Charter, Georgia, "TsangerJinKai02", "Source Han Serif SC", "Noto Serif CJK SC", "Songti SC",
    "STSong", Palatino, serif;
  --theme-mono-font:
    "JetBrains Mono", "SF Mono", "Fira Code", Consolas, Monaco, "TsangerJinKai02",
    "Source Han Serif SC", monospace;
  --cm-transition-fast: 120ms cubic-bezier(0.22, 1, 0.36, 1);
  --cm-transition-base: 200ms cubic-bezier(0.22, 1, 0.36, 1);
  --cm-transition-enter: 280ms cubic-bezier(0.22, 1, 0.36, 1);
}
`;
