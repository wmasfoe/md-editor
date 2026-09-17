import { describe, expect, it } from "vitest";
import {
  buildDownloadCatalog,
  getMobileDownloadCatalog,
  getPlatformInstall,
  MACOS_QUARANTINE_COMMAND,
  UNIX_INSTALL_COMMAND,
  WINDOWS_INSTALL_COMMAND,
} from "../lib/downloads";
import { GITHUB_RELEASES_URL, RELEASES_PORTAL_URL } from "../lib/site-links";

describe("buildDownloadCatalog", () => {
  it("builds per-platform primary assets for a stable version", () => {
    const catalog = buildDownloadCatalog("v0.4.4");

    expect(catalog.macos.primary).toEqual({
      href: "https://download.justdev.cn/inkpoint/desktop/0.4.4/Inkpoint_0.4.4_aarch64.dmg",
      fileName: "Inkpoint_0.4.4_aarch64.dmg",
      label: "下载 macOS",
    });
    expect(catalog.linux.primary.fileName).toBe("Inkpoint_0.4.4_x86_64.AppImage");
    expect(catalog.linux.secondary).toEqual([
      {
        href: "https://download.justdev.cn/inkpoint/desktop/0.4.4/Inkpoint_0.4.4_aarch64.AppImage",
        fileName: "Inkpoint_0.4.4_aarch64.AppImage",
        label: "ARM64 AppImage",
      },
    ]);
    expect(catalog.windows.primary.fileName).toBe("Inkpoint_0.4.4_x64-setup.exe");
    expect(catalog.windows.secondary[0]?.fileName).toBe("Inkpoint_0.4.4_arm64-setup.exe");
    expect(catalog.allPackagesUrl).toBe(RELEASES_PORTAL_URL);
  });

  it("falls back to the public releases list when version is missing", () => {
    const catalog = buildDownloadCatalog();
    expect(catalog.macos.primary.href).toBe(GITHUB_RELEASES_URL);
    expect(catalog.macos.primary.fileName).toBeUndefined();
    expect(catalog.linux.secondary).toEqual([]);
    expect(catalog.windows.secondary).toEqual([]);
  });
});

describe("getPlatformInstall", () => {
  it("shares the unix script on macOS and Linux, and folds quarantine into macOS extra", () => {
    expect(getPlatformInstall("macos")).toMatchObject({
      command: UNIX_INSTALL_COMMAND,
      recommended: true,
      extra: { command: MACOS_QUARANTINE_COMMAND },
    });
    expect(getPlatformInstall("linux")?.command).toBe(UNIX_INSTALL_COMMAND);
    expect(getPlatformInstall("linux")?.extra).toBeUndefined();
    expect(getPlatformInstall("windows")).toEqual({
      title: "PowerShell 一键安装",
      command: WINDOWS_INSTALL_COMMAND,
      recommended: false,
    });
    expect(getPlatformInstall("android")).toBeNull();
    expect(getPlatformInstall("ios")).toBeNull();
  });

  it("builds mobile download catalog with Android APK and iOS TestFlight", () => {
    const zh = getMobileDownloadCatalog("zh");
    expect(zh.android.primary.href).toBe(
      "https://download.justdev.cn/inkpoint/android/0.1.1/Inkpoint_0.1.1.apk",
    );
    expect(zh.android.primary.label).toBe("下载 Android 安装包 (APK)");
    expect(zh.android.format).toBe("Android 8.0+ · APK · 测试版");
    expect(zh.android.version).toBe("0.1.1");
    expect(zh.ios.primary.href).toContain("testflight.apple.com");
    expect(zh.ios.format).toBe("iOS 16.0+ · TestFlight · 测试版");

    const custom = getMobileDownloadCatalog("zh", undefined, "0.1.0");
    expect(custom.android.primary.href).toBe(
      "https://download.justdev.cn/inkpoint/android/0.1.0/Inkpoint_0.1.0.apk",
    );
    expect(custom.android.version).toBe("0.1.0");

    const en = getMobileDownloadCatalog("en");
    expect(en.android.primary.label).toBe("Download Android APK (Beta)");
    expect(en.ios.primary.label).toBe("Join iOS TestFlight (Beta)");
    expect(en.android.format).toBe("Android 8.0+ · APK · Beta");
    expect(en.ios.format).toBe("iOS 16.0+ · TestFlight · Beta");
  });

  it("includes mobile beta platforms in buildDownloadCatalog", () => {
    const catalog = buildDownloadCatalog("0.10.2", "zh", undefined, "0.1.1");
    expect(catalog.android.isBeta).toBe(true);
    expect(catalog.android.version).toBe("0.1.1");
    expect(catalog.android.primary.fileName).toBe("Inkpoint_0.1.1.apk");
    expect(catalog.android.format).toBe("Android 8.0+ · APK · 测试版");
    expect(catalog.ios.isBeta).toBe(true);
    expect(catalog.ios.version).toBe("0.1.0");
    expect(catalog.ios.format).toBe("iOS 16.0+ · TestFlight · 测试版");
  });
});
