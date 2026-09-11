/**
 * @fileoverview 编辑器显示偏好默认值、校验器与规范化函数 (Editor Defaults & Normalizers)
 */

import type { EditorDisplaySettings, PluginSettings } from "./types.ts";

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null;
}

/**
 * 默认语法扩展插件启用清单
 */
export const DEFAULT_PLUGIN_SETTINGS: PluginSettings = Object.freeze({
  enabled: Object.freeze({
    "markdown.math": true,
    "markdown.mermaid": true,
    "markdown.directive": true,
  }),
});

/**
 * 默认静态资源相对存放目录名称
 */
export const DEFAULT_ASSETS_DIRECTORY = "assets";

/**
 * 默认编辑器排版显示设置
 */
export const DEFAULT_EDITOR_DISPLAY_SETTINGS: EditorDisplaySettings = {
  showCodeBlockLineNumbers: false,
  wysiwygFontSize: 17,
  proseFontFamily: "",
  codeFontFamily: "",
};

/**
 * 校验用户配置的图片资源相对存放目录路径
 *
 * 规则：
 * 1. 必须为相对路径，禁止绝对路径或盘符开头
 * 2. 禁止包含非法路径字符（支持 ${filename} 变量）
 *
 * @returns 规范化后的相对路径，非法时返回 null
 */
export function validateAssetsDirectory(input: string): string | null {
  const value = input.trim().replace(/\\/gu, "/");

  if (!value || value === "." || value === "..") {
    return null;
  }
  // 必须为相对路径，禁止以 / 或 Windows 盘符开头
  if (value.startsWith("/") || /^[a-zA-Z]:/u.test(value)) {
    return null;
  }
  // 排除非法文件名字符（${filename} 占位符除外）
  const testPattern = value.replace(/\$\{filename\}/gu, "filename");
  if (/[<>:"|?*]/u.test(testPattern)) {
    return null;
  }
  const segments = value.split("/");
  if (segments.some((segment) => segment.trim().length === 0)) {
    return null;
  }

  return value.replace(/\/+$/u, "");
}

/**
 * 规范化插件启用开关配置
 */
export function normalizePluginSettings(input: unknown): PluginSettings {
  if (!isRecord(input) || !isRecord(input.enabled)) {
    return DEFAULT_PLUGIN_SETTINGS;
  }

  const enabledRecord: Record<string, boolean> = {
    ...DEFAULT_PLUGIN_SETTINGS.enabled,
  };

  for (const [key, val] of Object.entries(input.enabled)) {
    if (typeof val === "boolean") {
      enabledRecord[key] = val;
    }
  }

  return {
    enabled: Object.freeze(enabledRecord),
  };
}

/**
 * 规范化编辑器显示排版配置
 */
export function normalizeEditorDisplaySettings(input: unknown): EditorDisplaySettings {
  if (!isRecord(input)) {
    return DEFAULT_EDITOR_DISPLAY_SETTINGS;
  }

  return {
    showCodeBlockLineNumbers: input.showCodeBlockLineNumbers === true,
    wysiwygFontSize: normalizeWysiwygFontSize(input.wysiwygFontSize),
    proseFontFamily: typeof input.proseFontFamily === "string" ? input.proseFontFamily.trim() : "",
    codeFontFamily: typeof input.codeFontFamily === "string" ? input.codeFontFamily.trim() : "",
  };
}

/**
 * 限制字号在 [13, 22] 像素合理可读区间
 */
export function normalizeWysiwygFontSize(input: unknown): number {
  const value =
    typeof input === "number"
      ? input
      : typeof input === "string"
        ? Number.parseFloat(input)
        : Number.NaN;

  if (!Number.isFinite(value)) {
    return DEFAULT_EDITOR_DISPLAY_SETTINGS.wysiwygFontSize;
  }

  return Math.min(Math.max(Math.round(value), 13), 22);
}
