/**
 * 官网对外链接与各平台安装包直链约定。
 *
 * stable 产物发布在公开 tap 仓库（源码仓可能为私有，直接链 asset 会 404）。
 * 历史版本页也指向同一公开 Release 列表，便于用户浏览全部安装包。
 */

/** 官网域名 */
export const OFFICIAL_SITE_DOMAIN = "editor.justdev.cn";

/** 官网完整 URL */
export const OFFICIAL_SITE_URL = `https://${OFFICIAL_SITE_DOMAIN}`;

/** Web Playground 相对路径 */
export const PLAYGROUND_PATH = "/playground";

/** Web Playground 完整 URL */
export const PLAYGROUND_URL = `${OFFICIAL_SITE_URL}${PLAYGROUND_PATH}`;

/** 本项目源码仓库 */
export const GITHUB_REPO_URL = "https://github.com/wmasfoe/md-editor";

/** 根据 PR 编号构造 App 源码仓库 PR 页面链接 */
export function buildAppPrUrl(prNumber: number): string {
  return `${GITHUB_REPO_URL}/pull/${prNumber}`;
}

/** 公开 release / 历史版本列表（含 DMG） */
export const GITHUB_RELEASES_URL = "https://github.com/wmasfoe/homebrew-tap/releases";

/** 对外展示名。仓库、bundle id 与 Homebrew cask token 仍是 md-editor。 */
export const APP_DISPLAY_NAME = "Inkpoint";

/** 中文意象，只作释义或副标，不与 Inkpoint 并列成第二商标。 */
export const APP_NAME_ZH = "墨点";

/** Tauri 安装包文件名前缀，与 productName 一致。 */
export const ARTIFACT_NAME_PREFIX = "Inkpoint";

/** 官方默认全球分发与边缘加速域名 */
export const DEFAULT_DISTRIBUTION_DOMAIN = "download.justdev.cn";

/** 官方全球分发与边缘加速域名（基于 Cloudflare Worker & R2） */
export const DISTRIBUTION_DOMAIN =
  (typeof process !== "undefined" && process.env?.NEXT_PUBLIC_DISTRIBUTION_DOMAIN) ||
  DEFAULT_DISTRIBUTION_DOMAIN;

/** 官方全球分发加速基础 URL */
export const DISTRIBUTION_URL = `https://${DISTRIBUTION_DOMAIN}`;

/** 官方全球版本分发中心与历史安装包归档 Web 页面 URL */
export const RELEASES_PORTAL_URL = `${DISTRIBUTION_URL}/inkpoint/`;

/** 官方 Android 平台版本中心页面 URL */
export const ANDROID_PORTAL_URL = `${DISTRIBUTION_URL}/inkpoint/android/`;

/** 官方 Desktop 平台版本中心页面 URL */
export const DESKTOP_PORTAL_URL = `${DISTRIBUTION_URL}/inkpoint/desktop/`;

/** 官方历史全量版本清单 API */
export const RELEASES_API_URL = `${DISTRIBUTION_URL}/api/inkpoint/releases`;

/** 官方 Android 版本清单 API URL */
export const ANDROID_RELEASES_API_URL = `${DISTRIBUTION_URL}/api/inkpoint/android/releases`;

/** 官方 Desktop 版本清单 API URL */
export const DESKTOP_RELEASES_API_URL = `${DISTRIBUTION_URL}/api/inkpoint/desktop/releases`;

/**
 * 根据当前运行上下文（浏览器 window.location.hostname 或传入的 hostname）智能解析分发加速域名。
 * 例如：
 * - editor.jiaqi.im -> download.jiaqi.im
 * - editor.justdev.cn -> download.justdev.cn
 * - 任意 editor.<domain> -> download.<domain>
 * - 本地开发或未知主机 -> 回退默认 download.justdev.cn
 */
export function resolveDistributionDomain(hostname?: string): string {
  if (typeof process !== "undefined" && process.env?.NEXT_PUBLIC_DISTRIBUTION_DOMAIN) {
    return process.env.NEXT_PUBLIC_DISTRIBUTION_DOMAIN;
  }
  const host = hostname || (typeof window !== "undefined" ? window.location.hostname : undefined);
  if (host) {
    if (host === "editor.jiaqi.im" || host.endsWith(".jiaqi.im")) {
      return "download.jiaqi.im";
    }
    if (host === "editor.justdev.cn" || host.endsWith(".justdev.cn")) {
      return "download.justdev.cn";
    }
    if (host.startsWith("editor.")) {
      return `download.${host.slice("editor.".length)}`;
    }
  }
  return DEFAULT_DISTRIBUTION_DOMAIN;
}

/**
 * 根据当前域名解析分发加速基础 URL
 */
export function resolveDistributionUrl(hostname?: string): string {
  return `https://${resolveDistributionDomain(hostname)}`;
}

/**
 * 根据当前域名解析版本分发中心 Web 页面 URL
 */
export function resolveReleasesPortalUrl(hostname?: string): string {
  return `${resolveDistributionUrl(hostname)}/inkpoint/`;
}

/**
 * 根据当前域名解析特定平台版本分发中心 Web 页面 URL
 */
export function resolveDevicePortalUrl(
  platform: "desktop" | "android" | "all" = "all",
  hostname?: string,
): string {
  const base = resolveDistributionUrl(hostname);
  if (platform === "android") {
    return `${base}/inkpoint/android/`;
  }
  if (platform === "desktop") {
    return `${base}/inkpoint/desktop/`;
  }
  return `${base}/inkpoint/`;
}

function resolveBaseUrl(domain?: string): string {
  if (!domain) return DISTRIBUTION_URL;
  return domain.startsWith("http://") || domain.startsWith("https://")
    ? domain
    : `https://${domain}`;
}

/**
 * 根据语义化版本构造各主流平台安装包直链对象（供历史版本下载与更新日志使用）
 */
export function buildVersionPackageLinks(version: string, domain?: string) {
  const normalized = normalizeVersion(version);
  if (!normalized) return null;
  const baseUrl = resolveBaseUrl(domain);
  return {
    version: normalized,
    macos: {
      label: "macOS (Apple Silicon)",
      fileName: `${ARTIFACT_NAME_PREFIX}_${normalized}_aarch64.dmg`,
      url: `${baseUrl}/inkpoint/desktop/${normalized}/${encodeURIComponent(`${ARTIFACT_NAME_PREFIX}_${normalized}_aarch64.dmg`)}`,
    },
    windows: {
      label: "Windows (x64)",
      fileName: `${ARTIFACT_NAME_PREFIX}_${normalized}_x64-setup.exe`,
      url: `${baseUrl}/inkpoint/desktop/${normalized}/${encodeURIComponent(`${ARTIFACT_NAME_PREFIX}_${normalized}_x64-setup.exe`)}`,
    },
    linux: {
      label: "Linux (AppImage)",
      fileName: `${ARTIFACT_NAME_PREFIX}_${normalized}_amd64.AppImage`,
      url: `${baseUrl}/inkpoint/desktop/${normalized}/${encodeURIComponent(`${ARTIFACT_NAME_PREFIX}_${normalized}_amd64.AppImage`)}`,
    },
    android: {
      label: "Android (APK)",
      fileName: `${ARTIFACT_NAME_PREFIX}_${normalized}.apk`,
      url: `${baseUrl}/inkpoint/android/${normalized}/${encodeURIComponent(`${ARTIFACT_NAME_PREFIX}_${normalized}.apk`)}`,
    },
  };
}

/**
 * 构造基于 Cloudflare Worker 边缘加速的最新桌面安装包直链
 */
export function buildAcceleratedDesktopUrl(
  platform: "macos" | "windows" | "linux",
  domain?: string,
): string {
  const baseUrl = resolveBaseUrl(domain);
  return `${baseUrl}/inkpoint/desktop/${platform}/latest`;
}

/**
 * 构造基于 Cloudflare R2 全球分发的 Android APK 安装包直链
 */
export function buildAndroidApkUrl(version?: string, domain?: string): string {
  const baseUrl = resolveBaseUrl(domain);
  if (version) {
    const normalized = normalizeVersion(version);
    return `${baseUrl}/inkpoint/android/${normalized}/Inkpoint_${normalized}.apk`;
  }
  return `${baseUrl}/inkpoint/android/latest`;
}

/**
 * 构造通用多端版本清单接口 URL
 */
export function buildVersionApiUrl(app = "inkpoint", domain?: string): string {
  const baseUrl = resolveBaseUrl(domain);
  return `${baseUrl}/api/${app}/version.json`;
}

/**
 * 根据语义化版本构造最新 macOS DMG 直链。
 * 优先走官方全球边缘分发网关（Cloudflare R2 直出 / 智能代理），避免国内访问 GitHub Release 失败。
 */
export function buildMacosDmgUrl(version: string, domain?: string): string {
  const normalized = normalizeVersion(version);
  if (!normalized) {
    throw new Error(`Invalid macOS DMG version: ${version}`);
  }

  const baseUrl = resolveBaseUrl(domain);
  const fileName = `${ARTIFACT_NAME_PREFIX}_${normalized}_aarch64.dmg`;
  return `${baseUrl}/inkpoint/desktop/${normalized}/${encodeURIComponent(fileName)}`;
}

/**
 * 根据语义化版本构造 Linux AppImage 直链。
 */
export function buildLinuxAppImageUrl(
  version: string,
  arch: "x86_64" | "aarch64" = "x86_64",
  domain?: string,
): string {
  const normalized = normalizeVersion(version);
  if (!normalized) {
    throw new Error(`Invalid Linux version: ${version}`);
  }

  const baseUrl = resolveBaseUrl(domain);
  const fileName = `${ARTIFACT_NAME_PREFIX}_${normalized}_${arch}.AppImage`;
  return `${baseUrl}/inkpoint/desktop/${normalized}/${encodeURIComponent(fileName)}`;
}

/**
 * 根据语义化版本构造 Windows Setup.exe 直链。
 */
export function buildWindowsSetupUrl(
  version: string,
  arch: "x64" | "arm64" = "x64",
  domain?: string,
): string {
  const normalized = normalizeVersion(version);
  if (!normalized) {
    throw new Error(`Invalid Windows version: ${version}`);
  }

  const baseUrl = resolveBaseUrl(domain);
  const fileName = `${ARTIFACT_NAME_PREFIX}_${normalized}_${arch}-setup.exe`;
  return `${baseUrl}/inkpoint/desktop/${normalized}/${encodeURIComponent(fileName)}`;
}

/** 去掉可选 v 前缀；空串视为无效。 */
export function normalizeVersion(version: string): string | null {
  const value = version.trim().replace(/^v/iu, "");
  return value.length > 0 ? value : null;
}
