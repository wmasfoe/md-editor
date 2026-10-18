/**
 * @file github-releases.ts
 * @description GitHub Release 抓取、形状与内存缓存（自 router.ts 拆出，行为不变）。
 */

import type { Env } from "../types.ts";

export interface GitHubReleasePayload {
  tag_name: string;
  assets: Array<{ name: string; browser_download_url: string; size: number }>;
}

const cachedReleasePayloadByRepo = new Map<string, GitHubReleasePayload>();

/**
 * 获取 GitHub 最新桌面端 Release，并通过 Cloudflare 边缘强缓存与内存容灾避免 API 频控 (403 Rate Limit)
 */
export async function fetchLatestRelease(
  githubRepo: string,
  env: Env,
): Promise<GitHubReleasePayload | null> {
  const repoKey = githubRepo || "default";
  const headers: Record<string, string> = {
    "User-Agent": "Inkpoint-Distribution-Worker/1.0",
    Accept: "application/vnd.github.v3+json",
  };
  if (env.GITHUB_TOKEN) {
    headers["Authorization"] = `Bearer ${env.GITHUB_TOKEN}`;
  }

  try {
    const res = await fetch(`https://api.github.com/repos/${githubRepo}/releases/latest`, {
      headers,
      cf: { cacheTtl: 300, cacheEverything: true },
    });

    if (res.ok) {
      const data = (await res.json()) as GitHubReleasePayload;
      const tagName = data.tag_name || "";
      const isDesktopTag = tagName.startsWith("desktop-v") || /^v\d/.test(tagName);
      const hasDesktopAssets =
        Array.isArray(data.assets) &&
        data.assets.some((a) => {
          const lower = a.name.toLowerCase();
          return (
            lower.endsWith(".dmg") ||
            lower.endsWith(".exe") ||
            lower.endsWith(".appimage") ||
            lower.endsWith(".deb")
          );
        });

      if (isDesktopTag || hasDesktopAssets) {
        cachedReleasePayloadByRepo.set(repoKey, data);
        return data;
      }
    }
  } catch {
    // 捕获网络异常
  }

  // 若 /releases/latest 被非桌面端（如 utools-v* / web-v*）占据，回退到从全量列表中寻找最新桌面发布
  const allReleases = await fetchAllGitHubReleases(githubRepo, env);
  for (const raw of allReleases) {
    const tagName = raw.tag_name || "";
    const isDesktopTag = tagName.startsWith("desktop-v") || /^v\d/.test(tagName);
    const hasDesktopAssets =
      Array.isArray(raw.assets) &&
      raw.assets.some((a) => {
        const lower = a.name.toLowerCase();
        return (
          lower.endsWith(".dmg") ||
          lower.endsWith(".exe") ||
          lower.endsWith(".appimage") ||
          lower.endsWith(".deb")
        );
      });

    if (isDesktopTag || hasDesktopAssets) {
      const payload: GitHubReleasePayload = {
        tag_name: raw.tag_name,
        assets: (raw.assets || []).map((a) => ({
          name: a.name,
          browser_download_url: a.browser_download_url,
          size: a.size,
        })),
      };
      cachedReleasePayloadByRepo.set(repoKey, payload);
      return payload;
    }
  }

  // 触发频控 (403) 或网络故障时，优先回退到内存缓存的最新发布
  const cached = cachedReleasePayloadByRepo.get(repoKey);
  if (cached) {
    return cached;
  }

  return null;
}

export interface RawGitHubRelease {
  tag_name: string;
  name?: string;
  published_at?: string;
  prerelease?: boolean;
  html_url?: string;
  assets: Array<{
    name: string;
    browser_download_url: string;
    size: number;
  }>;
}

const cachedReleasesByRepo = new Map<string, RawGitHubRelease[]>();

/**
 * 清除内存中的 GitHub 发布缓存（主要用于单测隔离与缓存清理）
 */
export function clearReleaseCache(): void {
  cachedReleasePayloadByRepo.clear();
  cachedReleasesByRepo.clear();
}

/**
 * 获取 GitHub 所有 Release 列表，带 Cloudflare 边缘缓存与内存容灾
 */
export async function fetchAllGitHubReleases(
  githubRepo: string,
  env: Env,
): Promise<RawGitHubRelease[]> {
  const repoKey = githubRepo || "default";
  const headers: Record<string, string> = {
    "User-Agent": "Inkpoint-Distribution-Worker/1.0",
    Accept: "application/vnd.github.v3+json",
  };
  if (env.GITHUB_TOKEN) {
    headers["Authorization"] = `Bearer ${env.GITHUB_TOKEN}`;
  }

  try {
    const res = await fetch(`https://api.github.com/repos/${githubRepo}/releases?per_page=50`, {
      headers,
      cf: { cacheTtl: 600, cacheEverything: true },
    });

    if (res.ok) {
      const data = (await res.json()) as RawGitHubRelease[];
      if (Array.isArray(data) && data.length > 0) {
        cachedReleasesByRepo.set(repoKey, data);
        return data;
      }
    }
  } catch {
    // 网络异常
  }

  const cached = cachedReleasesByRepo.get(repoKey);
  if (cached) {
    return cached;
  }

  return [];
}
