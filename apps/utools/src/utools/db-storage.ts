import { normalizeAiSettings, type AiSettings } from "@md-editor/ai";
import type { BuiltInThemeId } from "@md-editor/app-ui";

export interface UtoolsSettings {
  theme: "system" | "light" | "dark";
  lightTheme?: BuiltInThemeId;
  darkTheme?: BuiltInThemeId;
  fontSize: number; // 13 ~ 22, default 15
  proseFontFamily: string; // font option id, default ""
  codeFontFamily: string; // font option id, default ""
  showCodeBlockLineNumbers: boolean;
  /** 是否常显行内格式标记源码，默认 false（仅触及临时显形）。 */
  showInlineStyleMarkers: boolean;
  enableMarkdownLint: boolean;
  /** AI 助写多协议配置（持久化存储） */
  ai: AiSettings;
}

export const DEFAULT_UTOOLS_SETTINGS: UtoolsSettings = {
  theme: "system",
  lightTheme: "paper-light",
  darkTheme: "charcoal-dark",
  fontSize: 15,
  proseFontFamily: "",
  codeFontFamily: "",
  showCodeBlockLineNumbers: false,
  showInlineStyleMarkers: false,
  enableMarkdownLint: true,
  ai: normalizeAiSettings({}, { allowLocal: false, defaultPresetId: "deepseek" }),
};

export const UTOOLS_SETTINGS_KEY = "inkpoint_utools_settings";

/**
 * 加载用户偏好设置（主题、字号、字体族栈、AI）
 */
export function loadUtoolsSettings(): UtoolsSettings {
  let raw: string | null = null;
  if (typeof window !== "undefined" && window.utools?.dbStorage) {
    try {
      raw = window.utools.dbStorage.getItem(UTOOLS_SETTINGS_KEY);
    } catch {
      // 降级
    }
  }
  if (!raw && typeof window !== "undefined") {
    try {
      raw = localStorage.getItem(UTOOLS_SETTINGS_KEY);
    } catch {
      // 降级
    }
  }

  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      return {
        theme: parsed.theme === "dark" || parsed.theme === "light" ? parsed.theme : "system",
        lightTheme:
          typeof parsed.lightTheme === "string"
            ? parsed.lightTheme
            : DEFAULT_UTOOLS_SETTINGS.lightTheme,
        darkTheme:
          typeof parsed.darkTheme === "string"
            ? parsed.darkTheme
            : DEFAULT_UTOOLS_SETTINGS.darkTheme,
        fontSize:
          typeof parsed.fontSize === "number" && parsed.fontSize >= 13 && parsed.fontSize <= 22
            ? parsed.fontSize
            : 15,
        proseFontFamily: typeof parsed.proseFontFamily === "string" ? parsed.proseFontFamily : "",
        codeFontFamily: typeof parsed.codeFontFamily === "string" ? parsed.codeFontFamily : "",
        showCodeBlockLineNumbers: parsed.showCodeBlockLineNumbers === true,
        showInlineStyleMarkers: parsed.showInlineStyleMarkers === true,
        enableMarkdownLint: parsed.enableMarkdownLint !== false,
        ai: normalizeAiSettings(parsed.ai, {
          allowLocal: false,
          defaultPresetId: "deepseek",
        }),
      };
    } catch {
      // JSON 解析失败则回退默认
    }
  }
  return { ...DEFAULT_UTOOLS_SETTINGS };
}

/**
 * 保存用户偏好设置
 */
export function saveUtoolsSettings(settings: UtoolsSettings): void {
  const serialized = JSON.stringify(settings);
  if (typeof window !== "undefined" && window.utools?.dbStorage) {
    try {
      window.utools.dbStorage.setItem(UTOOLS_SETTINGS_KEY, serialized);
    } catch {
      // 降级
    }
  }
  try {
    localStorage.setItem(UTOOLS_SETTINGS_KEY, serialized);
  } catch {
    // 忽略
  }
}
