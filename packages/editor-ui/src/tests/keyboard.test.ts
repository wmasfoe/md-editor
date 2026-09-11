import { describe, expect, it } from "vitest";
import {
  getOperatingSystem,
  isComposingKeyboardEvent,
  isLinuxPlatform,
  isMacPlatform,
  isWindowsPlatform,
  matchesRuntimeKeymap,
} from "../keyboard";

function createKeyboardEvent(overrides: Partial<KeyboardEvent>): KeyboardEvent {
  return {
    altKey: false,
    code: "KeyB",
    ctrlKey: false,
    key: "b",
    metaKey: true,
    shiftKey: false,
    ...overrides,
  } as KeyboardEvent;
}

describe("editor-ui keyboard platform detection", () => {
  it("detects mac platform correctly from platform or userAgent", () => {
    const originalNavigator = globalThis.navigator;
    try {
      Object.defineProperty(globalThis, "navigator", {
        value: {
          platform: "MacIntel",
          userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
        },
        configurable: true,
      });
      expect(getOperatingSystem()).toBe("mac");
      expect(isMacPlatform()).toBe(true);
      expect(isWindowsPlatform()).toBe(false);
      expect(isLinuxPlatform()).toBe(false);
    } finally {
      Object.defineProperty(globalThis, "navigator", {
        value: originalNavigator,
        configurable: true,
      });
    }
  });

  it("detects windows platform correctly", () => {
    const originalNavigator = globalThis.navigator;
    try {
      Object.defineProperty(globalThis, "navigator", {
        value: { platform: "Win32", userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
        configurable: true,
      });
      expect(getOperatingSystem()).toBe("windows");
      expect(isWindowsPlatform()).toBe(true);
      expect(isMacPlatform()).toBe(false);
      expect(isLinuxPlatform()).toBe(false);
    } finally {
      Object.defineProperty(globalThis, "navigator", {
        value: originalNavigator,
        configurable: true,
      });
    }
  });

  it("detects linux platform correctly", () => {
    const originalNavigator = globalThis.navigator;
    try {
      Object.defineProperty(globalThis, "navigator", {
        value: { platform: "Linux x86_64", userAgent: "Mozilla/5.0 (X11; Linux x86_64)" },
        configurable: true,
      });
      expect(getOperatingSystem()).toBe("linux");
      expect(isLinuxPlatform()).toBe(true);
      expect(isMacPlatform()).toBe(false);
      expect(isWindowsPlatform()).toBe(false);
    } finally {
      Object.defineProperty(globalThis, "navigator", {
        value: originalNavigator,
        configurable: true,
      });
    }
  });
});

describe("editor-ui matchesRuntimeKeymap", () => {
  it("matches primary Mod shortcuts on macOS (metaKey) and PC (ctrlKey)", () => {
    // Mac Cmd+B
    expect(
      matchesRuntimeKeymap(
        createKeyboardEvent({ metaKey: true, ctrlKey: false, code: "KeyB", key: "b" }),
        "Mod-B",
      ),
    ).toBe(true);

    // PC Ctrl+B
    expect(
      matchesRuntimeKeymap(
        createKeyboardEvent({ metaKey: false, ctrlKey: true, code: "KeyB", key: "b" }),
        "Mod-B",
      ),
    ).toBe(true);

    // Without Mod modifier
    expect(
      matchesRuntimeKeymap(
        createKeyboardEvent({ metaKey: false, ctrlKey: false, code: "KeyB", key: "b" }),
        "Mod-B",
      ),
    ).toBe(false);
  });

  it("matches Mod-Shift keymaps correctly", () => {
    expect(
      matchesRuntimeKeymap(
        createKeyboardEvent({ metaKey: true, shiftKey: true, code: "KeyB", key: "B" }),
        "Mod-Shift-B",
      ),
    ).toBe(true);

    expect(
      matchesRuntimeKeymap(
        createKeyboardEvent({ metaKey: true, shiftKey: false, code: "KeyB", key: "b" }),
        "Mod-Shift-B",
      ),
    ).toBe(false);
  });

  it("matches Mod-Alt-T even when macOS translates Option+T into special character †", () => {
    expect(
      matchesRuntimeKeymap(
        createKeyboardEvent({
          code: "KeyT",
          key: "†",
          altKey: true,
          metaKey: true,
          shiftKey: false,
          ctrlKey: false,
        }),
        "Mod-Alt-T",
      ),
    ).toBe(true);
  });

  it("matches Mod-Alt-1 even when macOS translates Option+1 into special character ¡", () => {
    expect(
      matchesRuntimeKeymap(
        createKeyboardEvent({
          code: "Digit1",
          key: "¡",
          altKey: true,
          metaKey: true,
          shiftKey: false,
          ctrlKey: false,
        }),
        "Mod-Alt-1",
      ),
    ).toBe(true);
  });

  it("matches punctuation and special keys by code or key", () => {
    expect(
      matchesRuntimeKeymap(
        createKeyboardEvent({ metaKey: true, code: "Slash", key: "/" }),
        "Mod-/",
      ),
    ).toBe(true);

    expect(
      matchesRuntimeKeymap(
        createKeyboardEvent({ metaKey: true, code: "Space", key: " " }),
        "Mod-space",
      ),
    ).toBe(true);

    expect(
      matchesRuntimeKeymap(
        createKeyboardEvent({ metaKey: true, code: "Comma", key: "," }),
        "Mod-,",
      ),
    ).toBe(true);

    expect(
      matchesRuntimeKeymap(
        createKeyboardEvent({ metaKey: true, code: "Period", key: "." }),
        "Mod-.",
      ),
    ).toBe(true);
  });

  it("rejects shortcut matching during IME composition (isComposing or keyCode 229)", () => {
    expect(isComposingKeyboardEvent({ isComposing: true, keyCode: 0 } as KeyboardEvent)).toBe(true);
    expect(isComposingKeyboardEvent({ isComposing: false, keyCode: 229 } as KeyboardEvent)).toBe(
      true,
    );
    expect(isComposingKeyboardEvent({ isComposing: false, keyCode: 66 } as KeyboardEvent)).toBe(
      false,
    );

    expect(
      matchesRuntimeKeymap(
        createKeyboardEvent({ isComposing: true, metaKey: true, code: "KeyB", key: "b" }),
        "Mod-B",
      ),
    ).toBe(false);

    expect(
      matchesRuntimeKeymap(
        createKeyboardEvent({
          isComposing: false,
          keyCode: 229,
          metaKey: true,
          code: "KeyB",
          key: "b",
        } as KeyboardEvent),
        "Mod-B",
      ),
    ).toBe(false);
  });
});
