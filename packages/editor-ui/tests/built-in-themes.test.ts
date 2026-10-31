import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BUILT_IN_DARK_THEME_OPTIONS,
  BUILT_IN_LIGHT_THEME_OPTIONS,
  builtInThemeCss,
  setThemeStyleText,
  type BuiltInThemeId,
} from "../src/themes/built-in-themes";

const ALL_BUILT_IN_THEME_IDS: readonly BuiltInThemeId[] = [
  "paper-light",
  "kami-light",
  "github-light",
  "gothic-light",
  "charcoal-dark",
  "kami-dark",
  "night-dark",
];

const REQUIRED_THEME_TOKENS: readonly string[] = [
  "--theme-bg",
  "--theme-surface",
  "--theme-text",
  "--theme-title",
  "--theme-muted",
  "--theme-border",
  "--theme-border-strong",
  "--theme-primary",
  "--theme-primary-fill",
  "--theme-primary-soft",
  "--theme-primary-selected",
  "--theme-code",
  "--theme-code-bg",
  "--theme-code-border",
  "--theme-inline-code-bg",
  "--theme-font",
  "--theme-mono-font",
];

describe("built-in-themes baseline characterization", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("exports exact light and dark built-in theme options", () => {
    expect(BUILT_IN_LIGHT_THEME_OPTIONS.map((opt) => opt.id)).toEqual([
      "paper-light",
      "kami-light",
      "github-light",
      "gothic-light",
    ]);
    expect(BUILT_IN_DARK_THEME_OPTIONS.map((opt) => opt.id)).toEqual([
      "charcoal-dark",
      "kami-dark",
      "night-dark",
    ]);

    for (const opt of [...BUILT_IN_LIGHT_THEME_OPTIONS, ...BUILT_IN_DARK_THEME_OPTIONS]) {
      expect(opt.id).toBeTruthy();
      expect(opt.label).toBeTruthy();
    }
  });

  it("generates CSS strings satisfying core token contract for all 5 themes", () => {
    for (const id of ALL_BUILT_IN_THEME_IDS) {
      const css = builtInThemeCss(id);
      expect(typeof css).toBe("string");
      expect(css.length).toBeGreaterThan(100);
      expect(css).toContain(":root {");

      for (const token of REQUIRED_THEME_TOKENS) {
        expect(css).toContain(`${token}:`);
      }
    }
  });

  it("sets correct color-scheme in each built-in theme", () => {
    expect(builtInThemeCss("paper-light")).toContain("color-scheme: light;");
    expect(builtInThemeCss("kami-light")).toContain("color-scheme: light;");
    expect(builtInThemeCss("github-light")).toContain("color-scheme: light;");
    expect(builtInThemeCss("gothic-light")).toContain("color-scheme: light;");

    expect(builtInThemeCss("charcoal-dark")).toContain("color-scheme: dark;");
    expect(builtInThemeCss("kami-dark")).toContain("color-scheme: dark;");
    expect(builtInThemeCss("night-dark")).toContain("color-scheme: dark;");
  });

  it("handles undefined document gracefully without throwing (SSR)", () => {
    vi.stubGlobal("document", undefined);
    expect(() => setThemeStyleText(":root { --theme-bg: #fff; }")).not.toThrow();
  });

  it("mounts and updates #md-editor-custom-theme style tag idempotently in DOM", () => {
    const elements = new Map<string, { id: string; textContent: string }>();
    const appendFn = vi.fn((el: { id: string; textContent: string }) => {
      elements.set(el.id, el);
    });

    vi.stubGlobal("document", {
      getElementById: vi.fn((id: string) => elements.get(id) ?? null),
      createElement: vi.fn((tag: string) => ({ id: "", tag, textContent: "" })),
      head: { append: appendFn },
    });

    const sampleCss1 = ":root { --theme-bg: #f7f5f0; }";
    setThemeStyleText(sampleCss1);

    expect(appendFn).toHaveBeenCalledOnce();
    const createdStyle = elements.get("md-editor-custom-theme");
    expect(createdStyle).toBeDefined();
    expect(createdStyle?.textContent).toBe(sampleCss1);

    // 相同内容不重复修改
    setThemeStyleText(sampleCss1);
    expect(appendFn).toHaveBeenCalledOnce();
    expect(createdStyle?.textContent).toBe(sampleCss1);

    // 更新为新内容
    const sampleCss2 = ":root { --theme-bg: #1b1815; }";
    setThemeStyleText(sampleCss2);
    expect(createdStyle?.textContent).toBe(sampleCss2);
  });
});
