/**
 * @fileoverview 主题配置反序列化校验与系统模式解析 (Theme Normalizer)
 */

import { DEFAULT_THEME_SETTINGS } from "./defaults.ts";
import type {
  AppThemeSettings,
  BuiltInThemeId,
  ThemeColorScheme,
  ThemeSchemeSettings,
} from "./types.ts";

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null;
}

/**
 * 规范化并校验外部或持久化读取的主题对象
 */
export function normalizeAppTheme(input: unknown): AppThemeSettings {
  if (!isRecord(input)) {
    return DEFAULT_THEME_SETTINGS;
  }

  const legacyLightCssPath = normalizeThemeCssPath(input.lightCssPath);
  const legacyDarkCssPath = normalizeThemeCssPath(input.darkCssPath);

  return {
    mode: normalizeThemeMode(input.mode),
    light: normalizeThemeScheme(input.light, DEFAULT_THEME_SETTINGS.light, legacyLightCssPath),
    dark: normalizeThemeScheme(input.dark, DEFAULT_THEME_SETTINGS.dark, legacyDarkCssPath),
  };
}

/**
 * 解析系统外观实际生效的明暗方案（消除 "system"）
 */
export function resolveThemeColorScheme(
  mode: ThemeColorScheme,
): Exclude<ThemeColorScheme, "system"> {
  if (mode !== "system") {
    return mode;
  }
  if (typeof window.matchMedia !== "function") {
    return "light";
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function normalizeThemeMode(input: unknown): ThemeColorScheme {
  return input === "light" || input === "dark" ? input : "system";
}

function normalizeThemeScheme(
  input: unknown,
  fallback: ThemeSchemeSettings,
  legacyCssPath: string | null,
): ThemeSchemeSettings {
  if (!isRecord(input)) {
    return legacyCssPath
      ? { ...fallback, source: "custom", customCssPath: legacyCssPath }
      : fallback;
  }

  return {
    source: input.source === "custom" ? "custom" : "builtin",
    builtinTheme: normalizeBuiltInTheme(input.builtinTheme, fallback.builtinTheme),
    customCssPath: normalizeThemeCssPath(input.customCssPath),
  };
}

function normalizeBuiltInTheme(input: unknown, fallback: BuiltInThemeId): BuiltInThemeId {
  return input === "github-light" ||
    input === "gothic-light" ||
    input === "night-dark" ||
    input === "paper-light" ||
    input === "charcoal-dark"
    ? input
    : fallback;
}

function normalizeThemeCssPath(input: unknown): string | null {
  const value = typeof input === "string" ? input.trim() : "";
  return value || null;
}
