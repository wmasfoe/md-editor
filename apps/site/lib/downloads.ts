import type { Locale } from "./i18n/types";
import { SITE_PLATFORMS, type DesktopPlatform, type SitePlatform } from "./platform";
import {
  ANDROID_PORTAL_URL,
  ARTIFACT_NAME_PREFIX,
  buildAndroidApkUrl,
  buildIosIpaUrl,
  buildLinuxAppImageUrl,
  buildMacosDmgUrl,
  buildWindowsSetupUrl,
  DESKTOP_PORTAL_URL,
  GITHUB_RELEASES_URL,
  IOS_PORTAL_URL,
  normalizeVersion,
  RELEASES_PORTAL_URL,
  resolveDevicePortalUrl,
  resolveReleasesPortalUrl,
} from "./site-links";

export const UNIX_INSTALL_COMMAND =
  "curl -fsSL https://download.jiaqi.im/inkpoint/desktop/install.sh | sh";

export const WINDOWS_INSTALL_COMMAND =
  "irm https://download.jiaqi.im/inkpoint/desktop/install.ps1 | iex";

/** 手动安装 DMG 时移除隔离标记；安装脚本会默认处理。 */
export const MACOS_QUARANTINE_COMMAND = "xattr -dr com.apple.quarantine /Applications/Inkpoint.app";

export type DownloadAsset = {
  href: string;
  label: string;
  fileName?: string;
};

export type PlatformDownload = {
  primary: DownloadAsset;
  /** 按钮下方的格式说明，例如 "Apple Silicon · DMG" */
  format: string;
  secondary: DownloadAsset[];
  version?: string;
  isBeta?: boolean;
};

export type DownloadCatalog = Record<SitePlatform, PlatformDownload> & {
  allPackagesUrl: string;
  desktopPackagesUrl: string;
  androidPackagesUrl: string;
  iosPackagesUrl: string;
};

export type PlatformInstall = {
  title: string;
  command: string;
  recommended: boolean;
  extra?: { title: string; command: string };
};

const INSTALL_BY_PLATFORM_ZH: Record<"macos" | "linux" | "windows", PlatformInstall> = {
  macos: {
    title: "终端一键安装",
    command: UNIX_INSTALL_COMMAND,
    recommended: true,
    extra: {
      title: "若提示「已损坏」，移除隔离标记",
      command: MACOS_QUARANTINE_COMMAND,
    },
  },
  linux: {
    title: "终端一键安装",
    command: UNIX_INSTALL_COMMAND,
    recommended: true,
  },
  windows: {
    title: "PowerShell 一键安装",
    command: WINDOWS_INSTALL_COMMAND,
    recommended: false,
  },
};

const INSTALL_BY_PLATFORM_ZH_HANT: Record<"macos" | "linux" | "windows", PlatformInstall> = {
  macos: {
    title: "終端機一鍵安裝",
    command: UNIX_INSTALL_COMMAND,
    recommended: true,
    extra: {
      title: "若提示「已損壞」，移除隔離標記",
      command: MACOS_QUARANTINE_COMMAND,
    },
  },
  linux: {
    title: "終端機一鍵安裝",
    command: UNIX_INSTALL_COMMAND,
    recommended: true,
  },
  windows: {
    title: "PowerShell 一鍵安裝",
    command: WINDOWS_INSTALL_COMMAND,
    recommended: false,
  },
};

const INSTALL_BY_PLATFORM_JA: Record<"macos" | "linux" | "windows", PlatformInstall> = {
  macos: {
    title: "ターミナルからワンクリックでインストール",
    command: UNIX_INSTALL_COMMAND,
    recommended: true,
    extra: {
      title: "「壊れているため開けません」と表示される場合は検疫属性を解除",
      command: MACOS_QUARANTINE_COMMAND,
    },
  },
  linux: {
    title: "ターミナルからワンクリックでインストール",
    command: UNIX_INSTALL_COMMAND,
    recommended: true,
  },
  windows: {
    title: "PowerShell からワンクリックでインストール",
    command: WINDOWS_INSTALL_COMMAND,
    recommended: false,
  },
};

const INSTALL_BY_PLATFORM_EN: Record<"macos" | "linux" | "windows", PlatformInstall> = {
  macos: {
    title: "One-line Terminal Install",
    command: UNIX_INSTALL_COMMAND,
    recommended: true,
    extra: {
      title: 'If prompted "damaged", remove quarantine attribute',
      command: MACOS_QUARANTINE_COMMAND,
    },
  },
  linux: {
    title: "One-line Terminal Install",
    command: UNIX_INSTALL_COMMAND,
    recommended: true,
  },
  windows: {
    title: "PowerShell One-line Install",
    command: WINDOWS_INSTALL_COMMAND,
    recommended: false,
  },
};

const INSTALL_BY_PLATFORM_BY_LOCALE: Record<
  Locale,
  Record<"macos" | "linux" | "windows", PlatformInstall>
> = {
  zh: INSTALL_BY_PLATFORM_ZH,
  "zh-Hant": INSTALL_BY_PLATFORM_ZH_HANT,
  ja: INSTALL_BY_PLATFORM_JA,
  en: INSTALL_BY_PLATFORM_EN,
};

const DOWNLOAD_LABELS: Record<
  Locale,
  {
    macos: string;
    linux: string;
    windows: string;
    windowsArm64: string;
    androidPrimary: string;
    iosPrimary: string;
    /** 按钮下方的格式说明，`{version}` 之外不含变量 */
    androidFormat: string;
    iosFormat: string;
  }
> = {
  zh: {
    macos: "下载 macOS",
    linux: "下载 Linux",
    windows: "下载 Windows",
    windowsArm64: "ARM64 安装包",
    androidPrimary: "下载 Android",
    iosPrimary: "下载 iOS",
    androidFormat: "Android 8.0+ · APK",
    iosFormat: "iOS 17.0+ · 未签名 IPA",
  },
  "zh-Hant": {
    macos: "下載 macOS",
    linux: "下載 Linux",
    windows: "下載 Windows",
    windowsArm64: "ARM64 安裝套件",
    androidPrimary: "下載 Android",
    iosPrimary: "下載 iOS",
    androidFormat: "Android 8.0+ · APK",
    iosFormat: "iOS 17.0+ · 未簽名 IPA",
  },
  ja: {
    macos: "macOS 版をダウンロード",
    linux: "Linux 版をダウンロード",
    windows: "Windows 版をダウンロード",
    windowsArm64: "ARM64 インストーラー",
    androidPrimary: "Android 版をダウンロード",
    iosPrimary: "iOS 版をダウンロード",
    androidFormat: "Android 8.0+ · APK",
    iosFormat: "iOS 17.0+ · 未署名 IPA",
  },
  en: {
    macos: "Download for macOS",
    linux: "Download for Linux",
    windows: "Download for Windows",
    windowsArm64: "ARM64 Setup",
    androidPrimary: "Download for Android",
    iosPrimary: "Download for iOS",
    androidFormat: "Android 8.0+ · APK",
    iosFormat: "iOS 17.0+ · Unsigned IPA",
  },
};

/**
 * 移动端已停止发版，官网只提供已经发布的最后一个版本。
 * 版本号固定在这里，不再从 CHANGELOG 或工程文件推导。
 */
export const PUBLISHED_ANDROID_VERSION = "0.2.1";

export const PUBLISHED_IOS_VERSION = "0.2.1";

/** 按版本和语言构造多平台主下载与次要架构入口；移动端排在最后，只提供已发布的最后一个版本。 */
export function buildDownloadCatalog(
  version?: string,
  locale: Locale = "zh",
  domain?: string,
): DownloadCatalog {
  const normalized = version ? normalizeVersion(version) : null;
  const labels = DOWNLOAD_LABELS[locale] ?? DOWNLOAD_LABELS.en;
  const mobile = getMobileDownloadCatalog(locale, domain);

  if (!normalized) {
    return fallbackCatalog(locale, domain);
  }

  const allPackagesUrl = domain ? resolveReleasesPortalUrl(domain) : RELEASES_PORTAL_URL;
  const desktopPackagesUrl = domain
    ? resolveDevicePortalUrl("desktop", domain)
    : DESKTOP_PORTAL_URL;
  const androidPackagesUrl = domain
    ? resolveDevicePortalUrl("android", domain)
    : ANDROID_PORTAL_URL;
  const iosPackagesUrl = domain ? resolveDevicePortalUrl("ios", domain) : IOS_PORTAL_URL;

  return {
    macos: {
      primary: {
        href: buildMacosDmgUrl(normalized, domain),
        fileName: `${ARTIFACT_NAME_PREFIX}_${normalized}_aarch64.dmg`,
        label: labels.macos,
      },
      format: "Apple Silicon · DMG",
      secondary: [],
      version: normalized,
      isBeta: false,
    },
    linux: {
      primary: {
        href: buildLinuxAppImageUrl(normalized, "amd64", domain),
        fileName: `${ARTIFACT_NAME_PREFIX}_${normalized}_amd64.AppImage`,
        label: labels.linux,
      },
      format: "x86_64 · AppImage",
      secondary: [
        {
          href: buildLinuxAppImageUrl(normalized, "aarch64", domain),
          fileName: `${ARTIFACT_NAME_PREFIX}_${normalized}_aarch64.AppImage`,
          label: "ARM64 AppImage",
        },
      ],
      version: normalized,
      isBeta: false,
    },
    windows: {
      primary: {
        href: buildWindowsSetupUrl(normalized, "x64", domain),
        fileName: `${ARTIFACT_NAME_PREFIX}_${normalized}_x64-setup.exe`,
        label: labels.windows,
      },
      format: "x64 · Setup",
      secondary: [
        {
          href: buildWindowsSetupUrl(normalized, "arm64", domain),
          fileName: `${ARTIFACT_NAME_PREFIX}_${normalized}_arm64-setup.exe`,
          label: labels.windowsArm64,
        },
      ],
      version: normalized,
      isBeta: false,
    },
    android: {
      primary: mobile.android.primary,
      format: mobile.android.format,
      secondary: mobile.android.secondary,
      version: mobile.android.version,
      isBeta: false,
    },
    ios: {
      primary: mobile.ios.primary,
      format: mobile.ios.format,
      secondary: mobile.ios.secondary,
      version: mobile.ios.version,
      isBeta: false,
    },
    allPackagesUrl,
    desktopPackagesUrl,
    androidPackagesUrl,
    iosPackagesUrl,
  };
}

export function getPlatformInstall(platform: DesktopPlatform, locale?: Locale): PlatformInstall;
export function getPlatformInstall(platform: SitePlatform, locale?: Locale): PlatformInstall | null;
export function getPlatformInstall(
  platform: SitePlatform,
  locale: Locale = "zh",
): PlatformInstall | null {
  const table = INSTALL_BY_PLATFORM_BY_LOCALE[locale] ?? INSTALL_BY_PLATFORM_EN;
  return (table as Record<string, PlatformInstall>)[platform] ?? null;
}

export function getPrimaryDownload(
  catalog: DownloadCatalog,
  platform: SitePlatform,
): DownloadAsset {
  return catalog[platform].primary;
}

function fallbackPrimary(label: string, format: string): PlatformDownload {
  return {
    primary: { href: GITHUB_RELEASES_URL, label },
    format,
    secondary: [],
  };
}

function fallbackCatalog(locale: Locale = "zh", domain?: string): DownloadCatalog {
  const labels = DOWNLOAD_LABELS[locale] ?? DOWNLOAD_LABELS.en;
  const mobile = getMobileDownloadCatalog(locale, domain);
  const allPackagesUrl = domain ? resolveReleasesPortalUrl(domain) : RELEASES_PORTAL_URL;
  const desktopPackagesUrl = domain
    ? resolveDevicePortalUrl("desktop", domain)
    : DESKTOP_PORTAL_URL;
  const androidPackagesUrl = domain
    ? resolveDevicePortalUrl("android", domain)
    : ANDROID_PORTAL_URL;
  const iosPackagesUrl = domain ? resolveDevicePortalUrl("ios", domain) : IOS_PORTAL_URL;
  return {
    macos: fallbackPrimary(labels.macos, "Apple Silicon · DMG"),
    linux: fallbackPrimary(labels.linux, "x86_64 · AppImage"),
    windows: fallbackPrimary(labels.windows, "x64 · Setup"),
    android: {
      primary: mobile.android.primary,
      format: mobile.android.format,
      secondary: mobile.android.secondary,
      version: mobile.android.version,
      isBeta: false,
    },
    ios: {
      primary: mobile.ios.primary,
      format: mobile.ios.format,
      secondary: mobile.ios.secondary,
      version: mobile.ios.version,
      isBeta: false,
    },
    allPackagesUrl,
    desktopPackagesUrl,
    androidPackagesUrl,
    iosPackagesUrl,
  };
}

export function listSitePlatforms(): SitePlatform[] {
  return [...SITE_PLATFORMS];
}

export interface MobilePlatformDownload {
  android: {
    primary: DownloadAsset;
    format: string;
    secondary: DownloadAsset[];
    version: string;
  };
  ios: {
    primary: DownloadAsset;
    format: string;
    secondary: DownloadAsset[];
    version: string;
  };
}

/**
 * 构造移动端（Android / iOS）下载目录。
 * 指向已发布的最后一个版本的归档直链；之后的版本需要自行编译。
 */
export function getMobileDownloadCatalog(
  locale: Locale = "zh",
  domain?: string,
): MobilePlatformDownload {
  const labels = DOWNLOAD_LABELS[locale] ?? DOWNLOAD_LABELS.en;
  const androidFileName = `${ARTIFACT_NAME_PREFIX}_${PUBLISHED_ANDROID_VERSION}.apk`;
  const iosFileName = `${ARTIFACT_NAME_PREFIX}-${PUBLISHED_IOS_VERSION}-unsigned.ipa`;
  return {
    android: {
      primary: {
        href: buildAndroidApkUrl(PUBLISHED_ANDROID_VERSION, domain),
        fileName: androidFileName,
        label: labels.androidPrimary,
      },
      format: labels.androidFormat,
      secondary: [],
      version: PUBLISHED_ANDROID_VERSION,
    },
    ios: {
      primary: {
        href: buildIosIpaUrl(PUBLISHED_IOS_VERSION, domain),
        fileName: iosFileName,
        label: labels.iosPrimary,
      },
      format: labels.iosFormat,
      secondary: [],
      version: PUBLISHED_IOS_VERSION,
    },
  };
}
