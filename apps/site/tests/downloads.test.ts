import { describe, expect, it } from "vitest";
import {
  ANDROID_SOURCE_GUIDE_URL,
  buildDownloadCatalog,
  getMobileDownloadCatalog,
  getPlatformInstall,
  IOS_SOURCE_GUIDE_URL,
  MACOS_QUARANTINE_COMMAND,
  UNIX_INSTALL_COMMAND,
  WINDOWS_INSTALL_COMMAND,
} from "../lib/downloads";
import { GITHUB_RELEASES_URL, RELEASES_PORTAL_URL } from "../lib/site-links";

describe("buildDownloadCatalog", () => {
  it("builds per-platform primary assets for a stable version", () => {
    const catalog = buildDownloadCatalog("v0.4.4");

    expect(catalog.macos.primary).toEqual({
      href: "https://download.jiaqi.im/inkpoint/desktop/0.4.4/Inkpoint_0.4.4_aarch64.dmg",
      fileName: "Inkpoint_0.4.4_aarch64.dmg",
      label: "下载 macOS",
    });
    expect(catalog.linux.primary.fileName).toBe("Inkpoint_0.4.4_amd64.AppImage");
    expect(catalog.linux.secondary).toEqual([
      {
        href: "https://download.jiaqi.im/inkpoint/desktop/0.4.4/Inkpoint_0.4.4_aarch64.AppImage",
        fileName: "Inkpoint_0.4.4_aarch64.AppImage",
        label: "ARM64 AppImage",
      },
    ]);
    expect(catalog.windows.primary.fileName).toBe("Inkpoint_0.4.4_x64-setup.exe");
    expect(catalog.windows.secondary[0]?.fileName).toBe("Inkpoint_0.4.4_arm64-setup.exe");
    expect(catalog.allPackagesUrl).toBe(RELEASES_PORTAL_URL);
    expect(catalog.desktopPackagesUrl).toBe("https://download.jiaqi.im/inkpoint/desktop/");
    expect(catalog.androidPackagesUrl).toBe("https://download.jiaqi.im/inkpoint/android/");
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

  it("builds mobile download catalog directing to source build guides", () => {
    const zh = getMobileDownloadCatalog("zh");
    expect(zh.android.primary.href).toBe(ANDROID_SOURCE_GUIDE_URL);
    expect(zh.android.primary.label).toBe("查看 Android 源码编译说明");
    expect(zh.android.primary.fileName).toBeUndefined();
    expect(zh.android.format).toBe("Android 8.0+ · 暂无安装包 · 需自行编译源码");
    expect(zh.android.version).toBe("0.2.1");
    expect(zh.android.secondary).toEqual([]);

    expect(zh.ios.primary.href).toBe(IOS_SOURCE_GUIDE_URL);
    expect(zh.ios.primary.label).toBe("查看 iOS 源码编译说明");
    expect(zh.ios.primary.fileName).toBeUndefined();
    expect(zh.ios.format).toBe("iOS 17.0+ · 暂无安装包 · 需自行编译源码");
    expect(zh.ios.version).toBe("0.2.1");
    expect(zh.ios.secondary).toEqual([]);

    const custom = getMobileDownloadCatalog("zh", undefined, "0.1.0", "0.1.0");
    expect(custom.android.primary.href).toBe(ANDROID_SOURCE_GUIDE_URL);
    expect(custom.android.version).toBe("0.1.0");
    expect(custom.ios.version).toBe("0.1.0");
    expect(custom.ios.primary.href).toBe(IOS_SOURCE_GUIDE_URL);

    const en = getMobileDownloadCatalog("en");
    expect(en.android.primary.label).toBe("View Android Build Guide");
    expect(en.ios.primary.label).toBe("View iOS Build Guide");
    expect(en.android.format).toBe("Android 8.0+ · No pre-built package · Build from source");
    expect(en.ios.format).toBe("iOS 17.0+ · No pre-built package · Build from source");
  });

  it("includes mobile source platforms in buildDownloadCatalog", () => {
    const catalog = buildDownloadCatalog("0.10.2", "zh", undefined, "0.1.1", "0.2.1");
    expect(catalog.android.isBeta).toBe(true);
    expect(catalog.android.version).toBe("0.1.1");
    expect(catalog.android.primary.href).toBe(ANDROID_SOURCE_GUIDE_URL);
    expect(catalog.android.primary.fileName).toBeUndefined();
    expect(catalog.android.format).toBe("Android 8.0+ · 暂无安装包 · 需自行编译源码");
    expect(catalog.ios.isBeta).toBe(true);
    expect(catalog.ios.version).toBe("0.2.1");
    expect(catalog.ios.primary.href).toBe(IOS_SOURCE_GUIDE_URL);
    expect(catalog.ios.primary.fileName).toBeUndefined();
    expect(catalog.ios.format).toBe("iOS 17.0+ · 暂无安装包 · 需自行编译源码");
    // iOS 全部版本入口指向分发网关的 ios 目录
    expect(catalog.iosPackagesUrl).toBe("https://download.jiaqi.im/inkpoint/ios/");
  });
});
