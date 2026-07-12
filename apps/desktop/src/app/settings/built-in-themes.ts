import type { BuiltInThemeId } from "./app-settings";

export interface BuiltInThemeOption {
  readonly id: BuiltInThemeId;
  readonly label: string;
}

export const BUILT_IN_LIGHT_THEME_OPTIONS: readonly BuiltInThemeOption[] = [
  { id: "github-light", label: "GitHub" },
  { id: "gothic-light", label: "Gothic" },
];

export const BUILT_IN_DARK_THEME_OPTIONS: readonly BuiltInThemeOption[] = [
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
  --theme-font:
    "Century Gothic", "Avenir Next", Avenir, "Helvetica Neue", Helvetica, Arial,
    "PingFang SC", "Microsoft YaHei UI", sans-serif;
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
}
`;
