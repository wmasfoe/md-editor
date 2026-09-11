/**
 * @fileoverview 本地与系统存储层、配置数据迁移与跨窗口事件同步 (Settings Storage & Migration)
 */

import { invoke, isTauri } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { DEFAULT_AI_SETTINGS, normalizeAiSettings, type AiSettings } from "@md-editor/ai";
import type { LanguageSetting } from "@md-editor/i18n";
import {
  DEFAULT_ASSETS_DIRECTORY,
  DEFAULT_EDITOR_DISPLAY_SETTINGS,
  DEFAULT_PLUGIN_SETTINGS,
  normalizeEditorDisplaySettings,
  normalizePluginSettings,
  validateAssetsDirectory,
} from "../editor/index.ts";
import { DEFAULT_SHORTCUT_TEMPLATES, normalizeShortcutKey } from "../shortcuts/index.ts";
import { DEFAULT_THEME_SETTINGS, normalizeAppTheme } from "../theme/index.ts";
import { DEFAULT_UPDATE_SETTINGS, normalizeUpdateSettings } from "../updates/index.ts";
import type { AppSettings } from "./types.ts";

export const LOCAL_STORAGE_KEY = "md-editor-settings";
export const APP_SETTINGS_CHANGED_EVENT = "md-editor-app-settings-changed";
export const APP_LANGUAGE_PREVIEW_CHANGED_EVENT = "md-editor-app-language-preview-changed";
export const DEFAULT_LANGUAGE: LanguageSetting = "system";

export interface PersistedSettings {
  readonly shortcuts: readonly {
    readonly id: string;
    readonly key: string;
  }[];
  readonly assetsDirectory?: string;
  readonly editor?: unknown;
  readonly theme?: unknown;
  readonly ai?: Partial<AiSettings>;
  readonly update?: unknown;
  readonly plugins?: unknown;
  readonly language?: unknown;
}

/**
 * 构造出厂默认全局设置
 */
export function createDefaultSettings(): AppSettings {
  return {
    shortcuts: DEFAULT_SHORTCUT_TEMPLATES.map((shortcut) => ({
      ...shortcut,
      key: shortcut.defaultKey,
    })),
    assetsDirectory: DEFAULT_ASSETS_DIRECTORY,
    editor: DEFAULT_EDITOR_DISPLAY_SETTINGS,
    theme: DEFAULT_THEME_SETTINGS,
    ai: DEFAULT_AI_SETTINGS,
    update: DEFAULT_UPDATE_SETTINGS,
    plugins: DEFAULT_PLUGIN_SETTINGS,
    language: DEFAULT_LANGUAGE,
  };
}

/**
 * 从存储介质中异步读取最新配置
 * Tauri 运行在原生环境走 SQLite/JSON 配置文件；Web 模式降级为 localStorage
 */
export async function loadAppSettings(): Promise<AppSettings> {
  const saved = isTauri()
    ? await invoke<Partial<PersistedSettings>>("load_app_settings")
    : readLocalSettings();

  return normalizeSettings(saved);
}

/**
 * 保存全局设置至本地并同步更新原生应用菜单与广播通知
 */
export async function saveAppSettings(settings: AppSettings): Promise<AppSettings> {
  const normalized = normalizeSettings(settings);
  const persisted = toPersistedSettings(normalized);

  if (isTauri()) {
    await invoke("save_app_settings_and_update_menu", { settings: persisted });
  } else {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(persisted));
  }

  await publishAppSettingsChanged(normalized);
  return normalized;
}

/**
 * 监听跨窗口配置变更广播事件
 */
export function listenToAppSettingsChanged(
  handler: (settings: AppSettings) => void,
): (() => void) | undefined {
  if (isTauri()) {
    let unlisten: (() => void) | undefined;
    let disposed = false;

    void listen<Partial<AppSettings | PersistedSettings>>(APP_SETTINGS_CHANGED_EVENT, (event) => {
      handler(normalizeSettings(event.payload));
    }).then((dispose) => {
      if (disposed) {
        dispose();
        return;
      }
      unlisten = dispose;
    });

    return () => {
      disposed = true;
      unlisten?.();
      unlisten = undefined;
    };
  }

  const listener = (event: Event) => {
    handler(normalizeSettings((event as CustomEvent<AppSettings>).detail));
  };
  window.addEventListener(APP_SETTINGS_CHANGED_EVENT, listener);
  return () => window.removeEventListener(APP_SETTINGS_CHANGED_EVENT, listener);
}

/**
 * 发布界面语言跨窗口实时预览事件
 */
export async function publishAppLanguagePreview(
  language: AppSettings["language"] | null,
): Promise<void> {
  if (isTauri()) {
    await emit(APP_LANGUAGE_PREVIEW_CHANGED_EVENT, { language });
    return;
  }

  window.dispatchEvent(
    new CustomEvent(APP_LANGUAGE_PREVIEW_CHANGED_EVENT, { detail: { language } }),
  );
}

/**
 * 监听界面语言跨窗口实时预览事件
 */
export function listenToAppLanguagePreviewChanged(
  handler: (language: AppSettings["language"] | null) => void,
): (() => void) | undefined {
  if (isTauri()) {
    let unlisten: (() => void) | undefined;
    let disposed = false;

    void listen<{ language?: unknown }>(APP_LANGUAGE_PREVIEW_CHANGED_EVENT, (event) => {
      handler(normalizeLanguageSetting(event.payload?.language));
    }).then((dispose) => {
      if (disposed) {
        dispose();
        return;
      }
      unlisten = dispose;
    });

    return () => {
      disposed = true;
      unlisten?.();
      unlisten = undefined;
    };
  }

  const listener = (event: Event) => {
    const detail = (event as CustomEvent<{ language?: unknown }>).detail;
    handler(normalizeLanguageSetting(detail?.language));
  };
  window.addEventListener(APP_LANGUAGE_PREVIEW_CHANGED_EVENT, listener);
  return () => window.removeEventListener(APP_LANGUAGE_PREVIEW_CHANGED_EVENT, listener);
}

/**
 * 规范化语言配置字符串
 */
export function normalizeLanguageSetting(input: unknown): LanguageSetting {
  return input === "zh" || input === "en" ? input : "system";
}

export function normalizeSettings(
  input: Partial<PersistedSettings | AppSettings> | null | undefined,
): AppSettings {
  const shortcutOverrides = new Map(
    (input?.shortcuts ?? [])
      .map((shortcut) => [shortcut.id, normalizeShortcutKey(shortcut.key)] as const)
      .filter((entry): entry is readonly [string, string] => Boolean(entry[1])),
  );
  const assetsDirectory =
    validateAssetsDirectory(input?.assetsDirectory ?? "") ?? DEFAULT_ASSETS_DIRECTORY;

  return {
    shortcuts: DEFAULT_SHORTCUT_TEMPLATES.map((shortcut) => ({
      ...shortcut,
      key: shortcutOverrides.get(shortcut.id) ?? shortcut.defaultKey,
    })),
    assetsDirectory,
    editor: normalizeEditorDisplaySettings(input?.editor),
    theme: normalizeAppTheme(input?.theme),
    ai: normalizeAiSettings(input?.ai),
    update: normalizeUpdateSettings(input?.update),
    plugins: normalizePluginSettings(input?.plugins),
    language: normalizeLanguageSetting(input?.language),
  };
}

export function toPersistedSettings(settings: AppSettings): PersistedSettings {
  return {
    shortcuts: settings.shortcuts.map((shortcut) => ({
      id: shortcut.id,
      key: shortcut.key,
    })),
    assetsDirectory: settings.assetsDirectory,
    editor: settings.editor,
    theme: settings.theme,
    ai: settings.ai,
    update: settings.update,
    plugins: settings.plugins,
    language: settings.language,
  };
}

function readLocalSettings(): Partial<PersistedSettings> {
  try {
    return JSON.parse(
      localStorage.getItem(LOCAL_STORAGE_KEY) ?? "{}",
    ) as Partial<PersistedSettings>;
  } catch {
    return {};
  }
}

async function publishAppSettingsChanged(settings: AppSettings): Promise<void> {
  if (isTauri()) {
    await emit(APP_SETTINGS_CHANGED_EVENT, settings);
    return;
  }

  window.dispatchEvent(new CustomEvent(APP_SETTINGS_CHANGED_EVENT, { detail: settings }));
}
