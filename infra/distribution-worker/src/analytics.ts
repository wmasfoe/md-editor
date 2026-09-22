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
 * 获取客户端真实 IP（Cloudflare 提供的 CF-Connecting-IP header）
 */
function getClientIp(request: Request): string {
  return request.headers.get("CF-Connecting-IP") || "unknown";
}

/**
 * 基于 HMAC-SHA256(IP + Salt + YYYYMMDD) 计算隐私安全的去重指纹。
 * 同一 IP 同一天生成相同指纹，不泄露原始 IP（符合 GDPR / PII 要求）。
 */
async function computeDedupFingerprint(data: string, salt: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(salt),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * 通过 Cloudflare Cache API 在边缘做 24h 去重检查，完全不消耗 D1 读取配额。
 * 返回 true 表示该指纹已记录过（重复请求），应跳过写入。
 */
async function isDuplicateDownload(fingerprint: string): Promise<boolean> {
  const cacheUrl = `https://dl-dedup.inkpoint/${fingerprint}`;
  const cache = (caches as unknown as { default: Cache }).default;
  const cached = await cache.match(new Request(cacheUrl));
  return cached !== undefined;
}

/**
 * 在边缘缓存中标记指纹已记录（24h TTL）
 */
async function markDownloadRecorded(fingerprint: string): Promise<void> {
  const cacheUrl = `https://dl-dedup.inkpoint/${fingerprint}`;
  const cache = (caches as unknown as { default: Cache }).default;
  const response = new Response("1", {
    headers: { "Cache-Control": "public, max-age=86400" },
  });
  await cache.put(new Request(cacheUrl), response);
}

/**
 * 构造下载去重键。
 * 平台与文件名必须参与去重，避免同一用户下载同版本的不同安装包时被错误合并。
 */
export function buildDownloadDedupKey(ip: string, event: DownloadEvent, date: string): string {
  return `${ip}:${event.app}:${event.platform}:${event.version}:${event.fileName}:${date}`;
}

/**
 * 将下载事件异步写入 D1（通过 ctx.waitUntil 不阻塞响应）。
 * 写入前通过 Cache API 边缘去重：同一 IP 同一天同一安装包只记录一次。
 */
export async function recordDownload(
  ctx: ExecutionContext,
  env: Env,
  request: Request,
  event: DownloadEvent,
): Promise<void> {
  const db = env.DOWNLOAD_ANALYTICS;
  if (!db) return;

  try {
    // 边缘去重：同一 IP 同一天重复下载同一安装包只记录一次
    const ip = getClientIp(request);
    const salt = env.HMAC_SALT || "inkpoint-default-salt";
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const dedupKey = buildDownloadDedupKey(ip, event, date);
    const fingerprint = await computeDedupFingerprint(dedupKey, salt);

    if (await isDuplicateDownload(fingerprint)) return;

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

    await markDownloadRecorded(fingerprint);
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
