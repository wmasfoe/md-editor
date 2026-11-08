import { describe, expect, it } from "vitest";
import {
  buildDownloadCatalog,
  getMobileDownloadCatalog,
  getPlatformInstall,
  MACOS_QUARANTINE_COMMAND,
  PUBLISHED_ANDROID_VERSION,
  PUBLISHED_IOS_VERSION,
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

  it("points mobile downloads at the last published packages", () => {
    const zh = getMobileDownloadCatalog("zh");
    expect(zh.android.primary).toEqual({
      href: "https://download.jiaqi.im/inkpoint/android/0.2.1/Inkpoint_0.2.1.apk",
      fileName: "Inkpoint_0.2.1.apk",
      label: "下载 Android",
    });
    expect(zh.android.format).toBe("Android 8.0+ · APK");
    expect(zh.android.version).toBe(PUBLISHED_ANDROID_VERSION);

    expect(zh.ios.primary).toEqual({
      href: "https://download.jiaqi.im/inkpoint/ios/0.2.1/Inkpoint-0.2.1-unsigned.ipa",
      fileName: "Inkpoint-0.2.1-unsigned.ipa",
      label: "下载 iOS",
    });
    expect(zh.ios.format).toBe("iOS 17.0+ · 未签名 IPA");
    expect(zh.ios.version).toBe(PUBLISHED_IOS_VERSION);

    const en = getMobileDownloadCatalog("en");
    expect(en.android.primary.label).toBe("Download for Android");
    expect(en.ios.format).toBe("iOS 17.0+ · Unsigned IPA");

    // 自定义分发域名同样生效
    const custom = getMobileDownloadCatalog("zh", "download.example.com");
    expect(custom.android.primary.href).toBe(
      "https://download.example.com/inkpoint/android/0.2.1/Inkpoint_0.2.1.apk",
    );
  });

  it("includes the published mobile packages in buildDownloadCatalog", () => {
    const catalog = buildDownloadCatalog("0.10.2", "zh");
    expect(catalog.android.isBeta).toBe(false);
    expect(catalog.android.version).toBe(PUBLISHED_ANDROID_VERSION);
    expect(catalog.android.primary.fileName).toBe("Inkpoint_0.2.1.apk");
    expect(catalog.ios.isBeta).toBe(false);
    expect(catalog.ios.primary.fileName).toBe("Inkpoint-0.2.1-unsigned.ipa");
    expect(catalog.iosPackagesUrl).toBe("https://download.jiaqi.im/inkpoint/ios/");

    // 桌面版本缺失时走回退目录，移动端入口仍然可用
    const fallback = buildDownloadCatalog();
    expect(fallback.android.primary.fileName).toBe("Inkpoint_0.2.1.apk");
  });
});
