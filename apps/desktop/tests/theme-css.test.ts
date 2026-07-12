import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_THEME_SETTINGS } from "../src/app/settings/app-settings";
import { applyCustomThemeCss } from "../src/app/settings/theme-css";

describe("theme CSS application", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("removes system color-scheme listeners when the theme application is disposed", () => {
    const { dispatchSystemSchemeChange, setSystemDark, target } = installThemeDom({ dark: true });

    const dispose = applyCustomThemeCss(DEFAULT_THEME_SETTINGS, { target });
    expect(target.dataset.themeScheme).toBe("dark");
    expect(target.dataset.themeBuiltin).toBe("night-dark");

    dispose();
    setSystemDark(false);
    dispatchSystemSchemeChange();

    expect(target.dataset.themeScheme).toBe("dark");
    expect(target.dataset.themeBuiltin).toBe("night-dark");
  });
});

function installThemeDom({ dark }: { readonly dark: boolean }) {
  let isDark = dark;
  const listeners = new Set<() => void>();
  const elements = new Map<string, { id: string; textContent: string }>();
  const target = { dataset: {} } as HTMLElement;

  const mediaQuery = {
    get matches() {
      return isDark;
    },
    addEventListener: vi.fn((_event: "change", listener: () => void) => {
      listeners.add(listener);
    }),
    removeEventListener: vi.fn((_event: "change", listener: () => void) => {
      listeners.delete(listener);
    }),
  };

  vi.stubGlobal("window", {
    matchMedia: vi.fn(() => mediaQuery),
  });
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
    dispatchSystemSchemeChange: () => {
      for (const listener of listeners) listener();
    },
    setSystemDark: (next: boolean) => {
      isDark = next;
    },
    target,
  };
}
