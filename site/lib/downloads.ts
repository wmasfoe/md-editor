import type { Locale } from "./i18n/types";
import { SITE_PLATFORMS, type DesktopPlatform, type SitePlatform } from "./platform";
import {
  ANDROID_PORTAL_URL,
  ARTIFACT_NAME_PREFIX,
  buildAndroidApkUrl,
  buildLinuxAppImageUrl,
  buildMacosDmgUrl,
  buildWindowsSetupUrl,
  DESKTOP_PORTAL_URL,
  GITHUB_RELEASES_URL,
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

export const DEFAULT_ANDROID_VERSION = "0.1.1";

/** 按版本和语言构造多平台主下载与次要架构入口；移动端排在最后并标明测试版状态。 */
export function buildDownloadCatalog(
  version?: string,
  locale: Locale = "zh",
  domain?: string,
  androidVersion?: string,
): DownloadCatalog {
  const normalized = version ? normalizeVersion(version) : null;
  const isEn = locale === "en";
  const mobile = getMobileDownloadCatalog(locale, domain, androidVersion);

  if (!normalized) {
    return fallbackCatalog(locale, domain, androidVersion);
  }

  const allPackagesUrl = domain ? resolveReleasesPortalUrl(domain) : RELEASES_PORTAL_URL;
  const desktopPackagesUrl = domain
    ? resolveDevicePortalUrl("desktop", domain)
    : DESKTOP_PORTAL_URL;
  const androidPackagesUrl = domain
    ? resolveDevicePortalUrl("android", domain)
    : ANDROID_PORTAL_URL;

  return {
    macos: {
      primary: {
        href: buildMacosDmgUrl(normalized, domain),
        fileName: `${ARTIFACT_NAME_PREFIX}_${normalized}_aarch64.dmg`,
        label: isEn ? "Download for macOS" : "下载 macOS",
      },
      format: "Apple Silicon · DMG",
      secondary: [],
      version: normalized,
      isBeta: false,
    },
    linux: {
      primary: {
        href: buildLinuxAppImageUrl(normalized, "x86_64", domain),
        fileName: `${ARTIFACT_NAME_PREFIX}_${normalized}_x86_64.AppImage`,
        label: isEn ? "Download for Linux" : "下载 Linux",
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
        label: isEn ? "Download for Windows" : "下载 Windows",
      },
      format: "x64 · Setup",
      secondary: [
        {
          href: buildWindowsSetupUrl(normalized, "arm64", domain),
          fileName: `${ARTIFACT_NAME_PREFIX}_${normalized}_arm64-setup.exe`,
          label: isEn ? "ARM64 Setup" : "ARM64 安装包",
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
      isBeta: true,
    },
    ios: {
      primary: mobile.ios.primary,
      format: mobile.ios.format,
      secondary: mobile.ios.secondary,
      version: mobile.ios.version,
      isBeta: true,
    },
    allPackagesUrl,
    desktopPackagesUrl,
    androidPackagesUrl,
  };
}

export function getPlatformInstall(platform: DesktopPlatform, locale?: Locale): PlatformInstall;
export function getPlatformInstall(platform: SitePlatform, locale?: Locale): PlatformInstall | null;
export function getPlatformInstall(
  platform: SitePlatform,
  locale: Locale = "zh",
): PlatformInstall | null {
  const table = locale === "en" ? INSTALL_BY_PLATFORM_EN : INSTALL_BY_PLATFORM_ZH;
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

function fallbackCatalog(
  locale: Locale = "zh",
  domain?: string,
  androidVersion?: string,
): DownloadCatalog {
  const isEn = locale === "en";
  const mobile = getMobileDownloadCatalog(locale, domain, androidVersion);
  const allPackagesUrl = domain ? resolveReleasesPortalUrl(domain) : RELEASES_PORTAL_URL;
  const desktopPackagesUrl = domain
    ? resolveDevicePortalUrl("desktop", domain)
    : DESKTOP_PORTAL_URL;
  const androidPackagesUrl = domain
    ? resolveDevicePortalUrl("android", domain)
    : ANDROID_PORTAL_URL;
  return {
    macos: fallbackPrimary(isEn ? "Download for macOS" : "下载 macOS", "Apple Silicon · DMG"),
    linux: fallbackPrimary(isEn ? "Download for Linux" : "下载 Linux", "x86_64 · AppImage"),
    windows: fallbackPrimary(isEn ? "Download for Windows" : "下载 Windows", "x64 · Setup"),
    android: {
      primary: mobile.android.primary,
      format: mobile.android.format,
      secondary: mobile.android.secondary,
      version: mobile.android.version,
      isBeta: true,
    },
    ios: {
      primary: mobile.ios.primary,
      format: mobile.ios.format,
      secondary: mobile.ios.secondary,
      version: mobile.ios.version,
      isBeta: true,
    },
    allPackagesUrl,
    desktopPackagesUrl,
    androidPackagesUrl,
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
 * 构造移动端（Android / iOS）下载目录，标明测试版状态
 */
export function getMobileDownloadCatalog(
  locale: Locale = "zh",
  domain?: string,
  androidVersion = DEFAULT_ANDROID_VERSION,
): MobilePlatformDownload {
  const isEn = locale === "en";
  const normalizedAndroidVer = normalizeVersion(androidVersion) || DEFAULT_ANDROID_VERSION;
  return {
    android: {
      primary: {
        href: buildAndroidApkUrl(normalizedAndroidVer, domain),
        fileName: `Inkpoint_${normalizedAndroidVer}.apk`,
        label: isEn ? "Download Android APK (Beta)" : "下载 Android 安装包 (APK)",
      },
      format: isEn ? "Android 8.0+ · APK · Beta" : "Android 8.0+ · APK · 测试版",
      secondary: [
        {
          href: buildAndroidApkUrl(undefined, domain),
          label: isEn ? "Latest APK Link" : "最新版直链",
        },
      ],
      version: normalizedAndroidVer,
    },
    ios: {
      primary: {
        href: "https://testflight.apple.com/join/placeholder",
        label: isEn ? "Join iOS TestFlight (Beta)" : "加入 iOS TestFlight 公测",
      },
      format: isEn ? "iOS 16.0+ · TestFlight · Beta" : "iOS 16.0+ · TestFlight · 测试版",
      secondary: [],
      version: "0.1.0",
    },
  };
}

export interface MobilePlatformGuide {
  badge: string;
  title: string;
  requirements: string;
  description: string;
  tips: string;
  feedback: string;
}

export function getMobilePlatformGuide(
  platform: "android" | "ios",
  locale: Locale = "zh",
): MobilePlatformGuide {
  const isEn = locale === "en";
  if (platform === "android") {
    return {
      badge: isEn ? "Public Beta" : "公测中 · Beta",
      title: isEn ? "Android Beta Guide" : "Android 客户端公测说明",
      requirements: isEn
        ? "Requires Android 8.0 (API 26) or later (Phones & Tablets)"
        : "适用于 Android 8.0 (API 26) 及更高版本的手机与平板设备",
      description: isEn
        ? "Inkpoint Mobile is currently in public beta. Featuring the native CodeMirror 6 engine, bidirectional links, and offline local editing."
        : "Inkpoint 移动端当前处于公测（Beta）阶段，采用原生 CodeMirror 6 编辑引擎，具备离线 Markdown 读写与双向链接能力。",
      tips: isEn
        ? "Open the APK directly after downloading. If prompted with 'Unknown sources', allow install from this browser in system settings."
        : "下载 APK 后可直接点击安装。若系统提示「来源未知的应用」，请在系统设置中允许来自此浏览器的应用安装。",
      feedback: isEn
        ? "Encountered any rendering issues or input glitches? Feel free to report them via GitHub."
        : "公测阶段功能正持续迭代，如遇排版渲染或输入法兼容问题，欢迎前往 GitHub 提交 Issue 反馈。",
    };
  }

  return {
    badge: isEn ? "Public Beta" : "公测中 · Beta",
    title: isEn ? "iOS TestFlight Beta Guide" : "iOS 客户端公测说明",
    requirements: isEn
      ? "Requires iOS 16.0 or later on iPhone and iPad"
      : "适用于 iOS 16.0 及更高版本的 iPhone 与 iPad 设备",
    description: isEn
      ? "Inkpoint for iOS is distributed via Apple TestFlight public beta — official, secure, and easy to install."
      : "Inkpoint iOS 版目前通过 Apple 官方 TestFlight 进行公测体验，免签名、更稳定、体验丝滑。",
    tips: isEn
      ? "Please install the Apple 'TestFlight' app from the App Store first, then tap the button above to join the Beta."
      : "请先在 App Store 下载安装 Apple 官方「TestFlight」应用，随后点击上方按钮加入 Inkpoint 公测。",
    feedback: isEn
      ? "You can share screenshots directly inside TestFlight or report issues via GitHub."
      : "可直接在 TestFlight 应用中截屏并反馈体验建议，或在 GitHub 提交反馈。",
  };
}
