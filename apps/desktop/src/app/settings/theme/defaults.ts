/**
 * @fileoverview 默认主题配置常量
 */

import type { AppThemeSettings } from "./types.ts";

export const APP_THEME_PREVIEW_CHANGED_EVENT = "md-editor-app-theme-preview-changed";

/**
 * 应用出厂默认主题设置
 */
export const DEFAULT_THEME_SETTINGS: AppThemeSettings = {
  mode: "system",
  light: {
    source: "builtin",
    builtinTheme: "github-light",
    customCssPath: null,
  },
  dark: {
    source: "builtin",
    builtinTheme: "night-dark",
    customCssPath: null,
  },
};
