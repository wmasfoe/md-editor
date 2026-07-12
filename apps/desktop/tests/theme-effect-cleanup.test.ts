import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const settingsContextSource = readFileSync(
  new URL("../src/app/settings-context.tsx", import.meta.url),
  "utf8",
);
const settingsControllerSource = readFileSync(
  new URL("../src/app/controller/useSettingsController.ts", import.meta.url),
  "utf8",
);
const appSource = readFileSync(new URL("../src/app/App.tsx", import.meta.url), "utf8");
const desktopStyles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

describe("theme effect cleanup wiring", () => {
  it("disposes the main-window theme application before applying a new preview", () => {
    expect(settingsContextSource).toContain(
      "return applyCustomThemeCss(previewTheme ?? settings.theme);",
    );
  });

  it("disposes the settings-window draft theme application before applying the next draft", () => {
    expect(settingsControllerSource).toContain("initialTheme.dispose();");
    expect(settingsControllerSource).toContain("return applyCustomThemeCss(themeDraft);");
  });

  it("clears the temporary theme preview when settings are cancelled", () => {
    expect(settingsControllerSource).toContain("themePreviewSession.publish(null)");
  });

  it("clears the temporary theme preview after settings are saved", () => {
    expect(
      settingsControllerSource.match(/themePreviewSession\.publish\(null\)/gu)?.length,
    ).toBeGreaterThanOrEqual(2);
  });

  it("waits for loaded settings before initializing the settings-window drafts", () => {
    expect(settingsControllerSource).toContain("if (!hasLoadedSettings) return;");
    expect(appSource).toContain("hasLoadedSettings ? (");
    expect(appSource).toContain('<SettingsPage surface="settings-window"');
  });

  it("reveals the native settings window only after applying its loaded theme", () => {
    expect(settingsControllerSource).toContain("useLayoutEffect");
    expect(settingsControllerSource).toContain("applyThemeBeforeWindowReveal(");
    expect(settingsControllerSource).toContain("revealCurrentSettingsWindow,");
  });

  it("reloads persisted settings before ending a theme preview session", () => {
    expect(settingsContextSource).toContain("createAppThemePreviewCoordinator({");
    expect(settingsContextSource).toContain("loadPersistedSettings: loadAppSettings,");
  });

  it("keeps the first paint dark when the system is dark before saved settings load", () => {
    expect(desktopStyles).toContain("@media (prefers-color-scheme: dark)");
    expect(desktopStyles).toContain("color-scheme: dark;");
    expect(desktopStyles).toContain("--theme-bg: #0b0d10;");
  });
});
