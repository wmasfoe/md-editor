import path from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_DOMAINS = ["https://download.justdev.cn", "https://download.jiaqi.im"];

export const PURGE_PATHS = [
  "",
  "/",
  "/inkpoint",
  "/inkpoint/",
  "/inkpoint/desktop",
  "/inkpoint/desktop/",
  "/inkpoint/android",
  "/inkpoint/android/",
  "/releases",
  "/releases/desktop",
  "/releases/android",
  "/api/inkpoint/version.json",
  "/api/inkpoint/releases",
  "/api/inkpoint/releases.json",
  "/inkpoint/desktop/updater.json",
];

export function resolvePurgeUrls(domains = DEFAULT_DOMAINS, paths = PURGE_PATHS) {
  const urls = [];
  for (const domain of domains) {
    const base = domain.replace(/\/+$/, "");
    for (const p of paths) {
      const cleanPath = p ? (p.startsWith("/") ? p : `/${p}`) : "";
      urls.push(`${base}${cleanPath}`);
    }
  }
  return Array.from(new Set(urls));
}

/**
 * 调用 Worker /api/purge-cache 清除边缘 Cache API 缓存
 */
export async function purgeWorkerCache(domain, purgeUrls, purgeToken) {
  const endpoint = `${domain.replace(/\/+$/, "")}/api/purge-cache`;
  const headers = { "Content-Type": "application/json" };
  if (purgeToken) {
    headers["X-Purge-Token"] = purgeToken;
  }

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({ urls: purgeUrls }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.warn(`[Purge Worker] ${endpoint} returned HTTP ${res.status}: ${errText}`);
      return { success: false, endpoint, status: res.status, error: errText };
    }

    const data = await res.json().catch(() => ({}));
    console.log(`[Purge Worker] ✓ Successfully purged ${domain} via Worker API`);
    return { success: true, endpoint, data };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[Purge Worker] Failed to purge ${endpoint}: ${message}`);
    return { success: false, endpoint, error: message };
  }
}

/**
 * 通过 Cloudflare API 清理 Zone 缓存
 */
export async function purgeCloudflareZoneCache(zoneId, apiToken, files) {
  const endpoint = `https://api.cloudflare.com/client/v4/zones/${zoneId}/purge_cache`;
  try {
    const payload = files && files.length > 0 ? { files } : { purge_everything: true };
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.success === false) {
      const errStr = JSON.stringify(data.errors || data);
      console.warn(`[Purge Cloudflare] Zone ${zoneId} purge failed: ${errStr}`);
      return { success: false, zoneId, errors: data.errors };
    }

    console.log(`[Purge Cloudflare] ✓ Successfully purged cache for Zone ${zoneId}`);
    return { success: true, zoneId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[Purge Cloudflare] Zone ${zoneId} purge network error: ${message}`);
    return { success: false, zoneId, error: message };
  }
}

/**
 * 主入口执行函数
 */
export async function runCli() {
  const purgeToken = process.env.PURGE_TOKEN;
  const cfApiToken = process.env.CLOUDFLARE_API_TOKEN;
  const cfZoneId = process.env.CLOUDFLARE_ZONE_ID;

  const targetDomains = process.env.PURGE_DOMAINS
    ? process.env.PURGE_DOMAINS.split(",")
        .map((d) => d.trim())
        .filter(Boolean)
    : DEFAULT_DOMAINS;

  console.log("🧹 Starting edge cache purge for download portal...");
  console.log(`Target domains: ${targetDomains.join(", ")}`);

  // 1. Worker Cache API 清理
  for (const domain of targetDomains) {
    const domainUrls = resolvePurgeUrls([domain], PURGE_PATHS);
    await purgeWorkerCache(domain, domainUrls, purgeToken);
  }

  // 2. Cloudflare Zone Purge (若配置了 API Token 与 Zone ID)
  if (cfApiToken && cfZoneId) {
    const allPurgeUrls = resolvePurgeUrls(targetDomains, PURGE_PATHS);
    await purgeCloudflareZoneCache(cfZoneId, cfApiToken, allPurgeUrls);
  }

  console.log("✨ Download portal cache purge finished!");
}

const isDirectRun =
  process.argv[1] &&
  (import.meta.url.endsWith(process.argv[1]) ||
    fileURLToPath(import.meta.url) === path.resolve(process.argv[1]));

if (isDirectRun) {
  runCli().catch((err) => {
    console.warn("Purge cache script encountered warning:", err);
    process.exit(0); // 绝不中断发版流水线
  });
}
