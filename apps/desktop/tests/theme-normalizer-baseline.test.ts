import { describe, expect, it, vi, afterEach } from "vitest";
import { normalizeAppTheme, resolveThemeColorScheme } from "../src/app/settings/theme/normalizer";
import { DEFAULT_THEME_SETTINGS } from "../src/app/settings/theme/defaults";

describe("theme normalizer & scheme resolution baseline", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("resolveThemeColorScheme", () => {
    it("resolves explicit light and dark without querying media", () => {
      expect(resolveThemeColorScheme("light")).toBe("light");
      expect(resolveThemeColorScheme("dark")).toBe("dark");
    });

    it("resolves system scheme according to window.matchMedia", () => {
      vi.stubGlobal("window", {
        matchMedia: vi.fn((query: string) => ({
          matches: query.includes("dark"),
        })),
      });
      expect(resolveThemeColorScheme("system")).toBe("dark");

      vi.stubGlobal("window", {
        matchMedia: vi.fn(() => ({
          matches: false,
        })),
      });
      expect(resolveThemeColorScheme("system")).toBe("light");
    });
  });

  describe("normalizeAppTheme", () => {
    it("returns DEFAULT_THEME_SETTINGS for non-record inputs", () => {
      expect(normalizeAppTheme(null)).toEqual(DEFAULT_THEME_SETTINGS);
      expect(normalizeAppTheme(undefined)).toEqual(DEFAULT_THEME_SETTINGS);
      expect(normalizeAppTheme("string")).toEqual(DEFAULT_THEME_SETTINGS);
      expect(normalizeAppTheme(123)).toEqual(DEFAULT_THEME_SETTINGS);
    });

    it("normalizes mode with system fallback", () => {
      expect(normalizeAppTheme({ mode: "light" }).mode).toBe("light");
      expect(normalizeAppTheme({ mode: "dark" }).mode).toBe("dark");
      expect(normalizeAppTheme({ mode: "system" }).mode).toBe("system");
      expect(normalizeAppTheme({ mode: "unknown" }).mode).toBe("system");
    });

    it("migrates legacy lightCssPath and darkCssPath to custom source", () => {
      const normalized = normalizeAppTheme({
        mode: "system",
        lightCssPath: "  /path/to/light.css  ",
        darkCssPath: "/path/to/dark.css",
      });

      expect(normalized.light).toEqual({
        source: "custom",
        builtinTheme: DEFAULT_THEME_SETTINGS.light.builtinTheme,
        customCssPath: "/path/to/light.css",
      });
      expect(normalized.dark).toEqual({
        source: "custom",
        builtinTheme: DEFAULT_THEME_SETTINGS.dark.builtinTheme,
        customCssPath: "/path/to/dark.css",
      });
    });

    it("normalizes built-in theme selection and falls back for unknown IDs", () => {
      const normalized = normalizeAppTheme({
        light: {
          source: "builtin",
          builtinTheme: "kami-light",
        },
        dark: {
          source: "builtin",
          builtinTheme: "kami-dark",
        },
      });

      expect(normalized.light.builtinTheme).toBe("kami-light");
      expect(normalized.dark.builtinTheme).toBe("kami-dark");

      const withFallback = normalizeAppTheme({
        light: {
          source: "builtin",
          builtinTheme: "non-existent-theme",
        },
      });
      expect(withFallback.light.builtinTheme).toBe(DEFAULT_THEME_SETTINGS.light.builtinTheme);
    });

    it("trims customCssPath and maps empty string to null", () => {
      const normalized = normalizeAppTheme({
        light: {
          source: "custom",
          customCssPath: "   ",
        },
        dark: {
          source: "custom",
          customCssPath: " /custom.css ",
        },
      });

      expect(normalized.light.customCssPath).toBeNull();
      expect(normalized.dark.customCssPath).toBe("/custom.css");
    });
  });
});
