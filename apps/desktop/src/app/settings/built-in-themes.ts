import type { BuiltInThemeId } from "./app-settings";

export interface BuiltInThemeOption {
  readonly id: BuiltInThemeId;
  readonly label: string;
}

export const BUILT_IN_LIGHT_THEME_OPTIONS: readonly BuiltInThemeOption[] = [
  { id: "paper-light", label: "宣纸" },
  { id: "github-light", label: "GitHub" },
  { id: "gothic-light", label: "Gothic" },
];

export const BUILT_IN_DARK_THEME_OPTIONS: readonly BuiltInThemeOption[] = [
  { id: "charcoal-dark", label: "炭焙" },
  { id: "night-dark", label: "Night" },
];

export function builtInThemeCss(themeId: BuiltInThemeId): string {
  switch (themeId) {
    case "github-light":
      return GITHUB_LIGHT_THEME_CSS;
    case "gothic-light":
      return GOTHIC_LIGHT_THEME_CSS;
    case "night-dark":
      return NIGHT_DARK_THEME_CSS;
    case "paper-light":
      return PAPER_LIGHT_THEME_CSS;
    case "charcoal-dark":
      return CHARCOAL_DARK_THEME_CSS;
  }
}

const GITHUB_LIGHT_THEME_CSS = `
:root {
  color-scheme: light;
  --theme-bg: #f6f8fa;
  --theme-bg-muted: #f6f8fa;
  --theme-chrome: #ffffff;
  --theme-surface: #ffffff;
  --theme-chrome-soft: var(--theme-surface);
  --theme-text: #24292f;
  --theme-muted: #57606a;
  --theme-control-text: #57606a;
  --theme-control-subtle: #6e7781;
  --theme-disabled: #8c959f;
  --theme-title: #1f2328;
  --theme-border: #d8dee4;
  --theme-border-strong: #afb8c1;
  --theme-primary: #0969da;
  --theme-primary-fill: var(--theme-primary);
  --theme-primary-soft: rgba(9, 105, 218, 0.1);
  --theme-primary-selected: rgba(9, 105, 218, 0.24);
  --theme-control-hover: #f3f4f6;
  --theme-control-active: #eaeef2;
  --theme-danger-bg: rgba(207, 34, 46, 0.1);
  --theme-danger-text: #cf222e;
  --theme-code: #24292f;
  --theme-code-bg: #f6f8fa;
  --theme-code-border: #d8dee4;
  --theme-code-gutter-bg: #f6f8fa;
  --theme-code-gutter-text: #6e7781;
  --theme-code-keyword: #cf222e;
  --theme-code-string: #0a3069;
  --theme-code-comment: #6e7781;
  --theme-code-number: #0550ae;
  --theme-code-tag: #116329;
  --theme-code-attribute: #8250df;
  --theme-code-variable: #0550ae;
  --theme-inline-code-bg: rgba(175, 184, 193, 0.2);
  --theme-shadow: 0 1px 1px rgba(31, 35, 40, 0.04), 0 8px 24px rgba(140, 149, 159, 0.18);
  --theme-heading-accent: #0969da;
  --theme-strong-accent: #8250df;
  --theme-em-accent: #0550ae;
  --theme-del-accent: #cf222e;
  --theme-code-accent: #116329;
  --theme-marker-dim: #6e7781;
  /* ── 字体体系:正文字体与代码字体分离 ── */
  --theme-font:
    -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC",
    "Hiragino Sans GB", "Microsoft YaHei UI", sans-serif;
  --theme-mono-font:
    ui-monospace, "SF Mono", Menlo, Monaco, "Cascadia Code", "JetBrains Mono",
    Consolas, monospace;
}
`;

const GOTHIC_LIGHT_THEME_CSS = `
:root {
  color-scheme: light;
  --theme-bg: #fbfaf5;
  --theme-bg-muted: #f3f0e8;
  --theme-chrome: #fffdf8;
  --theme-surface: #fffdf8;
  --theme-chrome-soft: var(--theme-surface);
  --theme-text: #2d2b28;
  --theme-muted: #786f64;
  --theme-control-text: #675f56;
  --theme-control-subtle: #93887a;
  --theme-disabled: #aaa093;
  --theme-title: #181715;
  --theme-border: #e5ded1;
  --theme-border-strong: #cfc4b3;
  --theme-primary: #7b5d2a;
  --theme-primary-fill: var(--theme-primary);
  --theme-primary-soft: rgba(123, 93, 42, 0.12);
  --theme-primary-selected: rgba(123, 93, 42, 0.24);
  --theme-control-hover: #f1ece2;
  --theme-control-active: #e8dfd0;
  --theme-danger-bg: rgba(166, 47, 47, 0.1);
  --theme-danger-text: #a62f2f;
  --theme-code: #332f2b;
  --theme-code-bg: #f2eadf;
  --theme-code-border: #dfd3c2;
  --theme-code-gutter-bg: #ece3d6;
  --theme-code-gutter-text: #8f8374;
  --theme-code-keyword: #8c3f63;
  --theme-code-string: #587139;
  --theme-code-comment: #8c8378;
  --theme-code-number: #a05a2c;
  --theme-code-tag: #3f6f7a;
  --theme-code-attribute: #8c3f63;
  --theme-code-variable: #7b5d2a;
  --theme-inline-code-bg: #efe7da;
  --theme-shadow: 0 1px 1px rgba(47, 43, 37, 0.06), 0 10px 30px rgba(47, 43, 37, 0.12);
  --theme-heading-accent: #7b5d2a;
  --theme-strong-accent: #6a3d9a;
  --theme-em-accent: #2e6b5e;
  --theme-del-accent: #8c2c1a;
  --theme-code-accent: #2e6b3b;
  --theme-marker-dim: #9f9990;
  /* ── 字体体系:正文字体与代码字体分离 ── */
  --theme-font:
    "Century Gothic", "Avenir Next", Avenir, "Helvetica Neue", Helvetica, Arial,
    "PingFang SC", "Microsoft YaHei UI", sans-serif;
  --theme-mono-font:
    ui-monospace, "SF Mono", Menlo, Monaco, "Cascadia Code", "JetBrains Mono",
    Consolas, monospace;
  --theme-content-width: 820px;
}
`;

const NIGHT_DARK_THEME_CSS = `
:root {
  color-scheme: dark;
  --theme-bg: #0b0d10;
  --theme-bg-muted: #15181d;
  --theme-chrome: #101318;
  --theme-surface: #14171d;
  --theme-chrome-soft: var(--theme-surface);
  --theme-text: #d7dae0;
  --theme-muted: #9aa3ad;
  --theme-control-text: #b5bdc7;
  --theme-control-subtle: #7e8792;
  --theme-disabled: #666f7b;
  --theme-title: #f1f3f5;
  --theme-border: #262c35;
  --theme-border-strong: #3a424f;
  --theme-primary: #7aa2f7;
  --theme-primary-fill: #4774ca;
  --theme-primary-soft: rgba(122, 162, 247, 0.16);
  --theme-primary-selected: rgba(122, 162, 247, 0.32);
  --theme-control-hover: #1c222b;
  --theme-control-active: #252d38;
  --theme-danger-bg: rgba(255, 92, 118, 0.13);
  --theme-danger-text: #ff8a9e;
  --theme-code: #dce3ea;
  --theme-code-bg: #0f1217;
  --theme-code-border: #2b313a;
  --theme-code-gutter-bg: #12161c;
  --theme-code-gutter-text: #737d8a;
  --theme-code-keyword: #bb9af7;
  --theme-code-string: #9ece6a;
  --theme-code-comment: #6d7581;
  --theme-code-number: #ff9e64;
  --theme-code-tag: #7dcfff;
  --theme-code-attribute: #bb9af7;
  --theme-code-variable: #7dcfff;
  --theme-inline-code-bg: #1d232d;
  --theme-shadow: 0 1px 1px rgba(0, 0, 0, 0.5), 0 18px 44px rgba(0, 0, 0, 0.36);
  --theme-heading-accent: #7aa2f7;
  --theme-strong-accent: #bb9af7;
  --theme-em-accent: #7dcfff;
  --theme-del-accent: #f7768e;
  --theme-code-accent: #9ece6a;
  --theme-marker-dim: #565f89;
  /* ── 字体体系:正文字体与代码字体分离 ── */
  --theme-font:
    -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC",
    "Hiragino Sans GB", "Microsoft YaHei UI", sans-serif;
  --theme-mono-font:
    ui-monospace, "SF Mono", Menlo, Monaco, "Cascadia Code", "JetBrains Mono",
    Consolas, monospace;
}
`;

const PAPER_LIGHT_THEME_CSS = `
:root {
  color-scheme: light;
  /* ── 纸张与画布 ── */
  --theme-bg: #f7f5f0;
  --theme-bg-muted: #efede7;
  --theme-chrome: #efede7;
  --theme-surface: #f7f5f0;
  --theme-chrome-soft: var(--theme-surface);
  /* ── 文字体系:由浓至淡 ── */
  --theme-text: #38332c;
  --theme-title: #201d19;
  --theme-muted: #656057;
  --theme-control-text: #5a544a;
  --theme-control-subtle: #736e64;
  --theme-disabled: #9e988f;
  /* ── 边框 ── */
  --theme-border: rgba(32, 30, 28, 0.08);
  --theme-border-strong: rgba(32, 30, 28, 0.14);
  /* ── 朱砂红强调色 ── */
  --theme-primary: #6e1f2c;
  --theme-primary-fill: var(--theme-primary);
  --theme-primary-soft: rgba(110, 31, 44, 0.09);
  --theme-primary-selected: rgba(110, 31, 44, 0.14);
  /* ── 控件交互态 ── */
  --theme-control-hover: rgba(110, 31, 44, 0.06);
  --theme-control-active: rgba(110, 31, 44, 0.1);
  --theme-danger-bg: rgba(165, 52, 42, 0.1);
  --theme-danger-text: #a62f2a;
  /* ── 代码块 ── */
  --theme-code: #38332c;
  --theme-code-bg: #f0ede6;
  --theme-code-border: #e2ded5;
  --theme-code-gutter-bg: #ece8e0;
  --theme-code-gutter-text: #8a857a;
  --theme-code-keyword: #8c3f63;
  --theme-code-string: #587139;
  --theme-code-comment: #9e988f;
  --theme-code-number: #a05a2c;
  --theme-code-tag: #3f6f7a;
  --theme-code-attribute: #8c3f63;
  --theme-code-variable: #6e1f2c;
  --theme-inline-code-bg: rgba(110, 31, 44, 0.07);
  /* ── 行内语义强调色 ── */
  --theme-heading-accent: #6e1f2c;
  --theme-strong-accent: #6e1f2c;
  --theme-em-accent: #5a4420;
  --theme-del-accent: #a62f2a;
  --theme-code-accent: #2e6b3b;
  --theme-marker-dim: #9e988f;
  /* ── 荧光高亮 ── */
  --theme-mark: rgba(255, 205, 80, 0.36);
  /* ── 阴影 ── */
  --theme-shadow: 0 1px 2px rgba(32, 30, 28, 0.04), 0 14px 34px -24px rgba(32, 30, 28, 0.22);
  /* ── 字体体系:正文字体与代码字体分离 ── */
  --theme-font:
    "LXGW WenKai", "LXGW WenKai Screen", "LXGW WenKai GB",
    -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB",
    "Noto Sans CJK SC", "Source Han Sans SC", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif;
  --theme-mono-font:
    ui-monospace, "SF Mono", Menlo, Monaco, "Cascadia Code", "JetBrains Mono",
    Consolas, monospace;
  --theme-content-width: 820px;
  --theme-editor-line-height: 1.88;
  /* ── 动效 Token:纸张阻尼感 ── */
  --cm-transition-fast: 120ms cubic-bezier(0.22, 1, 0.36, 1);
  --cm-transition-base: 200ms cubic-bezier(0.22, 1, 0.36, 1);
  --cm-transition-enter: 280ms cubic-bezier(0.22, 1, 0.36, 1);
}
`;

const CHARCOAL_DARK_THEME_CSS = `
:root {
  color-scheme: dark;
  /* ── 纸张与画布:炭焙深色 ── */
  --theme-bg: #1b1815;
  --theme-bg-muted: #221e1a;
  --theme-chrome: #221e1a;
  --theme-surface: #1b1815;
  --theme-chrome-soft: var(--theme-surface);
  /* ── 文字体系:由白至灰 ── */
  --theme-text: #ddd6c9;
  --theme-title: #f2ede4;
  --theme-muted: #a39b8f;
  --theme-control-text: #bab3a7;
  --theme-control-subtle: #8a8277;
  --theme-disabled: #6b635a;
  /* ── 边框 ── */
  --theme-border: rgba(242, 237, 228, 0.1);
  --theme-border-strong: rgba(242, 237, 228, 0.18);
  /* ── 绯红强调色 ── */
  --theme-primary: #c9576b;
  --theme-primary-fill: #a84054;
  --theme-primary-soft: rgba(201, 87, 107, 0.12);
  --theme-primary-selected: rgba(201, 87, 107, 0.22);
  /* ── 控件交互态 ── */
  --theme-control-hover: rgba(201, 87, 107, 0.08);
  --theme-control-active: rgba(201, 87, 107, 0.14);
  --theme-danger-bg: rgba(255, 92, 118, 0.13);
  --theme-danger-text: #ff8a9e;
  /* ── 代码块 ── */
  --theme-code: #ddd6c9;
  --theme-code-bg: #151210;
  --theme-code-border: #2e2923;
  --theme-code-gutter-bg: #120f0c;
  --theme-code-gutter-text: #7a726a;
  --theme-code-keyword: #c9576b;
  --theme-code-string: #9dba7c;
  --theme-code-comment: #7a726a;
  --theme-code-number: #d4a76a;
  --theme-code-tag: #7dabbf;
  --theme-code-attribute: #c9a0dc;
  --theme-code-variable: #c9576b;
  --theme-inline-code-bg: rgba(201, 87, 107, 0.1);
  /* ── 行内语义强调色 ── */
  --theme-heading-accent: #c9576b;
  --theme-strong-accent: #c9576b;
  --theme-em-accent: #c9a0dc;
  --theme-del-accent: #edaba0;
  --theme-code-accent: #9dba7c;
  --theme-marker-dim: #6b635a;
  /* ── 荧光高亮 ── */
  --theme-mark: rgba(255, 205, 80, 0.26);
  /* ── 阴影 ── */
  --theme-shadow: 0 1px 2px rgba(0, 0, 0, 0.35), 0 14px 34px -24px rgba(0, 0, 0, 0.65), 0 70px 130px -60px rgba(0, 0, 0, 0.7);
  /* ── 字体体系:正文字体与代码字体分离 ── */
  --theme-font:
    "LXGW WenKai", "LXGW WenKai Screen", "LXGW WenKai GB",
    -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB",
    "Noto Sans CJK SC", "Source Han Sans SC", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif;
  --theme-mono-font:
    ui-monospace, "SF Mono", Menlo, Monaco, "Cascadia Code", "JetBrains Mono",
    Consolas, monospace;
  --theme-content-width: 820px;
  --theme-editor-line-height: 1.88;
  /* ── 动效 Token ── */
  --cm-transition-fast: 120ms cubic-bezier(0.22, 1, 0.36, 1);
  --cm-transition-base: 200ms cubic-bezier(0.22, 1, 0.36, 1);
  --cm-transition-enter: 280ms cubic-bezier(0.22, 1, 0.36, 1);
}
`;
