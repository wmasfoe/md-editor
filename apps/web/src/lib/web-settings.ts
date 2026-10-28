import {
  type BuiltInThemeId,
  BUILT_IN_LIGHT_THEME_OPTIONS,
  BUILT_IN_DARK_THEME_OPTIONS,
} from "@md-editor/editor-ui";
import { AI_URL_PRESETS, normalizeAiSettings, type AiSettings } from "@md-editor/ai";
import { normalizeLanguageSetting, type LanguageSetting } from "@md-editor/i18n";

export { BUILT_IN_LIGHT_THEME_OPTIONS, BUILT_IN_DARK_THEME_OPTIONS, type BuiltInThemeId };

/**
 * Web 端用户偏好与 AI 配置管理（持久化于 localStorage）
 */

export type WebTheme = "light" | "dark" | "system";

export type WebAiConfig = AiSettings;

export interface PluginSettings {
  readonly enabled: Readonly<Record<string, boolean>>;
}

export const DEFAULT_PLUGIN_SETTINGS: PluginSettings = Object.freeze({
  enabled: Object.freeze({
    "markdown.math": true,
    "markdown.mermaid": true,
    "markdown.directive": true,
  }),
});

export interface WebSettings {
  readonly theme: WebTheme;
  readonly lightTheme: BuiltInThemeId;
  readonly darkTheme: BuiltInThemeId;
  readonly fontSize: number;
  readonly proseFontFamily: string;
  readonly codeFontFamily: string;
  readonly showCodeBlockLineNumbers: boolean;
  /**
   * 是否常显加粗/斜体/删除线/行内代码的 markdown 标记源码（默认 false = 仅触及临时显形）。
   */
  readonly showInlineStyleMarkers: boolean;
  readonly enableMarkdownLint: boolean;
  readonly ai: WebAiConfig;
  readonly plugins: PluginSettings;
  readonly language: LanguageSetting;
}

export const PRESET_PROVIDERS = AI_URL_PRESETS;

export const DEFAULT_WEB_SETTINGS: WebSettings = {
  theme: "system",
  lightTheme: "paper-light",
  darkTheme: "charcoal-dark",
  fontSize: 16,
  proseFontFamily: "",
  codeFontFamily: "",
  showCodeBlockLineNumbers: false,
  showInlineStyleMarkers: false,
  enableMarkdownLint: true,
  ai: normalizeAiSettings({}, { allowLocal: false, defaultPresetId: "deepseek" }),
  plugins: DEFAULT_PLUGIN_SETTINGS,
  language: "system",
};

const STORAGE_KEY = "md-editor:web:settings";
const DRAFT_KEY = "md-editor:web:draft";

function getStorage(): Storage | null {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      return window.localStorage;
    }
    if (typeof localStorage !== "undefined") {
      return localStorage;
    }
  } catch {
    return null;
  }
  return null;
}

export function loadWebSettings(): WebSettings {
  try {
    const raw = getStorage()?.getItem(STORAGE_KEY);
    if (!raw) {
      return DEFAULT_WEB_SETTINGS;
    }
    const parsed = JSON.parse(raw);
    return {
      theme: parsed.theme ?? DEFAULT_WEB_SETTINGS.theme,
      lightTheme: parsed.lightTheme ?? DEFAULT_WEB_SETTINGS.lightTheme,
      darkTheme: parsed.darkTheme ?? DEFAULT_WEB_SETTINGS.darkTheme,
      fontSize: parsed.fontSize ?? DEFAULT_WEB_SETTINGS.fontSize,
      proseFontFamily:
        typeof parsed.proseFontFamily === "string"
          ? parsed.proseFontFamily
          : DEFAULT_WEB_SETTINGS.proseFontFamily,
      codeFontFamily:
        typeof parsed.codeFontFamily === "string"
          ? parsed.codeFontFamily
          : DEFAULT_WEB_SETTINGS.codeFontFamily,
      showCodeBlockLineNumbers: parsed.showCodeBlockLineNumbers === true,
      // 只接受布尔 true，其余一律关闭（存量用户升级后默认变干净）。
      showInlineStyleMarkers: parsed.showInlineStyleMarkers === true,
      enableMarkdownLint: parsed.enableMarkdownLint !== false,
      ai: normalizeAiSettings(parsed.ai, {
        allowLocal: false,
        defaultPresetId: "deepseek",
      }),
      plugins: parsed.plugins ?? DEFAULT_WEB_SETTINGS.plugins,
      language: normalizeLanguageSetting(parsed.language),
    };
  } catch {
    return DEFAULT_WEB_SETTINGS;
  }
}

export function saveWebSettings(settings: WebSettings): void {
  try {
    getStorage()?.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (err) {
    console.error("保存设置失败:", err);
  }
}

export function loadSavedDraft(): string | null {
  try {
    return getStorage()?.getItem(DRAFT_KEY) ?? null;
  } catch {
    return null;
  }
}

export function saveDraft(markdown: string): void {
  try {
    getStorage()?.setItem(DRAFT_KEY, markdown);
  } catch (err) {
    console.warn("草稿本地持久化失败:", err);
  }
}

export function clearSavedDraft(): void {
  try {
    getStorage()?.removeItem(DRAFT_KEY);
  } catch (err) {
    console.warn("清除本地草稿失败:", err);
  }
}
