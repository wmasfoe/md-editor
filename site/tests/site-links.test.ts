import { describe, expect, it } from "vitest";
import {
  APP_DISPLAY_NAME,
  APP_NAME_ZH,
  buildLinuxAppImageUrl,
  buildMacosDmgUrl,
  buildWindowsSetupUrl,
  GITHUB_RELEASES_URL,
  GITHUB_REPO_URL,
  normalizeVersion,
  OFFICIAL_SITE_DOMAIN,
  OFFICIAL_SITE_URL,
} from "../lib/site-links";

describe("site-links", () => {
  it("exposes official site domain and url", () => {
    expect(OFFICIAL_SITE_DOMAIN).toBe("editor.justdev.cn");
    expect(OFFICIAL_SITE_URL).toBe("https://editor.justdev.cn");
  });

  it("exposes project and public release URLs", () => {
    expect(GITHUB_REPO_URL).toBe("https://github.com/wmasfoe/md-editor");
    expect(GITHUB_RELEASES_URL).toBe("https://github.com/wmasfoe/homebrew-tap/releases");
  });

  it("keeps Inkpoint as the wordmark and 墨点 as the Chinese gloss", () => {
    expect(APP_DISPLAY_NAME).toBe("Inkpoint");
    expect(APP_NAME_ZH).toBe("墨点");
  });

  it("normalizes optional v prefix", () => {
    expect(normalizeVersion("0.3.16")).toBe("0.3.16");
    expect(normalizeVersion("v0.3.16")).toBe("0.3.16");
    expect(normalizeVersion("  v1.0.0  ")).toBe("1.0.0");
    expect(normalizeVersion("")).toBeNull();
    expect(normalizeVersion("   ")).toBeNull();
  });

  it("builds stable DMG download URL matching cask naming", () => {
    expect(buildMacosDmgUrl("0.3.16")).toBe(
      "https://github.com/wmasfoe/homebrew-tap/releases/download/md-editor-v0.3.16/Inkpoint_0.3.16_aarch64.dmg",
    );
    expect(buildMacosDmgUrl("v0.3.16")).toBe(
      "https://github.com/wmasfoe/homebrew-tap/releases/download/md-editor-v0.3.16/Inkpoint_0.3.16_aarch64.dmg",
    );
  });

  it("rejects empty version when building DMG url", () => {
    expect(() => buildMacosDmgUrl("")).toThrow(/Invalid macOS DMG version/u);
  });

  it("builds Linux AppImage URLs for x86_64 and aarch64", () => {
    expect(buildLinuxAppImageUrl("0.4.4")).toBe(
      "https://github.com/wmasfoe/homebrew-tap/releases/download/md-editor-v0.4.4/Inkpoint_0.4.4_x86_64.AppImage",
    );
    expect(buildLinuxAppImageUrl("v0.4.4", "aarch64")).toBe(
      "https://github.com/wmasfoe/homebrew-tap/releases/download/md-editor-v0.4.4/Inkpoint_0.4.4_aarch64.AppImage",
    );
  });

  it("builds Windows Setup URLs for x64 and arm64", () => {
    expect(buildWindowsSetupUrl("0.4.4")).toBe(
      "https://github.com/wmasfoe/homebrew-tap/releases/download/md-editor-v0.4.4/Inkpoint_0.4.4_x64-setup.exe",
    );
    expect(buildWindowsSetupUrl("v0.4.4", "arm64")).toBe(
      "https://github.com/wmasfoe/homebrew-tap/releases/download/md-editor-v0.4.4/Inkpoint_0.4.4_arm64-setup.exe",
    );
  });
});
