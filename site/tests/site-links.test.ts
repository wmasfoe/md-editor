import { describe, expect, it } from "vitest";
import {
  APP_DISPLAY_NAME,
  APP_NAME_ZH,
  buildAcceleratedDesktopUrl,
  buildAndroidApkUrl,
  buildLinuxAppImageUrl,
  buildMacosDmgUrl,
  buildVersionApiUrl,
  buildVersionPackageLinks,
  buildWindowsSetupUrl,
  DISTRIBUTION_DOMAIN,
  DISTRIBUTION_URL,
  GITHUB_RELEASES_URL,
  GITHUB_REPO_URL,
  normalizeVersion,
  OFFICIAL_SITE_DOMAIN,
  OFFICIAL_SITE_URL,
  PLAYGROUND_PATH,
  PLAYGROUND_URL,
  resolveDistributionDomain,
  resolveDistributionUrl,
  resolveReleasesPortalUrl,
} from "../lib/site-links";

describe("site-links", () => {
  it("exposes official site domain and url", () => {
    expect(OFFICIAL_SITE_DOMAIN).toBe("editor.justdev.cn");
    expect(OFFICIAL_SITE_URL).toBe("https://editor.justdev.cn");
  });

  it("exposes playground path and url", () => {
    expect(PLAYGROUND_PATH).toBe("/playground");
    expect(PLAYGROUND_URL).toBe("https://editor.justdev.cn/playground");
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
      "https://download.justdev.cn/inkpoint/desktop/0.3.16/Inkpoint_0.3.16_aarch64.dmg",
    );
    expect(buildMacosDmgUrl("v0.3.16")).toBe(
      "https://download.justdev.cn/inkpoint/desktop/0.3.16/Inkpoint_0.3.16_aarch64.dmg",
    );
  });

  it("rejects empty version when building DMG url", () => {
    expect(() => buildMacosDmgUrl("")).toThrow(/Invalid macOS DMG version/u);
  });

  it("builds Linux AppImage URLs for x86_64 and aarch64", () => {
    expect(buildLinuxAppImageUrl("0.4.4")).toBe(
      "https://download.justdev.cn/inkpoint/desktop/0.4.4/Inkpoint_0.4.4_x86_64.AppImage",
    );
    expect(buildLinuxAppImageUrl("v0.4.4", "aarch64")).toBe(
      "https://download.justdev.cn/inkpoint/desktop/0.4.4/Inkpoint_0.4.4_aarch64.AppImage",
    );
  });

  it("builds Windows Setup URLs for x64 and arm64", () => {
    expect(buildWindowsSetupUrl("0.4.4")).toBe(
      "https://download.justdev.cn/inkpoint/desktop/0.4.4/Inkpoint_0.4.4_x64-setup.exe",
    );
    expect(buildWindowsSetupUrl("v0.4.4", "arm64")).toBe(
      "https://download.justdev.cn/inkpoint/desktop/0.4.4/Inkpoint_0.4.4_arm64-setup.exe",
    );
  });

  it("exposes Cloudflare Worker distribution CDN domain and URLs", () => {
    expect(DISTRIBUTION_DOMAIN).toBe("download.justdev.cn");
    expect(DISTRIBUTION_URL).toBe("https://download.justdev.cn");
    expect(buildAcceleratedDesktopUrl("macos")).toBe(
      "https://download.justdev.cn/inkpoint/desktop/macos/latest",
    );
    expect(buildAcceleratedDesktopUrl("windows")).toBe(
      "https://download.justdev.cn/inkpoint/desktop/windows/latest",
    );
    expect(buildAcceleratedDesktopUrl("linux")).toBe(
      "https://download.justdev.cn/inkpoint/desktop/linux/latest",
    );
    expect(buildAndroidApkUrl()).toBe("https://download.justdev.cn/inkpoint/android/latest");
    expect(buildAndroidApkUrl("0.1.0")).toBe(
      "https://download.justdev.cn/inkpoint/android/0.1.0/Inkpoint_0.1.0.apk",
    );
    expect(buildVersionApiUrl()).toBe("https://download.justdev.cn/api/inkpoint/version.json");
    expect(buildVersionApiUrl("app2")).toBe("https://download.justdev.cn/api/app2/version.json");
  });

  it("resolves distribution domain and portal URLs based on host context", () => {
    // editor.jiaqi.im -> download.jiaqi.im
    expect(resolveDistributionDomain("editor.jiaqi.im")).toBe("download.jiaqi.im");
    expect(resolveDistributionDomain("site.jiaqi.im")).toBe("download.jiaqi.im");
    expect(resolveDistributionUrl("editor.jiaqi.im")).toBe("https://download.jiaqi.im");
    expect(resolveReleasesPortalUrl("editor.jiaqi.im")).toBe("https://download.jiaqi.im");

    // editor.justdev.cn -> download.justdev.cn
    expect(resolveDistributionDomain("editor.justdev.cn")).toBe("download.justdev.cn");
    expect(resolveDistributionUrl("editor.justdev.cn")).toBe("https://download.justdev.cn");
    expect(resolveReleasesPortalUrl("editor.justdev.cn")).toBe("https://download.justdev.cn");

    // generic editor.<domain> mapping
    expect(resolveDistributionDomain("editor.custom.org")).toBe("download.custom.org");

    // default fallback
    expect(resolveDistributionDomain()).toBe("download.justdev.cn");
    expect(resolveDistributionDomain("localhost")).toBe("download.justdev.cn");
  });

  it("supports domain parameter in URL builder functions", () => {
    const customDomain = "download.jiaqi.im";
    expect(buildMacosDmgUrl("0.10.2", customDomain)).toBe(
      "https://download.jiaqi.im/inkpoint/desktop/0.10.2/Inkpoint_0.10.2_aarch64.dmg",
    );
    expect(buildWindowsSetupUrl("0.10.2", "x64", customDomain)).toBe(
      "https://download.jiaqi.im/inkpoint/desktop/0.10.2/Inkpoint_0.10.2_x64-setup.exe",
    );
    expect(buildLinuxAppImageUrl("0.10.2", "x86_64", customDomain)).toBe(
      "https://download.jiaqi.im/inkpoint/desktop/0.10.2/Inkpoint_0.10.2_x86_64.AppImage",
    );
    expect(buildAndroidApkUrl("0.1.0", customDomain)).toBe(
      "https://download.jiaqi.im/inkpoint/android/0.1.0/Inkpoint_0.1.0.apk",
    );
    expect(buildAcceleratedDesktopUrl("macos", customDomain)).toBe(
      "https://download.jiaqi.im/inkpoint/desktop/macos/latest",
    );

    const versionLinks = buildVersionPackageLinks("0.10.2", customDomain);
    expect(versionLinks?.macos.url).toContain("https://download.jiaqi.im/");
  });
});
