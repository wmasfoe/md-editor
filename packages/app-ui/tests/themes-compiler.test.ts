import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  compileThemeCss,
  exportThemePackage,
  importThemePackage,
  ensureWebFont,
  ensureWebFontsForCss,
  resetWebFontCacheForTesting,
  type ThemePackage,
} from "../src/themes";

describe("Style Compiler & Theme Engine", () => {
  it("compiles base theme CSS without overrides", () => {
    const lightCss = compileThemeCss({ baseTheme: "kami-light" });
    expect(lightCss).toContain("--theme-bg: #f5f4ed;");
    expect(lightCss).toContain("--theme-primary: #1B365D;");
    expect(lightCss).toContain("--theme-letter-spacing: 0.02em;");
    expect(lightCss).toContain("--theme-bold-font-weight: 500;");

    const darkCss = compileThemeCss({ baseTheme: "kami-dark" });
    expect(darkCss).toContain("--theme-bg: #141413;");
    expect(darkCss).toContain("--theme-primary: #2D5A8A;");
  });

  it("applies structured color scheme overrides with auto-derived tokens", () => {
    const css = compileThemeCss({
      baseTheme: "kami-light",
      colorScheme: "light",
      lightOverrides: {
        canvasBg: "#fcfbf7",
        primaryColor: "#2a4d80",
        textColor: "#333330",
      },
    });

    expect(css).toContain("--theme-bg: #fcfbf7;");
    expect(css).toContain("--theme-surface: #fcfbf7;");
    expect(css).toContain("--theme-primary: #2a4d80;");
    expect(css).toContain("color-mix(in srgb, #2a4d80 12%, transparent)");
    expect(css).toContain("color-mix(in srgb, #2a4d80 26%, transparent)");
  });

  it("keeps light and dark color overrides separate", () => {
    const lightCss = compileThemeCss({
      baseTheme: "kami-light",
      colorScheme: "light",
      lightOverrides: { canvasBg: "#ffffff" },
      darkOverrides: { canvasBg: "#050505" },
    });
    expect(lightCss).toContain("--theme-bg: #ffffff;");
    expect(lightCss).not.toContain("--theme-bg: #050505;");

    const darkCss = compileThemeCss({
      baseTheme: "kami-dark",
      colorScheme: "dark",
      lightOverrides: { canvasBg: "#ffffff" },
      darkOverrides: { canvasBg: "#050505" },
    });
    expect(darkCss).toContain("--theme-bg: #050505;");
    expect(darkCss).not.toContain("--theme-bg: #ffffff;");
  });

  it("applies typography and geometry overrides", () => {
    const css = compileThemeCss({
      baseTheme: "paper-light",
      typographyOverrides: {
        proseFontFamily: "Charter, serif",
        fontSize: 18,
        lineHeight: 1.7,
        letterSpacing: "0.03em",
        boldFontWeight: 600,
      },
      geometryOverrides: {
        contentMaxWidth: 880,
        borderRadiusPreset: "soft",
        headingDividerStyle: "none",
        blockquoteStyle: "borderless",
        codeBlockStyle: "clean",
      },
    });

    expect(css).toContain("--theme-font: Charter, serif;");
    expect(css).toContain("--theme-editor-font-size: 18px;");
    expect(css).toContain("--theme-editor-line-height: 1.7;");
    expect(css).toContain("--theme-letter-spacing: 0.03em;");
    expect(css).toContain("--theme-bold-font-weight: 600;");
    expect(css).toContain("--theme-content-width: 880px;");
    expect(css).toContain("--theme-radius-base: 12px;");
    expect(css).toContain("--theme-heading-divider: none;");
    expect(css).toContain("--theme-blockquote-border: none;");
    expect(css).toContain("--theme-code-border: transparent;");
  });

  it("appends user custom CSS and sanitizes dangerous style closing tags", () => {
    const css = compileThemeCss({
      baseTheme: "kami-light",
      customCssText: ".custom-class { color: red; } </style><script>alert(1)</script>",
    });

    expect(css).toContain(".custom-class { color: red; }");
    expect(css).not.toContain("</style>");
    expect(css).toContain("<\\/style><script>alert(1)</script>");
  });

  it("supports exporting and importing JSON theme packages", () => {
    const pkg: ThemePackage = {
      schemaVersion: 1,
      id: "my-custom-theme",
      name: "My Custom Theme",
      author: "Test User",
      description: "A test theme",
      baseTheme: "kami-light",
      lightOverrides: {
        canvasBg: "#f8f7f0",
        primaryColor: "#1a365d",
      },
      typographyOverrides: {
        fontSize: 17,
        boldFontWeight: 500,
      },
      geometryOverrides: {
        borderRadiusPreset: "standard",
      },
    };

    const exported = exportThemePackage(pkg);
    expect(typeof exported).toBe("string");

    const result = importThemePackage(exported);
    expect(result.ok).toBe(true);
    const importedPkg = (result as { ok: true; package: ThemePackage }).package;
    expect(importedPkg.id).toBe("my-custom-theme");
    expect(importedPkg.baseTheme).toBe("kami-light");
    expect(importedPkg.lightOverrides?.canvasBg).toBe("#f8f7f0");
    expect(importedPkg.typographyOverrides?.fontSize).toBe(17);
  });

  it("validates malformed theme packages during import", () => {
    expect(importThemePackage("invalid json").ok).toBe(false);
    expect(importThemePackage(JSON.stringify({ schemaVersion: 2 })).ok).toBe(false);
    expect(importThemePackage(JSON.stringify({ schemaVersion: 1, id: "" })).ok).toBe(false);
    expect(importThemePackage(JSON.stringify({ schemaVersion: 1, id: "t1", name: "" })).ok).toBe(
      false,
    );
    expect(importThemePackage(JSON.stringify({ schemaVersion: 1, id: "t1", name: "T1" })).ok).toBe(
      false,
    );
  });
});

describe("WebFont Loader", () => {
  let createdStyles: Array<{ id: string; textContent: string }> = [];

  beforeEach(() => {
    resetWebFontCacheForTesting();
    createdStyles = [];
    const mockDocument = {
      getElementById: (id: string) => createdStyles.find((s) => s.id === id) ?? null,
      createElement: (tagName: string) => {
        const elem = { id: "", textContent: "", tagName };
        return elem;
      },
      head: {
        append: (elem: { id: string; textContent: string }) => {
          createdStyles.push(elem);
        },
      },
    };
    vi.stubGlobal("document", mockDocument);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads TsangerJinKai02 when referenced", () => {
    ensureWebFont("TsangerJinKai02");
    const style = createdStyles.find((s) => s.id === "md-editor-webfonts");
    expect(style).toBeDefined();
    expect(style?.textContent).toContain('font-family: "TsangerJinKai02"');
    expect(style?.textContent).toContain("local(");
  });

  it("scans css and loads registered webfonts idempotently", () => {
    ensureWebFontsForCss("body { font-family: 'TsangerJinKai02', serif; }");
    ensureWebFontsForCss("body { font-family: 'TsangerJinKai02', serif; }");
    const matched = createdStyles.filter((s) => s.id === "md-editor-webfonts");
    expect(matched.length).toBe(1);
    expect(matched[0].textContent).toContain('font-family: "TsangerJinKai02"');
  });

  it("does not throw when document is undefined (SSR safety)", () => {
    vi.unstubAllGlobals();
    expect(() => ensureWebFont("TsangerJinKai02")).not.toThrow();
    expect(() => ensureWebFontsForCss("TsangerJinKai02")).not.toThrow();
  });
});
