import {
  type BuiltInThemeId,
  BUILT_IN_LIGHT_THEME_OPTIONS,
  BUILT_IN_DARK_THEME_OPTIONS,
} from "@md-editor/editor-ui";

export { BUILT_IN_LIGHT_THEME_OPTIONS, BUILT_IN_DARK_THEME_OPTIONS, type BuiltInThemeId };

/**
 * Web 端用户偏好与 AI 配置管理（持久化于 localStorage）
 */

export type WebTheme = "light" | "dark" | "system";

export interface WebAiConfig {
  readonly enabled: boolean;
  readonly provider: "deepseek" | "openai-compatible" | "ollama";
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
}

export interface WebSettings {
  readonly theme: WebTheme;
  readonly lightTheme: BuiltInThemeId;
  readonly darkTheme: BuiltInThemeId;
  readonly fontSize: number;
  readonly ai: WebAiConfig;
}

export const PRESET_PROVIDERS = [
  {
    id: "deepseek" as const,
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-chat",
    defaultApiKeyHint: "sk-...",
  },
  {
    id: "openai-compatible" as const,
    name: "OpenAI 兼容",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    defaultApiKeyHint: "sk-...",
  },
  {
    id: "ollama" as const,
    name: "Ollama (本地)",
    baseUrl: "http://localhost:11434/v1",
    model: "qwen2.5-coder:latest",
    defaultApiKeyHint: "ollama",
  },
] as const;

export const DEFAULT_WEB_SETTINGS: WebSettings = {
  theme: "system",
  lightTheme: "paper-light",
  darkTheme: "charcoal-dark",
  fontSize: 16,
  ai: {
    enabled: true,
    provider: "deepseek",
    baseUrl: "https://api.deepseek.com",
    apiKey: "",
    model: "deepseek-chat",
  },
};

const STORAGE_KEY = "md-editor:web:settings";
const DRAFT_KEY = "md-editor:web:draft";

export function loadWebSettings(): WebSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return DEFAULT_WEB_SETTINGS;
    }
    const parsed = JSON.parse(raw);
    return {
      theme: parsed.theme ?? DEFAULT_WEB_SETTINGS.theme,
      lightTheme: parsed.lightTheme ?? DEFAULT_WEB_SETTINGS.lightTheme,
      darkTheme: parsed.darkTheme ?? DEFAULT_WEB_SETTINGS.darkTheme,
      fontSize: parsed.fontSize ?? DEFAULT_WEB_SETTINGS.fontSize,
      ai: {
        ...DEFAULT_WEB_SETTINGS.ai,
        ...parsed.ai,
      },
    };
  } catch {
    return DEFAULT_WEB_SETTINGS;
  }
}

export function saveWebSettings(settings: WebSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (err) {
    console.error("保存设置失败:", err);
  }
}

export function loadSavedDraft(): string | null {
  try {
    return localStorage.getItem(DRAFT_KEY);
  } catch {
    return null;
  }
}

export function saveDraft(markdown: string): void {
  try {
    localStorage.setItem(DRAFT_KEY, markdown);
  } catch (err) {
    console.warn("草稿本地持久化失败:", err);
  }
}

export function clearSavedDraft(): void {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch (err) {
    console.warn("清除本地草稿失败:", err);
  }
}
