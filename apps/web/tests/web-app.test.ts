import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SHOWCASE_MARKDOWN } from "../src/presets/showcase";
import { DEFAULT_WEB_SETTINGS, PRESET_PROVIDERS } from "../src/lib/web-settings";
import {
  BUILT_IN_LIGHT_THEME_OPTIONS,
  BUILT_IN_DARK_THEME_OPTIONS,
  builtInThemeCss,
} from "@md-editor/editor-ui";
import { resolveEffectiveColorScheme } from "../src/lib/theme-manager";
import { bindWebKeyboardShortcuts, handleWebKeyboardEvent } from "../src/lib/keyboard-shortcuts";

describe("Web App Presets and Settings", () => {
  it("provides rich default showcase markdown with MDX callouts", () => {
    expect(DEFAULT_SHOWCASE_MARKDOWN).toContain(":::tip");
    expect(DEFAULT_SHOWCASE_MARKDOWN).toContain(":::info");
    expect(DEFAULT_SHOWCASE_MARKDOWN).toContain(":::warning");
    expect(DEFAULT_SHOWCASE_MARKDOWN).toContain(":::danger");
    expect(DEFAULT_SHOWCASE_MARKDOWN).toContain("Inkpoint");
  });

  it("defines supported AI preset providers", () => {
    const ids = PRESET_PROVIDERS.map((p) => p.id);
    expect(ids).toContain("deepseek");
    expect(ids).toContain("openai-compatible");
    expect(ids).toContain("ollama");
  });

  it("defaults to system theme and enabled AI", () => {
    expect(DEFAULT_WEB_SETTINGS.theme).toBe("system");
    expect(DEFAULT_WEB_SETTINGS.lightTheme).toBe("paper-light");
    expect(DEFAULT_WEB_SETTINGS.darkTheme).toBe("charcoal-dark");
    expect(DEFAULT_WEB_SETTINGS.fontSize).toBe(16);
    expect(DEFAULT_WEB_SETTINGS.ai.enabled).toBe(true);
  });
});

describe("Desktop Theme Reuse in Web", () => {
  it("includes all 5 built-in desktop themes", () => {
    const lightIds = BUILT_IN_LIGHT_THEME_OPTIONS.map((o) => o.id);
    const darkIds = BUILT_IN_DARK_THEME_OPTIONS.map((o) => o.id);

    expect(lightIds).toEqual(["paper-light", "github-light", "gothic-light"]);
    expect(darkIds).toEqual(["charcoal-dark", "night-dark"]);
  });

  it("generates CSS variable tokens for built-in themes", () => {
    for (const opt of [...BUILT_IN_LIGHT_THEME_OPTIONS, ...BUILT_IN_DARK_THEME_OPTIONS]) {
      const css = builtInThemeCss(opt.id);
      expect(css).toContain("--theme-bg");
      expect(css).toContain("--theme-text");
      expect(css).toContain("--theme-border");
    }
  });

  it("resolves effective color scheme correctly", () => {
    expect(resolveEffectiveColorScheme("dark")).toBe("dark");
    expect(resolveEffectiveColorScheme("light")).toBe("light");
  });
});

function createKeyEvent(overrides: Partial<KeyboardEvent>): KeyboardEvent {
  return {
    altKey: false,
    code: "KeyB",
    ctrlKey: false,
    key: "b",
    metaKey: true,
    shiftKey: false,
    preventDefault: vi.fn(),
    ...overrides,
  } as unknown as KeyboardEvent;
}

describe("Web Keyboard Shortcuts System", () => {
  it("handles shortcuts for mode toggle, outline, settings, export, and AI", () => {
    const onToggleMode = vi.fn();
    const onToggleOutline = vi.fn();
    const onOpenSettings = vi.fn();
    const onSave = vi.fn();
    const onTriggerAi = vi.fn();
    const onCloseOverlay = vi.fn();

    const handlers = {
      onToggleMode,
      onToggleOutline,
      onOpenSettings,
      onSave,
      onTriggerAi,
      onCloseOverlay,
    };

    // 1. Mod-/ (Toggle Mode)
    expect(handleWebKeyboardEvent(createKeyEvent({ code: "Slash", key: "/" }), handlers)).toBe(
      true,
    );
    expect(onToggleMode).toHaveBeenCalledTimes(1);

    // 2. Mod-Shift-B (Toggle Outline)
    expect(
      handleWebKeyboardEvent(createKeyEvent({ code: "KeyB", key: "b", shiftKey: true }), handlers),
    ).toBe(true);
    expect(onToggleOutline).toHaveBeenCalledTimes(1);

    // 3. Mod-, (Open Settings)
    expect(handleWebKeyboardEvent(createKeyEvent({ code: "Comma", key: "," }), handlers)).toBe(
      true,
    );
    expect(onOpenSettings).toHaveBeenCalledTimes(1);

    // 4. Mod-s (Save / Export)
    expect(handleWebKeyboardEvent(createKeyEvent({ code: "KeyS", key: "s" }), handlers)).toBe(true);
    expect(onSave).toHaveBeenCalledTimes(1);

    // 5. Mod-j (Trigger AI)
    expect(handleWebKeyboardEvent(createKeyEvent({ code: "KeyJ", key: "j" }), handlers)).toBe(true);
    expect(onTriggerAi).toHaveBeenCalledTimes(1);

    // 6. Escape (Close Overlay)
    expect(
      handleWebKeyboardEvent(createKeyEvent({ key: "Escape", metaKey: false }), handlers),
    ).toBe(true);
    expect(onCloseOverlay).toHaveBeenCalledTimes(1);
  });

  it("binds and unbinds listener cleanly using target object", () => {
    const addEventListener = vi.fn();
    const removeEventListener = vi.fn();
    const mockTarget = { addEventListener, removeEventListener };

    const cleanup = bindWebKeyboardShortcuts(
      {
        onToggleMode: vi.fn(),
        onToggleOutline: vi.fn(),
        onOpenSettings: vi.fn(),
        onSave: vi.fn(),
        onTriggerAi: vi.fn(),
        onCloseOverlay: vi.fn(),
      },
      mockTarget,
    );

    expect(addEventListener).toHaveBeenCalledWith("keydown", expect.any(Function), {
      capture: true,
    });

    cleanup();
    expect(removeEventListener).toHaveBeenCalledWith("keydown", expect.any(Function), {
      capture: true,
    });
  });
});
