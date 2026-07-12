import { afterEach, describe, expect, it, vi } from "vitest";
import {
  compareReleaseVersions,
  createAppThemePreviewSession,
  createUpdateStatusFromGitHubReleases,
  createDefaultSettings,
  DEFAULT_DEEPSEEK_ENDPOINT,
  DEFAULT_EDITOR_DISPLAY_SETTINGS,
  DEFAULT_THEME_SETTINGS,
  DEFAULT_UPDATE_SETTINGS,
  INSTALL_WITH_CURL_COMMAND,
  normalizeAiSettings,
  normalizeEditorDisplaySettings,
  normalizeAppTheme,
  normalizeUpdateSettings,
  normalizeShortcutKey,
  listenToAppSettingsChanged,
  listenToAppThemePreviewChanged,
  loadAppSettings,
  saveAppSettings,
  shortcutKeyFromKeyboardEvent,
  validateAssetsDirectory,
} from "../src/app/settings/app-settings";
import {
  isUpdateActionBusy,
  isUpdateReadyToApply,
  shouldShowEditorUpdateAction,
} from "../src/app/updates/update-status";

describe("app settings", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps the default settings aligned with editable shortcuts", () => {
    const settings = createDefaultSettings();

    expect(settings.assetsDirectory).toBe("assets");
    expect(settings.editor).toEqual(DEFAULT_EDITOR_DISPLAY_SETTINGS);
    expect(settings.theme).toEqual(DEFAULT_THEME_SETTINGS);
    expect(settings.ai.features).toEqual({
      continuation: false,
      editing: true,
    });
    expect(settings.ai.localModel).toEqual({
      enabled: false,
      modelId: "md-editor-writer-small-v1",
      version: null,
      status: "not-downloaded",
      downloadedBytes: 0,
      totalBytes: 0,
      error: null,
    });
    expect(settings.update).toEqual(DEFAULT_UPDATE_SETTINGS);
    expect(settings.shortcuts.map((shortcut) => shortcut.id)).toEqual([
      "view.toggleSource",
      "view.toggleSidebarPrimary",
      "settings.open",
      "mdx.openComponentMenu",
      "ai.continueWriting",
    ]);
  });

  it("normalizes update settings for old and partial settings payloads", () => {
    expect(normalizeUpdateSettings(undefined)).toEqual({
      automaticCheck: true,
      automaticDownload: true,
    });
    expect(normalizeUpdateSettings({})).toEqual({
      automaticCheck: true,
      automaticDownload: true,
    });
    expect(
      normalizeUpdateSettings({
        automaticCheck: false,
        automaticDownload: true,
      }),
    ).toEqual({
      automaticCheck: false,
      automaticDownload: false,
    });
    expect(
      normalizeUpdateSettings({
        automaticCheck: true,
        automaticDownload: false,
      }),
    ).toEqual({
      automaticCheck: true,
      automaticDownload: false,
    });
  });

  it("normalizes editor display settings with code block line numbers off by default", () => {
    expect(normalizeEditorDisplaySettings(undefined)).toEqual({
      showCodeBlockLineNumbers: false,
      wysiwygFontSize: 17,
    });
    expect(normalizeEditorDisplaySettings({ showCodeBlockLineNumbers: true })).toEqual({
      showCodeBlockLineNumbers: true,
      wysiwygFontSize: 17,
    });
    expect(
      normalizeEditorDisplaySettings({
        showCodeBlockLineNumbers: "true",
        wysiwygFontSize: "20",
      }),
    ).toEqual({
      showCodeBlockLineNumbers: false,
      wysiwygFontSize: 20,
    });
    expect(normalizeEditorDisplaySettings({ wysiwygFontSize: 8 }).wysiwygFontSize).toBe(13);
    expect(normalizeEditorDisplaySettings({ wysiwygFontSize: 40 }).wysiwygFontSize).toBe(22);
    expect(normalizeEditorDisplaySettings({ wysiwygFontSize: "bad" }).wysiwygFontSize).toBe(17);
  });

  it("normalizes product-facing shortcut text to runtime keymaps", () => {
    expect(normalizeShortcutKey("Command+Shift+B")).toBe("Mod-Shift-B");
    expect(normalizeShortcutKey("Ctrl+/")).toBe("Mod-/");
    expect(normalizeShortcutKey("Command+Option+Space")).toBe("Mod-Alt-Space");
    expect(normalizeShortcutKey("Mod-Shift-B")).toBe("Mod-Shift-B");
  });

  it("rejects shortcuts without a primary modifier", () => {
    expect(normalizeShortcutKey("Shift+B")).toBeNull();
    expect(normalizeShortcutKey("Command")).toBeNull();
  });

  it("captures shortcut combinations from keyboard events", () => {
    expect(
      shortcutKeyFromKeyboardEvent({
        altKey: false,
        code: "KeyB",
        ctrlKey: false,
        key: "b",
        metaKey: true,
        shiftKey: true,
      } as KeyboardEvent),
    ).toBe("Mod-Shift-B");
    expect(
      shortcutKeyFromKeyboardEvent({
        altKey: false,
        code: "Slash",
        ctrlKey: true,
        key: "/",
        metaKey: false,
        shiftKey: false,
      } as KeyboardEvent),
    ).toBe("Mod-/");
  });

  it("does not capture shortcut text while the IME is composing text", () => {
    expect(
      shortcutKeyFromKeyboardEvent({
        altKey: false,
        code: "KeyA",
        ctrlKey: false,
        isComposing: true,
        key: "a",
        keyCode: 65,
        metaKey: true,
        shiftKey: true,
      } as KeyboardEvent),
    ).toBeNull();
    expect(
      shortcutKeyFromKeyboardEvent({
        altKey: false,
        code: "KeyA",
        ctrlKey: false,
        isComposing: false,
        key: "a",
        keyCode: 229,
        metaKey: true,
        shiftKey: true,
      } as KeyboardEvent),
    ).toBeNull();
  });

  it("keeps custom asset directories inside the markdown folder", () => {
    expect(validateAssetsDirectory("images/posts")).toBe("images/posts");
    expect(validateAssetsDirectory("./assets")).toBe("assets");
    expect(validateAssetsDirectory("../outside")).toBeNull();
    expect(validateAssetsDirectory("/tmp/assets")).toBeNull();
  });

  it("normalizes persisted theme choices", () => {
    expect(
      normalizeAppTheme({
        mode: "dark",
        light: {
          source: "builtin",
          builtinTheme: "github-light",
          customCssPath: null,
        },
        dark: {
          source: "custom",
          builtinTheme: "night-dark",
          customCssPath: "/tmp/md-editor-dark.css",
        },
      }),
    ).toEqual({
      mode: "dark",
      light: {
        source: "builtin",
        builtinTheme: "github-light",
        customCssPath: null,
      },
      dark: {
        source: "custom",
        builtinTheme: "night-dark",
        customCssPath: "/tmp/md-editor-dark.css",
      },
    });
    expect(
      normalizeAppTheme({
        mode: "neon",
        light: {
          source: "rainbow",
          builtinTheme: "unknown",
          customCssPath: 42,
        },
      }),
    ).toEqual(DEFAULT_THEME_SETTINGS);
    expect(
      normalizeAppTheme({
        mode: "light",
        light: {
          source: "builtin",
          builtinTheme: "default-light",
          customCssPath: null,
        },
      }),
    ).toEqual({
      ...DEFAULT_THEME_SETTINGS,
      mode: "light",
    });
    expect(
      normalizeAppTheme({
        mode: "system",
        lightCssPath: "/tmp/md-editor-light.css",
        darkCssPath: "/tmp/md-editor-dark.css",
      }),
    ).toEqual({
      ...DEFAULT_THEME_SETTINGS,
      light: {
        ...DEFAULT_THEME_SETTINGS.light,
        source: "custom",
        customCssPath: "/tmp/md-editor-light.css",
      },
      dark: {
        ...DEFAULT_THEME_SETTINGS.dark,
        source: "custom",
        customCssPath: "/tmp/md-editor-dark.css",
      },
    });
    expect(normalizeAppTheme("typora-dark")).toEqual(DEFAULT_THEME_SETTINGS);
  });

  it("publishes sequenced preview events for one settings session", async () => {
    const events = new EventTarget();
    vi.stubGlobal("window", events);

    const previews: unknown[] = [];
    const dispose = listenToAppThemePreviewChanged((event) => previews.push(event));
    const session = createAppThemePreviewSession({ sessionId: "settings-test" });

    await session.publish({
      ...DEFAULT_THEME_SETTINGS,
      mode: "light",
    });
    await session.publish(null);
    dispose?.();

    expect(previews).toEqual([
      {
        sessionId: "settings-test",
        sequence: 1,
        theme: {
          ...DEFAULT_THEME_SETTINGS,
          mode: "light",
        },
      },
      {
        sessionId: "settings-test",
        sequence: 2,
        theme: null,
      },
    ]);
  });

  it("persists edited settings and publishes the saved normalized value", async () => {
    const events = new EventTarget();
    const values = new Map<string, string>();
    vi.stubGlobal("window", events);
    vi.stubGlobal("localStorage", {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => values.set(key, value)),
    });

    const savedEvents: unknown[] = [];
    const dispose = listenToAppSettingsChanged((settings) => savedEvents.push(settings));
    const edited = {
      ...createDefaultSettings(),
      assetsDirectory: "images/posts",
      editor: {
        showCodeBlockLineNumbers: true,
        wysiwygFontSize: 20,
      },
      theme: {
        ...DEFAULT_THEME_SETTINGS,
        mode: "dark" as const,
      },
      update: {
        automaticCheck: false,
        automaticDownload: false,
      },
    };

    const saved = await saveAppSettings(edited);
    const reloaded = await loadAppSettings();
    dispose?.();

    expect(reloaded).toEqual(saved);
    expect(savedEvents).toEqual([saved]);
    expect(saved.theme.mode).toBe("dark");
    expect(saved.editor.wysiwygFontSize).toBe(20);
    expect(saved.assetsDirectory).toBe("images/posts");
  });

  it("normalizes DeepSeek provider settings to the fixed endpoint", () => {
    expect(
      normalizeAiSettings({
        provider: "deepseek",
        openAiCompatible: {
          baseUrl: "https://api.openai.com/v1",
          model: "deepseek-chat",
          apiKey: "local-key",
        },
      }).openAiCompatible.baseUrl,
    ).toBe(DEFAULT_DEEPSEEK_ENDPOINT);
  });

  it("detects a newer public release from the tap release payload", () => {
    expect(
      createUpdateStatusFromGitHubReleases("0.2.8", [
        {
          tag_name: "md-editor-v0.2.9",
          html_url: "https://github.com/wmasfoe/homebrew-tap/releases/tag/md-editor-v0.2.9",
          prerelease: false,
          draft: false,
          assets: [
            {
              name: "Markdown.Editor_0.2.9_aarch64.dmg",
              browser_download_url:
                "https://github.com/wmasfoe/homebrew-tap/releases/download/md-editor-v0.2.9/Markdown.Editor_0.2.9_aarch64.dmg",
            },
          ],
        },
      ]),
    ).toEqual({
      currentVersion: "0.2.8",
      state: "available",
      latestVersion: "0.2.9",
      releaseUrl: "https://github.com/wmasfoe/homebrew-tap/releases/tag/md-editor-v0.2.9",
      downloadUrl:
        "https://github.com/wmasfoe/homebrew-tap/releases/download/md-editor-v0.2.9/Markdown.Editor_0.2.9_aarch64.dmg",
      installKind: "manual",
      installCommand: INSTALL_WITH_CURL_COMMAND,
    });
  });

  it("reports up-to-date when the installed version matches the latest public release", () => {
    expect(
      createUpdateStatusFromGitHubReleases("0.2.9", [
        {
          tag_name: "md-editor-v0.2.9",
          prerelease: false,
          draft: false,
          assets: [],
        },
      ]),
    ).toEqual({
      currentVersion: "0.2.9",
      state: "up-to-date",
      latestVersion: "0.2.9",
      releaseUrl: undefined,
      downloadUrl: undefined,
    });
  });

  it("ignores prerelease and unrelated GitHub release tags", () => {
    expect(
      createUpdateStatusFromGitHubReleases("0.2.8", [
        {
          tag_name: "md-editor-v0.2.9-beta.1",
          prerelease: true,
          draft: false,
        },
        {
          tag_name: "other-tool-v9.0.0",
          prerelease: false,
          draft: false,
        },
      ]),
    ).toEqual({
      currentVersion: "0.2.8",
      state: "unconfigured",
    });
  });

  it("compares stable and prerelease versions with semver precedence", () => {
    expect(compareReleaseVersions("0.2.9", "0.2.8")).toBe(1);
    expect(compareReleaseVersions("0.2.9-beta.2", "0.2.9-beta.1")).toBe(1);
    expect(compareReleaseVersions("0.2.9", "0.2.9-beta.2")).toBe(1);
    expect(compareReleaseVersions("0.2.9-beta.1", "0.2.9")).toBe(-1);
    expect(compareReleaseVersions("0.2.9", "0.2.9")).toBe(0);
  });

  it("keeps editor update action visibility in pure status helpers", () => {
    expect(
      shouldShowEditorUpdateAction({
        currentVersion: "0.3.0",
        state: "available",
        latestVersion: "0.3.1",
        installKind: "app",
      }),
    ).toBe(true);
    expect(
      shouldShowEditorUpdateAction({
        currentVersion: "0.3.0",
        state: "available",
        latestVersion: "0.3.1",
        installKind: "manual",
      }),
    ).toBe(false);
    expect(
      isUpdateReadyToApply({
        currentVersion: "0.3.0",
        state: "downloaded",
        latestVersion: "0.3.1",
        installKind: "app",
      }),
    ).toBe(true);
    expect(
      isUpdateActionBusy({
        currentVersion: "0.3.0",
        state: "downloading",
        latestVersion: "0.3.1",
        installKind: "app",
      }),
    ).toBe(true);
  });
});
