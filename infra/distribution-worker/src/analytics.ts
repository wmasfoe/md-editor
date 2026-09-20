import type { Env } from "./types.ts";

/**
 * 下载统计事件：记录一次安装包下载行为
 */
export interface DownloadEvent {
  /** 应用标识 (inkpoint) */
  readonly app: string;
  /** 平台 (macos-arm64 / windows-x64 / linux-appimage / android 等) */
  readonly platform: string;
  /** 版本号 (0.10.4) */
  readonly version: string;
  /** 下载文件名 */
  readonly fileName: string;
  /** 请求来源国家 (由 CF-IPCountry header 提供) */
  readonly country: string;
  /** 下载来源 (direct / site / updater / api) */
  readonly source: string;
  /** 用户代理 */
  readonly userAgent: string;
}

/**
 * 从请求 URL 与 headers 中提取平台与来源信息
 */
export function inferDownloadEvent(
  request: Request,
  app: string,
  version: string,
  fileName: string,
): DownloadEvent {
  const url = new URL(request.url);
  const country = request.headers.get("CF-IPCountry") || "unknown";
  const userAgent = request.headers.get("User-Agent") || "";

  const platform = inferPlatformFromPath(url.pathname, fileName);
  const source = inferSource(request);

  return { app, platform, version, fileName, country, source, userAgent };
}

/**
 * 将下载事件异步写入 D1（通过 ctx.waitUntil 不阻塞响应）
 */
export async function recordDownload(
  ctx: ExecutionContext,
  env: Env,
  event: DownloadEvent,
): Promise<void> {
  const db = env.DOWNLOAD_ANALYTICS;
  if (!db) return;

  try {
    await db
      .prepare(
        `INSERT INTO downloads (app, platform, version, file_name, country, source, user_agent, timestamp)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        event.app,
        event.platform,
        event.version,
        event.fileName,
        event.country,
        event.source,
        event.userAgent,
        new Date().toISOString(),
      )
      .run();
  } catch {
    // 分析写入不应影响下载体验，静默忽略
  }
}

/**
 * 从 URL 路径和文件名推断平台类型
 */
export function inferPlatformFromPath(pathname: string, fileName: string): string {
  const lower = pathname.toLowerCase() + " " + fileName.toLowerCase();

  if (lower.includes("android") || lower.endsWith(".apk")) return "android";
  if (lower.includes("aarch64") || lower.includes("arm64")) {
    if (lower.includes(".dmg") || lower.includes(".app.tar.gz")) return "macos-arm64";
    if (lower.includes(".exe") || lower.includes(".nsis.zip") || lower.includes(".zip"))
      return "windows-arm64";
    if (lower.includes(".deb")) return "linux-deb-arm64";
    if (lower.includes(".appimage")) return "linux-arm64";
  }
  if (lower.includes("x64") || lower.includes("x86_64") || lower.includes("amd64")) {
    if (lower.includes(".dmg") || lower.includes(".app.tar.gz")) return "macos-x64";
    if (lower.includes(".exe") || lower.includes(".nsis.zip") || lower.includes(".zip"))
      return "windows-x64";
    if (lower.includes(".deb")) return "linux-deb-x64";
    if (lower.includes(".appimage")) return "linux-x64";
  }
  if (lower.includes(".app.tar.gz") || lower.includes("darwin")) return "macos";
  if (lower.includes(".nsis.zip")) return "windows";
  if (lower.includes(".dmg")) return "macos";
  if (lower.includes(".exe")) return "windows";
  if (lower.includes(".deb")) return "linux-deb";
  if (lower.includes(".appimage")) return "linux";
  if (lower.includes("macos")) return "macos";
  if (lower.includes("windows")) return "windows";
  if (lower.includes("linux")) return "linux";

  return "unknown";
}

/**
 * 推断下载来源：site（官网跳转）、updater（应用内更新）、api（API 请求）、direct（直接访问）
 */
function inferSource(request: Request): string {
  const referer = request.headers.get("Referer") || "";
  const accept = request.headers.get("Accept") || "";
  const userAgent = request.headers.get("User-Agent") || "";

  if (userAgent.includes("Tauri") || userAgent.includes("tauri-updater")) return "updater";
  if (referer.includes("inkpoint") || referer.includes("justdev")) return "site";
  if (accept.includes("application/json")) return "api";

  return "direct";
}
