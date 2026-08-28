/**
 * 官网下载入口使用的桌面平台。
 * 只覆盖可安装桌面端的系统；移动 UA 回退到 macOS，避免把 Android 误判成 Linux。
 */
export const SITE_PLATFORMS = ["macos", "linux", "windows"] as const;

export type SitePlatform = (typeof SITE_PLATFORMS)[number];

export const SITE_PLATFORM_LABELS: Record<SitePlatform, string> = {
  macos: "macOS",
  linux: "Linux",
  windows: "Windows",
};

export function isSitePlatform(value: string): value is SitePlatform {
  return (SITE_PLATFORMS as readonly string[]).includes(value);
}

/**
 * 从 User-Agent 推断默认平台。
 * Android 的 UA 含 "Linux"，必须先排除，否则会把手机访问判成桌面 Linux。
 */
export function detectSitePlatform(userAgent: string): SitePlatform {
  const ua = userAgent.toLowerCase();

  if (ua.includes("windows")) {
    return "windows";
  }

  if (ua.includes("android")) {
    return "macos";
  }

  if (ua.includes("linux") || ua.includes("cros")) {
    return "linux";
  }

  return "macos";
}
