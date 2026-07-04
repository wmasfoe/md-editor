import { invoke, isTauri } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import type {
  AiProviderType,
  AiSettings
} from "@md-editor/editor-core";
import {
  DEFAULT_LOCAL_MODEL_SETTINGS,
  normalizeLocalAiModelSettings
} from "../ai/local-ai-model-state";
import { isComposingKeyboardEvent } from "../../lib/keyboard";

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
  readonly editor: EditorDisplaySettings;
  readonly theme: AppThemeSettings;
  readonly ai: AiSettings;
}

export interface UpdateStatus {
  readonly currentVersion: string;
  readonly state:
    | "idle"
    | "checking"
    | "up-to-date"
    | "available"
    | "downloading"
    | "installing"
    | "installed"
    | "unconfigured"
    | "error";
  readonly message: string;
  readonly latestVersion?: string;
  readonly releaseUrl?: string;
  readonly downloadUrl?: string;
  readonly installKind?: "app" | "manual";
  readonly installCommand?: string;
  readonly downloadedBytes?: number;
  readonly totalBytes?: number;
}

export type ThemeColorScheme = "system" | "light" | "dark";
export type ThemeSourceType = "builtin" | "custom";
export type BuiltInThemeId = "github-light" | "gothic-light" | "night-dark";

export interface ThemeSchemeSettings {
  readonly source: ThemeSourceType;
  readonly builtinTheme: BuiltInThemeId;
  readonly customCssPath: string | null;
}

export interface AppThemeSettings {
  readonly mode: ThemeColorScheme;
  readonly light: ThemeSchemeSettings;
  readonly dark: ThemeSchemeSettings;
}

export interface EditorDisplaySettings {
  readonly showCodeBlockLineNumbers: boolean;
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
  },
  {
    id: "mdx.openComponentMenu",
    commandId: "mdx.openComponentMenu",
    label: "插入 MDX 组件",
    defaultKey: "Mod-Shift-M"
  },
  {
    id: "ai.continueWriting",
    commandId: "ai.continueWriting",
    label: "AI 写作建议",
    defaultKey: "Mod-Shift-A"
  }
];

const LOCAL_STORAGE_KEY = "md-editor-app-settings";
export const APP_SETTINGS_CHANGED_EVENT = "md-editor-app-settings-changed";
export const APP_THEME_PREVIEW_CHANGED_EVENT = "md-editor-app-theme-preview-changed";
export const DEFAULT_OPENAI_COMPATIBLE_ENDPOINT = "https://api.openai.com/v1";
export const DEFAULT_DEEPSEEK_ENDPOINT = "https://api.deepseek.com";
export const UPDATE_RELEASES_API_URL = "https://api.github.com/repos/wmasfoe/homebrew-tap/releases?per_page=20";
export const INSTALL_WITH_CURL_COMMAND =
  "curl -fsSL https://raw.githubusercontent.com/wmasfoe/homebrew-tap/main/install-md-editor.sh | sh";

const DEFAULT_AI_SETTINGS: AiSettings = {
  enabled: true,
  provider: "openai-compatible",
  features: {
    continuation: false,
    editing: true
  },
  openAiCompatible: {
    baseUrl: DEFAULT_OPENAI_COMPATIBLE_ENDPOINT,
    model: "",
    apiKey: ""
  },
  localModel: {
    ...DEFAULT_LOCAL_MODEL_SETTINGS
  }
};

export const DEFAULT_THEME_SETTINGS: AppThemeSettings = {
  mode: "system",
  light: {
    source: "builtin",
    builtinTheme: "github-light",
    customCssPath: null
  },
  dark: {
    source: "builtin",
    builtinTheme: "night-dark",
    customCssPath: null
  }
};

export const DEFAULT_EDITOR_DISPLAY_SETTINGS: EditorDisplaySettings = {
  showCodeBlockLineNumbers: false
};

export function createDefaultSettings(): AppSettings {
  return {
    shortcuts: SHORTCUTS.map((shortcut) => ({ ...shortcut, key: shortcut.defaultKey })),
    assetsDirectory: DEFAULT_ASSETS_DIRECTORY,
    editor: DEFAULT_EDITOR_DISPLAY_SETTINGS,
    theme: DEFAULT_THEME_SETTINGS,
    ai: DEFAULT_AI_SETTINGS
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

  // 独立设置窗口保存后必须通知主编辑器窗口刷新运行时配置，保证不用关闭设置也能看到结果。
  await publishAppSettingsChanged(normalized);
  return normalized;
}

export function listenToAppSettingsChanged(
  handler: (settings: AppSettings) => void
): (() => void) | undefined {
  if (isTauri()) {
    // Tauri event 会广播到所有 webview；每个窗口都重新 normalize，防止旧版 payload 形状污染状态。
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

export function listenToAppThemePreviewChanged(
  handler: (theme: AppThemeSettings) => void
): (() => void) | undefined {
  if (isTauri()) {
    // 主题预览是跨窗口即时反馈，不代表已保存；主窗口只临时应用 payload。
    let unlisten: (() => void) | undefined;
    let disposed = false;

    void listen<unknown>(APP_THEME_PREVIEW_CHANGED_EVENT, (event) => {
      handler(normalizeAppTheme(event.payload));
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
    handler(normalizeAppTheme((event as CustomEvent<unknown>).detail));
  };
  window.addEventListener(APP_THEME_PREVIEW_CHANGED_EVENT, listener);
  return () => window.removeEventListener(APP_THEME_PREVIEW_CHANGED_EVENT, listener);
}

async function publishAppSettingsChanged(settings: AppSettings): Promise<void> {
  if (isTauri()) {
    // 使用前端事件而不是 Rust 命令回调，避免设置窗口需要知道主窗口 label。
    await emit(APP_SETTINGS_CHANGED_EVENT, settings);
    return;
  }

  window.dispatchEvent(new CustomEvent(APP_SETTINGS_CHANGED_EVENT, { detail: settings }));
}

export async function publishAppThemePreviewChanged(theme: AppThemeSettings): Promise<void> {
  const normalized = normalizeAppTheme(theme);

  if (isTauri()) {
    await emit(APP_THEME_PREVIEW_CHANGED_EVENT, normalized);
    return;
  }

  window.dispatchEvent(new CustomEvent(APP_THEME_PREVIEW_CHANGED_EVENT, { detail: normalized }));
}

export async function checkForUpdates(
  currentVersion: string,
  fetchReleases: typeof fetch = fetch
): Promise<UpdateStatus> {
  try {
    const response = await fetchReleases(UPDATE_RELEASES_API_URL, {
      headers: {
        Accept: "application/vnd.github+json"
      },
      cache: "no-store"
    });

    if (!response.ok) {
      return {
        currentVersion,
        state: "error",
        message: `检查更新失败：GitHub Release API 返回 ${response.status}。`
      };
    }

    return createUpdateStatusFromGitHubReleases(currentVersion, await response.json());
  } catch (error) {
    return {
      currentVersion,
      state: "error",
      message: error instanceof Error ? `检查更新失败：${error.message}` : "检查更新失败。"
    };
  }
}

export function appVersion(): string {
  return __APP_VERSION__;
}

export function createUpdateStatusFromGitHubReleases(currentVersion: string, payload: unknown): UpdateStatus {
  const latestRelease = findLatestMdEditorRelease(payload);
  if (!latestRelease) {
    return {
      currentVersion,
      state: "unconfigured",
      message: "没有找到公开稳定版发布记录，请确认 Release workflow 已完成。"
    };
  }

  const comparison = compareReleaseVersions(latestRelease.version, currentVersion);
  if (comparison > 0) {
    return {
      currentVersion,
      state: "available",
      latestVersion: latestRelease.version,
      releaseUrl: latestRelease.releaseUrl,
      downloadUrl: latestRelease.downloadUrl,
      installKind: "manual",
      installCommand: INSTALL_WITH_CURL_COMMAND,
      message: `发现新版本 ${latestRelease.version}，当前版本 ${currentVersion}。`
    };
  }

  return {
    currentVersion,
    state: "up-to-date",
    latestVersion: latestRelease.version,
    releaseUrl: latestRelease.releaseUrl,
    downloadUrl: latestRelease.downloadUrl,
    message: `当前版本 ${currentVersion} 已是最新发布版本。`
  };
}

export function compareReleaseVersions(left: string, right: string): number {
  const leftVersion = parseSemver(left);
  const rightVersion = parseSemver(right);

  if (!leftVersion || !rightVersion) {
    const fallback = left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
    return fallback === 0 ? 0 : fallback > 0 ? 1 : -1;
  }

  for (const key of ["major", "minor", "patch"] as const) {
    if (leftVersion[key] !== rightVersion[key]) {
      return leftVersion[key] > rightVersion[key] ? 1 : -1;
    }
  }

  if (leftVersion.prerelease === rightVersion.prerelease) {
    return 0;
  }
  if (!leftVersion.prerelease) {
    return 1;
  }
  if (!rightVersion.prerelease) {
    return -1;
  }

  return comparePrerelease(leftVersion.prerelease, rightVersion.prerelease);
}

export function normalizeAiSettings(input: Partial<AiSettings> | null | undefined): AiSettings {
  const provider = normalizeAiProvider(input?.provider);
  const hasFeatureSettings = input?.features !== undefined;
  const features = {
    continuation: Boolean(input?.features?.continuation),
    editing: input?.features?.editing ?? true
  };
  return {
    enabled: hasFeatureSettings ? input?.enabled ?? true : true,
    provider,
    features,
    openAiCompatible: {
      baseUrl: normalizeAiBaseUrl(input?.openAiCompatible?.baseUrl, provider),
      model: input?.openAiCompatible?.model?.trim() ?? "",
      apiKey: input?.openAiCompatible?.apiKey ?? ""
    },
    localModel: normalizeLocalAiModelSettings(input?.localModel)
  };
}

export function keyboardShortcutLabel(key: string): string {
  return key
    .replace(/^Mod/u, navigator.platform.toLowerCase().includes("mac") ? "Command" : "Ctrl")
    .replace(/-/gu, "+");
}

export function shortcutKeyFromKeyboardEvent(event: KeyboardEvent | ReactKeyboardEvent): string | null {
  const nativeEvent = "nativeEvent" in event ? event.nativeEvent : event;
  if (isComposingKeyboardEvent(nativeEvent)) {
    return null;
  }

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

interface PublishedRelease {
  readonly version: string;
  readonly releaseUrl?: string;
  readonly downloadUrl?: string;
}

interface SemverParts {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly prerelease: string | null;
}

function findLatestMdEditorRelease(payload: unknown): PublishedRelease | null {
  const releases = Array.isArray(payload) ? payload : [payload];

  for (const release of releases) {
    if (!isRecord(release) || release.draft === true || release.prerelease === true) {
      continue;
    }

    const version = parsePublishedVersionTag(readString(release.tag_name));
    if (!version) {
      continue;
    }

    return {
      version,
      releaseUrl: readString(release.html_url) ?? undefined,
      downloadUrl: readDmgDownloadUrl(release.assets)
    };
  }

  return null;
}

function parsePublishedVersionTag(tagName: string | null): string | null {
  const value = tagName?.trim();
  if (!value) {
    return null;
  }

  const tapReleaseMatch = value.match(/^md-editor-v(.+)$/u);
  if (tapReleaseMatch) {
    return tapReleaseMatch[1] ?? null;
  }

  const sourceReleaseMatch = value.match(/^v(.+)$/u);
  return sourceReleaseMatch?.[1] ?? null;
}

function readDmgDownloadUrl(input: unknown): string | undefined {
  if (!Array.isArray(input)) {
    return undefined;
  }

  for (const asset of input) {
    if (!isRecord(asset)) {
      continue;
    }
    const name = readString(asset.name);
    const downloadUrl = readString(asset.browser_download_url);
    if (name?.toLowerCase().endsWith(".dmg") && downloadUrl) {
      return downloadUrl;
    }
  }

  return undefined;
}

function readString(input: unknown): string | null {
  return typeof input === "string" && input.trim() ? input.trim() : null;
}

function parseSemver(input: string): SemverParts | null {
  const match = input
    .trim()
    .match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/u);

  if (!match) {
    return null;
  }

  return {
    major: Number.parseInt(match[1] ?? "0", 10),
    minor: Number.parseInt(match[2] ?? "0", 10),
    patch: Number.parseInt(match[3] ?? "0", 10),
    prerelease: match[4] ?? null
  };
}

function comparePrerelease(left: string, right: string): number {
  const leftParts = left.split(".");
  const rightParts = right.split(".");
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const leftPart = leftParts[index];
    const rightPart = rightParts[index];
    if (leftPart === rightPart) {
      continue;
    }
    if (leftPart === undefined) {
      return -1;
    }
    if (rightPart === undefined) {
      return 1;
    }

    const leftNumeric = /^\d+$/u.test(leftPart);
    const rightNumeric = /^\d+$/u.test(rightPart);
    if (leftNumeric && rightNumeric) {
      const leftNumber = Number.parseInt(leftPart, 10);
      const rightNumber = Number.parseInt(rightPart, 10);
      return leftNumber === rightNumber ? 0 : leftNumber > rightNumber ? 1 : -1;
    }
    if (leftNumeric !== rightNumeric) {
      return leftNumeric ? -1 : 1;
    }

    const lexical = leftPart.localeCompare(rightPart, undefined, { numeric: true, sensitivity: "base" });
    if (lexical !== 0) {
      return lexical > 0 ? 1 : -1;
    }
  }

  return 0;
}

interface PersistedSettings {
  readonly shortcuts?: readonly {
    readonly id: string;
    readonly key: string;
  }[];
  readonly assetsDirectory?: string;
  readonly editor?: unknown;
  readonly theme?: unknown;
  readonly ai?: Partial<AiSettings>;
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
    assetsDirectory,
    editor: normalizeEditorDisplaySettings(input?.editor),
    theme: normalizeAppTheme(input?.theme),
    ai: normalizeAiSettings(input?.ai)
  };
}

function toPersistedSettings(settings: AppSettings): PersistedSettings {
  return {
    shortcuts: settings.shortcuts.map((shortcut) => ({
      id: shortcut.id,
      key: shortcut.key
    })),
    assetsDirectory: settings.assetsDirectory,
    editor: settings.editor,
    theme: settings.theme,
    ai: settings.ai
  };
}

export function normalizeEditorDisplaySettings(input: unknown): EditorDisplaySettings {
  if (!isRecord(input)) {
    return DEFAULT_EDITOR_DISPLAY_SETTINGS;
  }

  return {
    showCodeBlockLineNumbers: input.showCodeBlockLineNumbers === true
  };
}

export function normalizeAppTheme(input: unknown): AppThemeSettings {
  if (!isRecord(input)) {
    return DEFAULT_THEME_SETTINGS;
  }

  const legacyLightCssPath = normalizeThemeCssPath(input.lightCssPath);
  const legacyDarkCssPath = normalizeThemeCssPath(input.darkCssPath);

  return {
    mode: normalizeThemeMode(input.mode),
    light: normalizeThemeScheme(input.light, DEFAULT_THEME_SETTINGS.light, legacyLightCssPath),
    dark: normalizeThemeScheme(input.dark, DEFAULT_THEME_SETTINGS.dark, legacyDarkCssPath)
  };
}

export function resolveThemeColorScheme(mode: ThemeColorScheme): Exclude<ThemeColorScheme, "system"> {
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
  legacyCssPath: string | null
): ThemeSchemeSettings {
  if (!isRecord(input)) {
    return legacyCssPath
      ? { ...fallback, source: "custom", customCssPath: legacyCssPath }
      : fallback;
  }

  return {
    source: input.source === "custom" ? "custom" : "builtin",
    builtinTheme: normalizeBuiltInTheme(input.builtinTheme, fallback.builtinTheme),
    customCssPath: normalizeThemeCssPath(input.customCssPath)
  };
}

function normalizeBuiltInTheme(input: unknown, fallback: BuiltInThemeId): BuiltInThemeId {
  return input === "github-light" || input === "gothic-light" || input === "night-dark"
    ? input
    : fallback;
}

function normalizeThemeCssPath(input: unknown): string | null {
  const value = typeof input === "string" ? input.trim() : "";
  return value || null;
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null;
}

function normalizeAiProvider(input: unknown): AiProviderType {
  if (input === "deepseek" || input === "local") {
    return input;
  }

  return "openai-compatible";
}

function normalizeAiBaseUrl(input: string | undefined, provider: AiProviderType): string {
  if (provider === "deepseek") {
    return DEFAULT_DEEPSEEK_ENDPOINT;
  }

  const value = input?.trim().replace(/\/+$/u, "");
  return value || DEFAULT_AI_SETTINGS.openAiCompatible.baseUrl;
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
