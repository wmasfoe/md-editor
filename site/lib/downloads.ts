import type { Locale } from "./i18n/types";
import { SITE_PLATFORMS, type SitePlatform } from "./platform";
import {
  ARTIFACT_NAME_PREFIX,
  buildLinuxAppImageUrl,
  buildMacosDmgUrl,
  buildWindowsSetupUrl,
  GITHUB_RELEASES_URL,
  normalizeVersion,
} from "./site-links";

export const UNIX_INSTALL_COMMAND =
  "curl -fsSL https://raw.githubusercontent.com/wmasfoe/homebrew-tap/main/install-md-editor.sh | sh";

export const WINDOWS_INSTALL_COMMAND =
  "irm https://raw.githubusercontent.com/wmasfoe/homebrew-tap/main/install-md-editor.ps1 | iex";

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
};

export type DownloadCatalog = Record<SitePlatform, PlatformDownload> & {
  allPackagesUrl: string;
};

export type PlatformInstall = {
  title: string;
  command: string;
  recommended: boolean;
  extra?: { title: string; command: string };
};

const INSTALL_BY_PLATFORM_ZH: Record<SitePlatform, PlatformInstall> = {
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

const INSTALL_BY_PLATFORM_EN: Record<SitePlatform, PlatformInstall> = {
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

/** 按版本和语言构造三平台主下载与次要架构入口；无效版本一律回退到 Releases 列表。 */
export function buildDownloadCatalog(version?: string, locale: Locale = "zh"): DownloadCatalog {
  const normalized = version ? normalizeVersion(version) : null;
  if (!normalized) {
    return fallbackCatalog(locale);
  }

  const isEn = locale === "en";

  return {
    macos: {
      primary: {
        href: buildMacosDmgUrl(normalized),
        fileName: `${ARTIFACT_NAME_PREFIX}_${normalized}_aarch64.dmg`,
        label: isEn ? "Download for macOS" : "下载 macOS",
      },
      format: "Apple Silicon · DMG",
      secondary: [],
    },
    linux: {
      primary: {
        href: buildLinuxAppImageUrl(normalized, "x86_64"),
        fileName: `${ARTIFACT_NAME_PREFIX}_${normalized}_x86_64.AppImage`,
        label: isEn ? "Download for Linux" : "下载 Linux",
      },
      format: "x86_64 · AppImage",
      secondary: [
        {
          href: buildLinuxAppImageUrl(normalized, "aarch64"),
          fileName: `${ARTIFACT_NAME_PREFIX}_${normalized}_aarch64.AppImage`,
          label: "ARM64 AppImage",
        },
      ],
    },
    windows: {
      primary: {
        href: buildWindowsSetupUrl(normalized, "x64"),
        fileName: `${ARTIFACT_NAME_PREFIX}_${normalized}_x64-setup.exe`,
        label: isEn ? "Download for Windows" : "下载 Windows",
      },
      format: "x64 · Setup",
      secondary: [
        {
          href: buildWindowsSetupUrl(normalized, "arm64"),
          fileName: `${ARTIFACT_NAME_PREFIX}_${normalized}_arm64-setup.exe`,
          label: isEn ? "ARM64 Setup" : "ARM64 安装包",
        },
      ],
    },
    allPackagesUrl: GITHUB_RELEASES_URL,
  };
}

export function getPlatformInstall(platform: SitePlatform, locale: Locale = "zh"): PlatformInstall {
  return locale === "en" ? INSTALL_BY_PLATFORM_EN[platform] : INSTALL_BY_PLATFORM_ZH[platform];
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

function fallbackCatalog(locale: Locale = "zh"): DownloadCatalog {
  const isEn = locale === "en";
  return {
    macos: fallbackPrimary(isEn ? "Download for macOS" : "下载 macOS", "Apple Silicon · DMG"),
    linux: fallbackPrimary(isEn ? "Download for Linux" : "下载 Linux", "x86_64 · AppImage"),
    windows: fallbackPrimary(isEn ? "Download for Windows" : "下载 Windows", "x64 · Setup"),
    allPackagesUrl: GITHUB_RELEASES_URL,
  };
}

export function listSitePlatforms(): SitePlatform[] {
  return [...SITE_PLATFORMS];
}
