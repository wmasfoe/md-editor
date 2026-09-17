/**
 * @file releases.ts
 * @module site/lib/releases
 * @description
 * 服务端客户端全量发布版本清单拉取与本地容灾构建模块。
 *
 * 负责与 Cloudflare Worker / R2 的 /api/inkpoint/releases 接口通信获取最新归档数据，
 * 并在离线构建或网络异常时自动回退读取本地 CHANGELOG 组装全量数据，
 * 确保 Next.js ISR 增量预渲染与自动化单测 100% 稳健执行。
 */

import { getAndroidChangelogEntries, getDesktopChangelogEntries } from "./changelog";
import type { ReleaseAsset, ReleasesData, VersionRelease } from "./releases-types";
import {
  ARTIFACT_NAME_PREFIX,
  DEFAULT_DISTRIBUTION_DOMAIN,
  GITHUB_REPO_URL,
  RELEASES_API_URL,
} from "./site-links";

/**
 * 本地兜底：根据本地 Changelog 组装各平台版本与下载清单
 */
export function buildFallbackReleasesData(): ReleasesData {
  const desktopEntries = getDesktopChangelogEntries("zh");
  const androidEntries = getAndroidChangelogEntries("zh");

  const releases: VersionRelease[] = [];
  const baseDomain = DEFAULT_DISTRIBUTION_DOMAIN;

  // 1. 构建 Desktop 历史版本
  desktopEntries.forEach((entry, idx) => {
    const v = entry.version.replace(/^v/, "");
    const assets: ReleaseAsset[] = [
      {
        platform: "macos-arm64",
        platformLabel: "macOS (Apple Silicon)",
        fileName: `${ARTIFACT_NAME_PREFIX}_${v}_aarch64.dmg`,
        downloadUrl: `https://${baseDomain}/inkpoint/desktop/${v}/${encodeURIComponent(`${ARTIFACT_NAME_PREFIX}_${v}_aarch64.dmg`)}`,
        sizeBytes: 30680892,
        formattedSize: "29.3 MB",
        isR2Cached: true,
      },
      {
        platform: "macos-x64",
        platformLabel: "macOS (Intel)",
        fileName: `${ARTIFACT_NAME_PREFIX}_${v}_x64.dmg`,
        downloadUrl: `https://${baseDomain}/inkpoint/desktop/${v}/${encodeURIComponent(`${ARTIFACT_NAME_PREFIX}_${v}_x64.dmg`)}`,
        sizeBytes: 32000000,
        formattedSize: "30.5 MB",
        isR2Cached: true,
      },
      {
        platform: "windows-x64",
        platformLabel: "Windows (x64)",
        fileName: `${ARTIFACT_NAME_PREFIX}_${v}_x64-setup.exe`,
        downloadUrl: `https://${baseDomain}/inkpoint/desktop/${v}/${encodeURIComponent(`${ARTIFACT_NAME_PREFIX}_${v}_x64-setup.exe`)}`,
        sizeBytes: 8072766,
        formattedSize: "7.7 MB",
        isR2Cached: true,
      },
      {
        platform: "linux-appimage",
        platformLabel: "Linux (AppImage)",
        fileName: `${ARTIFACT_NAME_PREFIX}_${v}_amd64.AppImage`,
        downloadUrl: `https://${baseDomain}/inkpoint/desktop/${v}/${encodeURIComponent(`${ARTIFACT_NAME_PREFIX}_${v}_amd64.AppImage`)}`,
        sizeBytes: 91474424,
        formattedSize: "87.2 MB",
        isR2Cached: true,
      },
      {
        platform: "linux-deb",
        platformLabel: "Linux (DEB)",
        fileName: `${ARTIFACT_NAME_PREFIX}_${v}_amd64.deb`,
        downloadUrl: `https://${baseDomain}/inkpoint/desktop/${v}/${encodeURIComponent(`${ARTIFACT_NAME_PREFIX}_${v}_amd64.deb`)}`,
        sizeBytes: 75000000,
        formattedSize: "71.5 MB",
        isR2Cached: true,
      },
    ];

    releases.push({
      version: v,
      tagName: `v${v}`,
      publishedAt: entry.date || new Date().toISOString(),
      isLatest: idx === 0,
      isPrerelease: false,
      category: "desktop",
      releaseNotesUrl: `${GITHUB_REPO_URL}/releases/tag/v${v}`,
      assets,
    });
  });

  // 2. 构建 Android 历史版本
  androidEntries.forEach((entry, idx) => {
    const v = entry.version.replace(/^v/, "");
    const apkName = `${ARTIFACT_NAME_PREFIX}_${v}.apk`;
    const assets: ReleaseAsset[] = [
      {
        platform: "android",
        platformLabel: "Android (APK)",
        fileName: apkName,
        downloadUrl: `https://${baseDomain}/inkpoint/android/${v}/${encodeURIComponent(apkName)}`,
        sizeBytes: 45000000,
        formattedSize: "42.9 MB",
        isR2Cached: true,
      },
    ];

    releases.push({
      version: v,
      tagName: `android-v${v}`,
      publishedAt: entry.date || new Date().toISOString(),
      isLatest: idx === 0,
      isPrerelease: true,
      category: "android",
      releaseNotesUrl: `${GITHUB_REPO_URL}/releases/tag/android-v${v}`,
      assets,
    });
  });

  const latestDesktopVersion = releases.find((r) => r.category === "desktop")?.version || "0.10.2";
  const latestAndroidVersion = releases.find((r) => r.category === "android")?.version || "0.1.0";

  return {
    app: "inkpoint",
    updatedAt: new Date().toISOString(),
    total: releases.length,
    latestDesktopVersion,
    latestAndroidVersion,
    releases,
  };
}

/**
 * 获取全量版本发布数据（服务端 Next.js ISR 数据源）
 */
export async function getReleasesData(): Promise<ReleasesData> {
  try {
    const res = await fetch(RELEASES_API_URL, {
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(3000),
    });

    if (res.ok) {
      const data = (await res.json()) as ReleasesData;
      if (data && Array.isArray(data.releases) && data.releases.length > 0) {
        return data;
      }
    }
  } catch {
    // 捕获网络异常、超时或离线单测环境，优雅回退
  }

  return buildFallbackReleasesData();
}
