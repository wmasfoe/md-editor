import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAppThemePreviewCoordinator,
  createAppThemePreviewSession,
  createDefaultSettings,
  DEFAULT_THEME_SETTINGS,
  type AppSettings,
  type AppThemePreviewEvent,
  type AppThemeSettings,
} from "../src/app/settings/app-settings";
import { applyCustomThemeCss, applyThemeBeforeWindowReveal } from "../src/app/settings/theme-css";

describe("settings theme lifecycle", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("serializes preview delivery so session end cannot overtake an earlier preview", async () => {
    let releaseFirst: (() => void) | undefined;
    let markFirstStarted: (() => void) | undefined;
    const firstDelivered = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });
    const delivered: AppThemePreviewEvent[] = [];
    const session = createAppThemePreviewSession({
      sessionId: "serialized-session",
      publishEvent: async (event) => {
        delivered.push(event);
        if (event.sequence === 1) {
          markFirstStarted?.();
          await firstDelivered;
        }
      },
    });

    const preview = session.publish({ ...DEFAULT_THEME_SETTINGS, mode: "light" });
    const end = session.publish(null);
    await firstStarted;

    expect(delivered.map((event) => event.sequence)).toEqual([1]);
    releaseFirst?.();
    await Promise.all([preview, end]);
    expect(delivered.map((event) => event.sequence)).toEqual([1, 2]);
    expect(delivered[1]?.theme).toBeNull();
  });

  it("restores the persisted system-dark theme on cancel and rejects a stale preview", async () => {
    const { target } = installThemeDom({ dark: true });
    const persisted = createDefaultSettings();
    const lifecycle = installPreviewLifecycle({ initialSettings: persisted, target });

    await lifecycle.coordinator.handle(previewEvent(1, { ...persisted.theme, mode: "light" }));
    expect(target.dataset.themeScheme).toBe("light");

    await lifecycle.coordinator.handle(previewEvent(2, null));
    expect(target.dataset.themeScheme).toBe("dark");
    expect(lifecycle.settings).toEqual(persisted);

    await lifecycle.coordinator.handle(previewEvent(1, { ...persisted.theme, mode: "light" }));
    expect(target.dataset.themeScheme).toBe("dark");
    lifecycle.dispose();
  });

  it("applies the newly persisted settings when save ends the preview session", async () => {
    const { target } = installThemeDom({ dark: false });
    const initialSettings = createDefaultSettings();
    const savedSettings: AppSettings = {
      ...initialSettings,
      editor: {
        showCodeBlockLineNumbers: true,
        wysiwygFontSize: 20,
      },
      theme: {
        ...initialSettings.theme,
        mode: "dark",
      },
    };
    const lifecycle = installPreviewLifecycle({
      initialSettings,
      persistedSettings: savedSettings,
      target,
    });

    await lifecycle.coordinator.handle(
      previewEvent(1, { ...initialSettings.theme, mode: "light" }),
    );
    await lifecycle.coordinator.handle(previewEvent(2, null));

    expect(lifecycle.settings.editor.wysiwygFontSize).toBe(20);
    expect(lifecycle.settings.editor.showCodeBlockLineNumbers).toBe(true);
    expect(target.dataset.themeScheme).toBe("dark");
    lifecycle.dispose();
  });

  it("waits for persisted custom CSS before requesting the hidden native window reveal", async () => {
    const { readThemeStyle, target } = installThemeDom({ dark: true });
    let releaseCss: (() => void) | undefined;
    let markCssLoadStarted: (() => void) | undefined;
    const cssReleased = new Promise<void>((resolve) => {
      releaseCss = resolve;
    });
    const cssLoadStarted = new Promise<void>((resolve) => {
      markCssLoadStarted = resolve;
    });
    const customTheme: AppThemeSettings = {
      ...DEFAULT_THEME_SETTINGS,
      dark: {
        ...DEFAULT_THEME_SETTINGS.dark,
        source: "custom",
        customCssPath: "/themes/lifecycle-dark.css",
      },
    };
    const customCss = ":root { --theme-bg: #010203; --theme-title: #fefefe; }";
    const reveal = vi.fn(async () => {
      expect(target.dataset.themeScheme).toBe("dark");
      expect(target.dataset.themeSource).toBe("custom");
      expect(readThemeStyle()).toBe(customCss);
    });

    const initialTheme = applyThemeBeforeWindowReveal(customTheme, reveal, {
      target,
      loadCss: async (path) => {
        markCssLoadStarted?.();
        await cssReleased;
        return { path, css: customCss };
      },
    });
    await cssLoadStarted;
    expect(reveal).not.toHaveBeenCalled();

    releaseCss?.();
    await initialTheme.revealed;

    expect(reveal).toHaveBeenCalledOnce();
    initialTheme.dispose();
  });

  it("hands reveal ownership to the replayed layout effect when StrictMode cleans up preload", async () => {
    const { target } = installThemeDom({ dark: true });
    let releaseCss: (() => void) | undefined;
    let markCssLoadStarted: (() => void) | undefined;
    const cssReleased = new Promise<void>((resolve) => {
      releaseCss = resolve;
    });
    const cssLoadStarted = new Promise<void>((resolve) => {
      markCssLoadStarted = resolve;
    });
    const theme: AppThemeSettings = {
      ...DEFAULT_THEME_SETTINGS,
      dark: {
        ...DEFAULT_THEME_SETTINGS.dark,
        source: "custom",
        customCssPath: "/themes/strict-mode-dark.css",
      },
    };
    const loadCss = vi.fn(async (path: string) => {
      markCssLoadStarted?.();
      await cssReleased;
      return { path, css: ":root { --theme-bg: #020304; }" };
    });
    const abandonedReveal = vi.fn(async () => undefined);
    const activeReveal = vi.fn(async () => undefined);

    const abandoned = applyThemeBeforeWindowReveal(theme, abandonedReveal, { loadCss, target });
    await cssLoadStarted;
    abandoned.dispose();
    const active = applyThemeBeforeWindowReveal(theme, activeReveal, { loadCss, target });
    releaseCss?.();
    await Promise.all([abandoned.revealed, active.revealed]);

    expect(loadCss).toHaveBeenCalledOnce();
    expect(abandonedReveal).not.toHaveBeenCalled();
    expect(activeReveal).toHaveBeenCalledOnce();
    active.dispose();
  });
});

function previewEvent(sequence: number, theme: AppThemeSettings | null): AppThemePreviewEvent {
  return {
    sessionId: "settings-session",
    sequence,
    theme,
  };
}

function installPreviewLifecycle({
  initialSettings,
  persistedSettings = initialSettings,
  target,
}: {
  readonly initialSettings: AppSettings;
  readonly persistedSettings?: AppSettings;
  readonly target: HTMLElement;
}) {
  let settings = initialSettings;
  let previewTheme: AppThemeSettings | null = null;
  let disposeTheme = applyCustomThemeCss(settings.theme, { target });

  const applyCurrentTheme = () => {
    disposeTheme();
    disposeTheme = applyCustomThemeCss(previewTheme ?? settings.theme, { target });
  };
  const coordinator = createAppThemePreviewCoordinator({
    loadPersistedSettings: async () => persistedSettings,
    onPersistedSettings: (next) => {
      settings = next;
    },
    onPreviewTheme: (next) => {
      previewTheme = next;
      applyCurrentTheme();
    },
  });

  return {
    coordinator,
    dispose() {
      coordinator.dispose();
      disposeTheme();
    },
    get settings() {
      return settings;
    },
  };
}

function installThemeDom({ dark }: { readonly dark: boolean }) {
  const listeners = new Set<() => void>();
  const elements = new Map<string, { id: string; textContent: string }>();
  const target = { dataset: {} } as HTMLElement;
  const mediaQuery = {
    matches: dark,
    addEventListener: vi.fn((_event: "change", listener: () => void) => listeners.add(listener)),
    removeEventListener: vi.fn((_event: "change", listener: () => void) =>
      listeners.delete(listener),
    ),
  };

  vi.stubGlobal("window", { matchMedia: vi.fn(() => mediaQuery) });
  vi.stubGlobal("document", {
    documentElement: target,
    getElementById: vi.fn((id: string) => elements.get(id) ?? null),
    createElement: vi.fn((tag: string) => ({ id: "", tag, textContent: "" })),
    head: {
      append: vi.fn((element: { id: string; textContent: string }) => {
        elements.set(element.id, element);
      }),
    },
  });

  return {
    readThemeStyle: () => elements.get("md-editor-custom-theme")?.textContent,
    target,
  };
}
