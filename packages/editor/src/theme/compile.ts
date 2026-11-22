/**
 * @file compile.ts
 * @description `EditorTheme` → `--theme-*` 变量字典的**纯函数**。
 *
 * 刻意不产 CSS 文本、不碰 DOM：这样它能在 Node 里单测，也能被 `app-ui` 的主题编译器
 * 直接复用（同一份映射，避免两处变量名漂移）。
 *
 * 无效值（空串、NaN、非正数）一律忽略，不写变量——与迁移前 9 个排版 prop 的
 * 行为保持一致，避免"传了 0 反而把字号清零"。
 */

import type { EditorTheme, EditorThemeColors, EditorThemeTypography } from "./types.ts";

export type ThemeVariables = Record<string, string>;

const isUsableNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

const isUsableString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

function assignColors(target: ThemeVariables, colors: EditorThemeColors | undefined): void {
  if (!colors) return;
  if (isUsableString(colors.canvasBg)) {
    target["--theme-bg"] = colors.canvasBg;
    target["--theme-surface"] = colors.canvasBg;
  }
  if (isUsableString(colors.chromeBg)) {
    target["--theme-chrome"] = colors.chromeBg;
    target["--theme-bg-muted"] = colors.chromeBg;
  }
  if (isUsableString(colors.textColor)) target["--theme-text"] = colors.textColor;
  if (isUsableString(colors.titleColor)) target["--theme-title"] = colors.titleColor;
  if (isUsableString(colors.primaryColor)) {
    const primary = colors.primaryColor;
    target["--theme-primary"] = primary;
    target["--theme-primary-fill"] = primary;
    target["--theme-primary-soft"] = `color-mix(in srgb, ${primary} 12%, transparent)`;
    target["--theme-primary-selected"] = `color-mix(in srgb, ${primary} 26%, transparent)`;
    target["--theme-control-hover"] = `color-mix(in srgb, ${primary} 8%, transparent)`;
  }
  if (isUsableString(colors.codeBg)) target["--theme-code-bg"] = colors.codeBg;
  if (isUsableString(colors.inlineCodeBg)) target["--theme-inline-code-bg"] = colors.inlineCodeBg;
  if (isUsableString(colors.borderColor)) target["--theme-border"] = colors.borderColor;
}

function assignTypography(
  target: ThemeVariables,
  typography: EditorThemeTypography | undefined,
): void {
  if (!typography) return;
  if (isUsableString(typography.proseFontFamily))
    target["--theme-font"] = typography.proseFontFamily;
  if (isUsableString(typography.codeFontFamily))
    target["--theme-mono-font"] = typography.codeFontFamily;
  if (isUsableString(typography.headingFontFamily))
    target["--theme-heading-font"] = typography.headingFontFamily;
  if (isUsableNumber(typography.fontSize))
    target["--theme-editor-font-size"] = `${typography.fontSize}px`;
  if (isUsableNumber(typography.lineHeight))
    target["--theme-editor-line-height"] = String(typography.lineHeight);
  if (isUsableString(typography.letterSpacing))
    target["--theme-letter-spacing"] = typography.letterSpacing;
  if (isUsableNumber(typography.boldFontWeight))
    target["--theme-bold-font-weight"] = String(typography.boldFontWeight);
  if (isUsableNumber(typography.headingFontWeight))
    target["--theme-heading-font-weight"] = String(typography.headingFontWeight);
}

function assignGeometry(target: ThemeVariables, theme: EditorTheme): void {
  const width = theme.geometry?.contentMaxWidth;
  if (isUsableNumber(width)) {
    target["--theme-content-width"] = `${width}px`;
  } else if (isUsableString(width)) {
    target["--theme-content-width"] = width;
  }
}

/**
 * 编译主题。返回的字典只包含显式提供的槽位——**不填充默认值**，
 * 缺省由 CSS 里的 `var(--x, fallback)` 与宿主的 `:root` 决定。
 */
export function compileEditorTheme(theme: EditorTheme | undefined): ThemeVariables {
  const variables: ThemeVariables = {};
  if (!theme) return variables;
  assignColors(variables, theme.colors);
  assignTypography(variables, theme.typography);
  assignGeometry(variables, theme);
  return variables;
}
