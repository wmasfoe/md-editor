import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ABOUT_WINDOW_LABEL, resolveDesktopWindowSurface } from "../../src/desktop/window-labels";

const bootstrapSource = readFileSync(
  new URL("../../src/app/platform-bootstrap.ts", import.meta.url),
  "utf8",
);
const mainSource = readFileSync(new URL("../../src/main.tsx", import.meta.url), "utf8");
const libSource = readFileSync(new URL("../../src-tauri/src/lib.rs", import.meta.url), "utf8");
const menuSource = readFileSync(
  new URL("../../src-tauri/src/app_menu.rs", import.meta.url),
  "utf8",
);
const tauriConfig = JSON.parse(
  readFileSync(new URL("../../src-tauri/tauri.conf.json", import.meta.url), "utf8"),
);
const aboutContentSource = readFileSync(
  new URL("../../src/components/about/AboutContent.tsx", import.meta.url),
  "utf8",
);
const aboutWindowAppSource = readFileSync(
  new URL("../../src/app/AboutWindowApp.tsx", import.meta.url),
  "utf8",
);

describe("about window surface routing", () => {
  it("resolves the about window label instead of falling into unknown", () => {
    expect(resolveDesktopWindowSurface("?window=about")).toBe(ABOUT_WINDOW_LABEL);
    expect(resolveDesktopWindowSurface("?window=settings")).toBe("settings");
    expect(resolveDesktopWindowSurface("?window=about")).not.toEqual(
      expect.objectContaining({ kind: "unknown" }),
    );
  });

  it("routes the surface to a dedicated renderer", () => {
    expect(bootstrapSource).toContain("renderAbout");
    expect(bootstrapSource).toContain("ABOUT_WINDOW_LABEL");
    expect(mainSource).toContain("renderAboutSurface");
    expect(mainSource).toContain("AboutWindowApp");
  });
});

describe("about window native wiring", () => {
  it("opens a single about window from the menu item without broadcasting", () => {
    expect(libSource).toContain("mod about_window;");
    expect(libSource).toContain("open_about_window");
    expect(libSource).toContain('if action == "md-editor:about"');
  });

  it("replaces the preset native about panel with a custom menu item", () => {
    expect(menuSource).toContain('MenuItemBuilder::with_id("md-editor:about"');
    // 预置 `.about()` 会再打开系统 NSAboutPanel，形成两个「关于」入口。
    expect(menuSource).not.toContain("AboutMetadataBuilder");
    // 预置项是一个独立语句 `.about(Some(...))`；注释里提到名字不算复现。
    expect(menuSource).not.toMatch(/^\s*\.about\(/mu);
  });

  it("keeps locale detection platform-neutral because the about window uses it", () => {
    // 回归：detect_menu_locale 曾带 macOS cfg，导致 Windows/Linux 构建 E0432。
    expect(menuSource).not.toMatch(
      /#\[cfg\(target_os = "macos"\)\]\s*\n(pub\(crate\) )?fn detect_menu_locale/u,
    );
    expect(menuSource).not.toMatch(
      /#\[cfg\(target_os = "macos"\)\]\s*\n\s*pub\(crate\) enum AppMenuLocale/u,
    );
  });

  it("declares bundle copyright so Info.plist carries the same authorship", () => {
    expect(tauriConfig.bundle.copyright).toContain("Inkpoint Contributors");
  });
});

describe("about content", () => {
  it("shows the app icon, version, highlights, links and copyright", () => {
    expect(aboutContentSource).toContain('src="/logo.png"');
    expect(aboutContentSource).toContain("about.version");
    expect(aboutContentSource).toContain("about.highlightsTitle");
    expect(aboutContentSource).toContain("about.copyright");
    expect(aboutContentSource).toContain("openExternalTarget");
    expect(aboutContentSource).toContain("APP_WEBSITE_URL");
    // 链接集中在 lib/app-links，避免域名散落多处
    expect(aboutContentSource).not.toContain("https://github.com/wmasfoe/md-editor");
    // CSP 为 null 的应用里不引入 HTML 注入面。
    expect(aboutContentSource).not.toContain("dangerouslySetInnerHTML");
  });
});

describe("about window startup", () => {
  it("aligns the persisted language before revealing the window", () => {
    // 回归：i18n 按系统语言自举，而原生窗口标题用持久化语言，不显式对齐会出现标题与正文不同语言。
    expect(aboutWindowAppSource).toContain("changeLanguage(settings.language)");
    const languageCall = aboutWindowAppSource.indexOf("await changeLanguage(settings.language)");
    const revealCall = aboutWindowAppSource.indexOf("disposeTheme = applyThemeBeforeWindowReveal");
    expect(languageCall).toBeGreaterThan(-1);
    expect(revealCall).toBeGreaterThan(languageCall);
  });
});
