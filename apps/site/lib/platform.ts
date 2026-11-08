/**
 * 官网下载入口使用的平台。
 * 包含桌面端（macOS、Linux、Windows）与移动端（Android、iOS）。
 * 移动端排在最后；它们已停止发版，只提供已经发布的最后一个版本。
 */
export const SITE_PLATFORMS = ["macos", "linux", "windows", "android", "ios"] as const;

export type SitePlatform = (typeof SITE_PLATFORMS)[number];

export const DESKTOP_PLATFORMS = ["macos", "linux", "windows"] as const;
export type DesktopPlatform = (typeof DESKTOP_PLATFORMS)[number];

export const MOBILE_PLATFORMS = ["android", "ios"] as const;
export type MobilePlatform = (typeof MOBILE_PLATFORMS)[number];

export const SITE_PLATFORM_LABELS: Record<SitePlatform, string> = {
  macos: "macOS",
  linux: "Linux",
  windows: "Windows",
  android: "Android",
  ios: "iOS",
};

export function isSitePlatform(value: string): value is SitePlatform {
  return (SITE_PLATFORMS as readonly string[]).includes(value);
}

export function isMobilePlatform(platform: SitePlatform): platform is MobilePlatform {
  return platform === "android" || platform === "ios";
}

/**
 * 从 User-Agent 推断默认平台。
 * Android 的 UA 含 "Linux"，先判定 Android/iOS 移动设备，再判定桌面操作系统。
 */
export function detectSitePlatform(userAgent: string): SitePlatform {
  const ua = userAgent.toLowerCase();

  if (ua.includes("windows")) {
    return "windows";
  }

  if (ua.includes("android")) {
    return "android";
  }

  // iOS 以未签名 IPA 分发，iOS 访问直接落到 iOS 入口
  if (
    ua.includes("iphone") ||
    ua.includes("ipad") ||
    ua.includes("ipod") ||
    (ua.includes("macintosh") && ua.includes("mobile"))
  ) {
    return "ios";
  }

  if (ua.includes("linux") || ua.includes("cros")) {
    return "linux";
  }

  return "macos";
}
