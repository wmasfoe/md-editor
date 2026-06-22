import { invoke, isTauri } from "@tauri-apps/api/core";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";

export interface ShortcutSetting {
  readonly id: string;
  readonly commandId: string;
  readonly label: string;
  readonly defaultKey: string;
  readonly key: string;
}

export interface AppSettings {
  readonly shortcuts: readonly ShortcutSetting[];
  readonly assetsDirectory: string;
}

export interface UpdateStatus {
  readonly currentVersion: string;
  readonly state: "idle" | "checking" | "unconfigured" | "error";
  readonly message: string;
}

export const DEFAULT_ASSETS_DIRECTORY = "assets";

const SHORTCUTS: readonly Omit<ShortcutSetting, "key">[] = [
  {
    id: "view.toggleSource",
    commandId: "view.toggleSource",
    label: "切换源码模式",
    defaultKey: "Mod-/"
  },
  {
    id: "view.toggleSidebarPrimary",
    commandId: "view.toggleSidebarPrimary",
    label: "切换文件树 / 大纲",
    defaultKey: "Mod-Shift-B"
  },
  {
    id: "settings.open",
    commandId: "settings.open",
    label: "打开设置",
    defaultKey: "Mod-,"
  }
];

const LOCAL_STORAGE_KEY = "md-editor-app-settings";

export function createDefaultSettings(): AppSettings {
  return {
    shortcuts: SHORTCUTS.map((shortcut) => ({ ...shortcut, key: shortcut.defaultKey })),
    assetsDirectory: DEFAULT_ASSETS_DIRECTORY
  };
}

export async function loadAppSettings(): Promise<AppSettings> {
  // Tauri 是桌面端权威存储；Web 预览只用 localStorage，方便调试 UI。
  const saved = isTauri()
    ? await invoke<Partial<PersistedSettings>>("load_app_settings").catch(() => readLocalSettings())
    : readLocalSettings();

  return normalizeSettings(saved);
}

export async function saveAppSettings(settings: AppSettings): Promise<AppSettings> {
  const normalized = normalizeSettings(settings);
  const persisted = toPersistedSettings(normalized);

  // 保存设置后 Rust 会重建 native menu，使菜单快捷键展示和运行时绑定同步。
  if (isTauri()) {
    await invoke("save_app_settings_and_update_menu", { settings: persisted });
  } else {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(persisted));
  }

  return normalized;
}

export async function checkForUpdates(currentVersion: string): Promise<UpdateStatus> {
  if (!isTauri()) {
    return {
      currentVersion,
      state: "unconfigured",
      message: "Web 预览不支持桌面端更新检查。"
    };
  }

  return invoke<UpdateStatus>("check_for_updates").catch((error: unknown) => ({
    currentVersion,
    state: "error",
    message: error instanceof Error ? error.message : "检查更新失败。"
  }));
}

export function appVersion(): string {
  return __APP_VERSION__;
}

export function keyboardShortcutLabel(key: string): string {
  return key
    .replace(/^Mod/u, navigator.platform.toLowerCase().includes("mac") ? "Command" : "Ctrl")
    .replace(/-/gu, "+");
}

export function shortcutKeyFromKeyboardEvent(event: KeyboardEvent | ReactKeyboardEvent): string | null {
  if (isModifierKey(event.key)) {
    return null;
  }

  const key = normalizeKeyboardEventKey(event);
  if (!key) {
    return null;
  }

  return [
    event.metaKey || event.ctrlKey ? "Mod" : null,
    event.shiftKey ? "Shift" : null,
    event.altKey ? "Alt" : null,
    key
  ].filter(Boolean).join("-");
}

export function normalizeShortcutKey(input: string): string | null {
  // 用户输入面向产品文案（Command+Shift+B），内部统一成 keymap 字符串（Mod-Shift-B）。
  const internalKey = normalizeInternalShortcutKey(input);
  if (internalKey) {
    return internalKey;
  }

  const parts = input
    .trim()
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 0) {
    return null;
  }

  let wantsMod = false;
  let wantsShift = false;
  let wantsAlt = false;
  let key: string | null = null;

  for (const rawPart of parts) {
    const part = rawPart.toLowerCase();
    if (part === "cmd" || part === "command" || part === "ctrl" || part === "control" || part === "mod") {
      wantsMod = true;
      continue;
    }
    if (part === "shift") {
      wantsShift = true;
      continue;
    }
    if (part === "alt" || part === "option") {
      wantsAlt = true;
      continue;
    }
    if (key) {
      return null;
    }
    key = normalizeKeyName(rawPart);
  }

  if (!wantsMod || !key) {
    return null;
  }

  return ["Mod", wantsShift ? "Shift" : null, wantsAlt ? "Alt" : null, key].filter(Boolean).join("-");
}

function normalizeInternalShortcutKey(input: string): string | null {
  const parts = input.trim().split("-").filter(Boolean);
  if (parts[0] !== "Mod" || parts.length < 2) {
    return null;
  }

  const modifiers = parts.slice(1, -1);
  if (modifiers.some((modifier) => modifier !== "Shift" && modifier !== "Alt")) {
    return null;
  }

  return ["Mod", ...modifiers, normalizeKeyName(parts.at(-1) ?? "")].join("-");
}

export function validateAssetsDirectory(input: string): string | null {
  // v0.1 只允许当前 Markdown 所在目录下的相对目录，避免图片写到任意文件系统位置。
  const value = input.trim().replace(/\\/gu, "/").replace(/^\.\/+/u, "");

  if (!value || value === "." || value === "..") {
    return null;
  }
  if (value.startsWith("/") || value.includes("../") || value.split("/").includes("..")) {
    return null;
  }
  if (value.split("/").some((segment) => segment.trim().length === 0)) {
    return null;
  }

  return value;
}

interface PersistedSettings {
  readonly shortcuts?: readonly {
    readonly id: string;
    readonly key: string;
  }[];
  readonly assetsDirectory?: string;
}

function readLocalSettings(): Partial<PersistedSettings> {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) ?? "{}") as Partial<PersistedSettings>;
  } catch {
    return {};
  }
}

function normalizeSettings(input: Partial<PersistedSettings | AppSettings> | null | undefined): AppSettings {
  // 持久化数据可能来自旧版本或用户手动编辑；加载时做一次收敛，坏值回退默认值。
  const shortcutOverrides = new Map(
    (input?.shortcuts ?? [])
      .map((shortcut) => [shortcut.id, normalizeShortcutKey(shortcut.key)] as const)
      .filter((entry): entry is readonly [string, string] => Boolean(entry[1]))
  );
  const assetsDirectory = validateAssetsDirectory(input?.assetsDirectory ?? "") ?? DEFAULT_ASSETS_DIRECTORY;

  return {
    shortcuts: SHORTCUTS.map((shortcut) => ({
      ...shortcut,
      key: shortcutOverrides.get(shortcut.id) ?? shortcut.defaultKey
    })),
    assetsDirectory
  };
}

function toPersistedSettings(settings: AppSettings): PersistedSettings {
  return {
    shortcuts: settings.shortcuts.map((shortcut) => ({
      id: shortcut.id,
      key: shortcut.key
    })),
    assetsDirectory: settings.assetsDirectory
  };
}

function normalizeKeyName(key: string): string {
  if (key === "/") {
    return "/";
  }

  const lower = key.toLowerCase();
  if (lower === "space") {
    return "Space";
  }
  if (lower.length === 1) {
    return lower.toUpperCase();
  }

  return key.slice(0, 1).toUpperCase() + key.slice(1);
}

function normalizeKeyboardEventKey(event: KeyboardEvent | ReactKeyboardEvent): string | null {
  if (event.key === " ") {
    return "Space";
  }
  if (event.key === "/") {
    return "/";
  }
  if (event.key === ",") {
    return ",";
  }
  if (/^Key[A-Z]$/u.test(event.code)) {
    return event.code.slice(3);
  }
  if (/^Digit\d$/u.test(event.code)) {
    return event.code.slice(5);
  }
  if (event.key.length === 1) {
    return normalizeKeyName(event.key);
  }
  if (/^F\d{1,2}$/u.test(event.key) || event.key === "Escape" || event.key === "Enter" || event.key === "Tab") {
    return event.key;
  }

  return null;
}

function isModifierKey(key: string): boolean {
  return key === "Meta" || key === "Control" || key === "Shift" || key === "Alt";
}

declare const __APP_VERSION__: string;
