import { inferDownloadEvent, recordDownload } from "./analytics.ts";
import type {
  AppVersionManifest,
  Env,
  ReleaseAssetInfo,
  ReleaseInfo,
  ReleasesManifest,
} from "./types.ts";
import {
  formatBytes,
  renderAppDevicesHtml,
  renderAppIndexHtml,
  renderDeviceVersionsHtml,
  renderVersionFilesHtml,
} from "./portal.ts";
import fallbackManifest from "./fallback-releases.json";

export const SUPPORTED_APPS = [
  {
    name: "inkpoint",
    title: "Inkpoint",
    description: "下一代跨平台 Markdown 知识管理与富文本编辑器",
  },
];

export const KNOWN_PLATFORM_CATEGORIES = new Set(["android", "desktop", "mobile"]);

export const MIME_TYPES: Record<string, string> = {
  dmg: "application/x-apple-diskimage",
  exe: "application/x-msdownload",
  AppImage: "application/x-executable",
  appimage: "application/x-executable",
  deb: "application/vnd.debian.binary-package",
  apk: "application/vnd.android.package-archive",
  gz: "application/gzip",
  zip: "application/zip",
  sig: "text/plain",
  json: "application/json",
};

export function getMimeType(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  return MIME_TYPES[ext] || "application/octet-stream";
}

/**
 * 辅助函数：根据平台关键词从 GitHub Release 资产列表中匹配对应的安装包 URL
 */
export function matchDesktopAsset(
  assets: Array<{ name: string; browser_download_url: string; size: number }>,
  platform: string,
): { name: string; url: string; size: number } | null {
  const p = platform.toLowerCase();

  for (const asset of assets) {
    const name = asset.name.toLowerCase();

    // macOS Apple Silicon (ARM64)
    if (
      (p === "macos" || p === "macos-arm64" || p === "mac" || p === "mac-arm64") &&
      name.endsWith(".dmg")
    ) {
      if (name.includes("aarch64") || name.includes("arm64")) {
        return { name: asset.name, url: asset.browser_download_url, size: asset.size };
      }
    }
    // macOS Intel (x64)
    if ((p === "macos-x64" || p === "mac-intel") && name.endsWith(".dmg")) {
      if (name.includes("x64") || name.includes("x86_64")) {
        return { name: asset.name, url: asset.browser_download_url, size: asset.size };
      }
    }
    // Windows x64 Setup
    if (
      (p === "windows" || p === "windows-x64" || p === "win" || p === "win-x64") &&
      name.endsWith(".exe")
    ) {
      if (name.includes("x64") && !name.includes("arm64")) {
        return { name: asset.name, url: asset.browser_download_url, size: asset.size };
      }
    }
    // Windows ARM64 Setup
    if ((p === "windows-arm64" || p === "win-arm64") && name.endsWith(".exe")) {
      if (name.includes("arm64")) {
        return { name: asset.name, url: asset.browser_download_url, size: asset.size };
      }
    }
    // Linux AppImage
    if ((p === "linux" || p === "linux-x64" || p === "appimage") && name.endsWith(".appimage")) {
      return { name: asset.name, url: asset.browser_download_url, size: asset.size };
    }
    // Linux Deb
    if ((p === "linux-deb" || p === "deb") && name.endsWith(".deb")) {
      return { name: asset.name, url: asset.browser_download_url, size: asset.size };
    }
  }

  // 宽松回退匹配
  for (const asset of assets) {
    const name = asset.name.toLowerCase();
    if ((p.includes("mac") || p.includes("dmg")) && name.endsWith(".dmg")) {
      return { name: asset.name, url: asset.browser_download_url, size: asset.size };
    }
    if ((p.includes("win") || p.includes("exe")) && name.endsWith(".exe")) {
      return { name: asset.name, url: asset.browser_download_url, size: asset.size };
    }
    if (p.includes("linux") && name.endsWith(".appimage")) {
      return { name: asset.name, url: asset.browser_download_url, size: asset.size };
    }
  }

  return null;
}

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

function parseSemverComponents(v: string): number[] {
  return v
    .replace(/^v/i, "")
    .replace(/^desktop-v/i, "")
    .replace(/^android-v/i, "")
    .replace(/^mobile-v/i, "")
    .split(".")
    .map((num) => parseInt(num, 10) || 0);
}

export function compareSemver(a: string, b: string): number {
  const pa = parseSemverComponents(a);
  const pb = parseSemverComponents(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na !== nb) return na - nb;
  }
  return 0;
}

/**
 * 汇总构建全量历史版本清单
 */
export async function buildReleasesManifest(
  app: string,
  githubRepo: string,
  env: Env,
  baseUrl: string,
): Promise<ReleasesManifest> {
  let releases: ReleaseInfo[] = [];

  // 1. 如果 R2 中保存了预构建的 releases.json，优先直接读取
  if (env.RELEASE_BUCKET) {
    const r2Obj = await env.RELEASE_BUCKET.get(`${app}/releases.json`);
    if (r2Obj) {
      try {
        const text = await r2Obj.text();
        const parsed = JSON.parse(text) as ReleasesManifest;
        if (Array.isArray(parsed.releases) && parsed.releases.length > 0) {
          releases = parsed.releases;
        }
      } catch {
        // 解析失败则继续动态构建
      }
    }
  }

  // 2. 如果 R2 未命中，尝试从 GitHub 拉取全量 releases
  if (releases.length === 0) {
    const rawReleases = await fetchAllGitHubReleases(githubRepo, env);
    for (const raw of rawReleases) {
      const tagName = raw.tag_name || "";
      const isAndroidTag = tagName.startsWith("android-v") || tagName.startsWith("mobile-v");
      const isDesktopTag = tagName.startsWith("desktop-v") || /^v\d/.test(tagName);

      const assets: ReleaseAssetInfo[] = [];

      for (const asset of raw.assets || []) {
        const name = asset.name;
        const lower = name.toLowerCase();

        let platform: ReleaseAssetInfo["platform"] = "other";
        let platformLabel = "其他附件";

        if (lower.endsWith(".dmg")) {
          if (lower.includes("x64") || lower.includes("x86_64") || lower.includes("intel")) {
            platform = "macos-x64";
            platformLabel = "macOS (Intel) · DMG";
          } else {
            platform = "macos-arm64";
            platformLabel = "macOS (Apple Silicon) · DMG";
          }
        } else if (lower.endsWith(".exe")) {
          if (lower.includes("arm64")) {
            platform = "windows-arm64";
            platformLabel = "Windows (ARM64) · Setup";
          } else {
            platform = "windows-x64";
            platformLabel = "Windows (x64) · Setup";
          }
        } else if (lower.endsWith(".appimage")) {
          platform = "linux-appimage";
          platformLabel = lower.includes("arm64")
            ? "Linux (ARM64) · AppImage"
            : "Linux (x86_64) · AppImage";
        } else if (lower.endsWith(".deb")) {
          platform = "linux-deb";
          platformLabel = lower.includes("arm64") ? "Linux (ARM64) · DEB" : "Linux (x86_64) · DEB";
        } else if (lower.endsWith(".apk")) {
          platform = "android";
          platformLabel = "Android · APK";
        } else if (lower.endsWith(".tar.gz") || lower.endsWith(".sig")) {
          platform = "updater";
          platformLabel = lower.endsWith(".sig") ? "Tauri 签名文件" : "Tauri 自动更新包";
        }

        const rawVersionForAsset = tagName
          .replace(/^(?:desktop-)?v/i, "")
          .replace(/^(?:android|mobile)-v?/i, "");
        const downloadUrl = `${baseUrl}/${app}/${rawVersionForAsset}/${encodeURIComponent(name)}`;

        assets.push({
          platform,
          platformLabel,
          fileName: name,
          downloadUrl,
          sizeBytes: asset.size,
          formattedSize: formatBytes(asset.size),
          isR2Cached: rawVersionForAsset === "0.10.2",
        });
      }

      const hasAndroid = assets.some((a) => a.platform === "android");
      const hasDesktop = assets.some(
        (a) =>
          a.platform.includes("macos") ||
          a.platform.includes("windows") ||
          a.platform.includes("linux"),
      );

      const isAndroidRelease = isAndroidTag || (hasAndroid && !hasDesktop);
      const isDesktopRelease = !isAndroidRelease && (isDesktopTag || hasDesktop);

      // 仅保留桌面客户端与 Android 移动端发行版本，过滤 utools-v*、web-v* 或未知仓库 tag
      if (!isAndroidRelease && !isDesktopRelease) {
        continue;
      }

      const category: ReleaseInfo["category"] = isAndroidRelease ? "android" : "desktop";
      const version = isAndroidRelease
        ? tagName.replace(/^(?:android|mobile)-v?/i, "")
        : tagName.replace(/^(?:desktop-)?v/i, "");

      releases.push({
        version,
        tagName: raw.tag_name,
        publishedAt: raw.published_at || new Date().toISOString(),
        isLatest: false,
        isPrerelease: Boolean(raw.prerelease),
        category,
        releaseNotesUrl:
          raw.html_url || `https://github.com/${githubRepo}/releases/tag/${raw.tag_name}`,
        assets,
      });
    }

    let seenDesktop = false;
    for (const r of releases) {
      if (r.category === "desktop") {
        r.isLatest = !seenDesktop;
        seenDesktop = true;
      }
    }
  }

  // 3. 如果 GitHub API 失败或被限流，使用内置全量历史版本清单作为底座
  if (releases.length === 0) {
    const fallback = fallbackManifest as unknown as ReleasesManifest;
    if (fallback && Array.isArray(fallback.releases) && fallback.releases.length > 0) {
      releases = fallback.releases.map((rel) => ({
        ...rel,
        assets: (rel.assets || []).map((a) => ({
          ...a,
          isR2Cached: a.isR2Cached ?? rel.version === "0.10.2",
        })),
      }));
    }
  }

  // 3. 动态补全移动端（Android）最新发布条目，解决跨端版本号不一致导致翻找历史记录的问题
  let androidVersion = "0.1.0";
  let androidFileName = `Inkpoint_${androidVersion}.apk`;
  let androidSizeBytes = 45000000;
  let androidPublishedAt = "2026-09-16T12:00:00Z";

  let desktopVersion = "0.10.2";
  let desktopAssets: ReleaseAssetInfo[] = [];

  if (env.RELEASE_BUCKET) {
    const versionJsonObj = await env.RELEASE_BUCKET.get(`${app}/version.json`);
    if (versionJsonObj) {
      try {
        const vData = JSON.parse(await versionJsonObj.text()) as AppVersionManifest;
        if (vData.desktop?.version) {
          desktopVersion = vData.desktop.version;
          const dAssets = vData.desktop.assets;
          if (dAssets) {
            const list: ReleaseAssetInfo[] = [];
            if (dAssets.macos_arm64) {
              list.push({
                platform: "macos-arm64",
                platformLabel: "macOS (Apple Silicon) · DMG",
                fileName: dAssets.macos_arm64.fileName,
                downloadUrl: `${baseUrl}/${app}/desktop/macos/latest`,
                sizeBytes: dAssets.macos_arm64.sizeBytes || 0,
                formattedSize: formatBytes(dAssets.macos_arm64.sizeBytes || 0),
                isR2Cached: true,
              });
            }
            if (dAssets.windows_x64) {
              list.push({
                platform: "windows-x64",
                platformLabel: "Windows (x64) · Setup",
                fileName: dAssets.windows_x64.fileName,
                downloadUrl: `${baseUrl}/${app}/desktop/windows/latest`,
                sizeBytes: dAssets.windows_x64.sizeBytes || 0,
                formattedSize: formatBytes(dAssets.windows_x64.sizeBytes || 0),
                isR2Cached: true,
              });
            }
            if (dAssets.linux_appimage) {
              list.push({
                platform: "linux-appimage",
                platformLabel: "Linux (x86_64) · AppImage",
                fileName: dAssets.linux_appimage.fileName,
                downloadUrl: `${baseUrl}/${app}/desktop/linux/latest`,
                sizeBytes: dAssets.linux_appimage.sizeBytes || 0,
                formattedSize: formatBytes(dAssets.linux_appimage.sizeBytes || 0),
                isR2Cached: true,
              });
            }
            if (dAssets.linux_deb) {
              list.push({
                platform: "linux-deb",
                platformLabel: "Linux · DEB",
                fileName: dAssets.linux_deb.fileName,
                downloadUrl: `${baseUrl}/${app}/desktop/${desktopVersion}/${dAssets.linux_deb.fileName}`,
                sizeBytes: dAssets.linux_deb.sizeBytes || 0,
                formattedSize: formatBytes(dAssets.linux_deb.sizeBytes || 0),
                isR2Cached: true,
              });
            }
            if (list.length > 0) {
              desktopAssets = list;
            }
          }
        }
        if (vData.android?.version) {
          androidVersion = vData.android.version;
          if (vData.android.apk?.fileName) {
            androidFileName = vData.android.apk.fileName;
          }
          if (vData.android.apk?.sizeBytes) {
            androidSizeBytes = vData.android.apk.sizeBytes;
          }
          if (vData.updatedAt) {
            androidPublishedAt = vData.updatedAt;
          }
        }
      } catch {
        // ignore
      }
    }
  }

  // 3. 检查并确保清单中包含 R2 version.json 指定的桌面版本
  const existingDesktop = releases.find(
    (r) =>
      r.version === desktopVersion ||
      r.tagName === `v${desktopVersion}` ||
      r.tagName === `desktop-v${desktopVersion}`,
  );

  if (!existingDesktop) {
    releases.unshift({
      version: desktopVersion,
      tagName: `v${desktopVersion}`,
      publishedAt: new Date().toISOString(),
      isLatest: true,
      isPrerelease: false,
      category: "desktop",
      releaseNotesUrl: `https://github.com/${githubRepo}/releases/tag/v${desktopVersion}`,
      assets:
        desktopAssets.length > 0
          ? desktopAssets
          : [
              {
                platform: "macos-arm64",
                platformLabel: "macOS (Apple Silicon) · DMG",
                fileName: `Inkpoint_${desktopVersion}_aarch64.dmg`,
                downloadUrl: `${baseUrl}/${app}/desktop/macos/latest`,
                sizeBytes: 30680892,
                formattedSize: "29.3 MB",
                isR2Cached: true,
              },
              {
                platform: "windows-x64",
                platformLabel: "Windows (x64) · Setup",
                fileName: `Inkpoint_${desktopVersion}_x64-setup.exe`,
                downloadUrl: `${baseUrl}/${app}/desktop/windows/latest`,
                sizeBytes: 8072766,
                formattedSize: "7.7 MB",
                isR2Cached: true,
              },
              {
                platform: "linux-appimage",
                platformLabel: "Linux (x86_64) · AppImage",
                fileName: `Inkpoint_${desktopVersion}_amd64.AppImage`,
                downloadUrl: `${baseUrl}/${app}/desktop/linux/latest`,
                sizeBytes: 91474424,
                formattedSize: "87.2 MB",
                isR2Cached: true,
              },
            ],
    });

    for (let i = 1; i < releases.length; i++) {
      if (releases[i].category === "desktop") {
        releases[i].isLatest = false;
      }
    }
  }

  // 4. 枚举与合并全量 Android Release 列表（从 R2 Bucket、version.json 与已存在清单汇总）
  const androidMap = new Map<string, ReleaseInfo>();

  // A. 首先保留当前 releases 列表中已有的 Android 记录
  for (const r of releases) {
    if (r.category === "android" || r.assets.some((a) => a.platform === "android")) {
      androidMap.set(r.version, {
        ...r,
        category: "android",
      });
    }
  }

  // A2. 从内置 fallback 清单补充已知 Android 发布
  const fallback = fallbackManifest as unknown as ReleasesManifest;
  if (Array.isArray(fallback?.releases)) {
    for (const r of fallback.releases) {
      if (
        (r.category === "android" || r.assets?.some((a) => a.platform === "android")) &&
        !androidMap.has(r.version)
      ) {
        androidMap.set(r.version, {
          ...r,
          category: "android",
        });
      }
    }
  }

  // B. 扫描 R2 存储桶中物理存在的所有 Android APK 版本
  if (env.RELEASE_BUCKET && typeof env.RELEASE_BUCKET.list === "function") {
    try {
      const listRes = await env.RELEASE_BUCKET.list({ prefix: `${app}/android/` });
      if (Array.isArray(listRes?.objects)) {
        for (const obj of listRes.objects) {
          const match = obj.key.match(new RegExp(`^${app}/android/([^/]+)/([^/]+\\.apk)$`));
          if (match) {
            const v = match[1];
            const fileName = match[2];
            if (v !== "latest" && !fileName.includes("unaligned")) {
              const asset: ReleaseAssetInfo = {
                platform: "android",
                platformLabel: "Android · APK (Beta)",
                fileName,
                downloadUrl: `${baseUrl}/${app}/android/${v}/${fileName}`,
                sizeBytes: obj.size,
                formattedSize: formatBytes(obj.size),
                isR2Cached: true,
              };

              const existing = androidMap.get(v);
              if (!existing) {
                androidMap.set(v, {
                  version: v,
                  tagName: `android-v${v}`,
                  publishedAt: obj.uploaded ? obj.uploaded.toISOString() : new Date().toISOString(),
                  isLatest: false,
                  isPrerelease: true,
                  category: "android",
                  releaseNotesUrl: `https://github.com/${githubRepo}/releases/tag/android-v${v}`,
                  assets: [asset],
                });
              } else if (!existing.assets.some((a) => a.fileName === fileName)) {
                existing.assets.push(asset);
              }
            }
          }
        }
      }
    } catch {
      // 容灾忽略
    }
  }

  // C. 确保 version.json 中指定的最新 Android 版本也在 map 中
  if (androidVersion && !androidMap.has(androidVersion)) {
    androidMap.set(androidVersion, {
      version: androidVersion,
      tagName: `android-v${androidVersion}`,
      publishedAt: androidPublishedAt,
      isLatest: false,
      isPrerelease: true,
      category: "android",
      releaseNotesUrl: `https://github.com/${githubRepo}/releases/tag/android-v${androidVersion}`,
      assets: [
        {
          platform: "android",
          platformLabel: "Android · APK (Beta)",
          fileName: androidFileName,
          downloadUrl: `${baseUrl}/${app}/android/${androidVersion}/${androidFileName}`,
          sizeBytes: androidSizeBytes,
          formattedSize: formatBytes(androidSizeBytes),
          isR2Cached: true,
        },
      ],
    });
  }

  // D. 排序并标记最新版本
  const sortedAndroid = Array.from(androidMap.values()).toSorted((a, b) =>
    compareSemver(b.version, a.version),
  );

  for (let i = 0; i < sortedAndroid.length; i++) {
    sortedAndroid[i].isLatest = i === 0;
  }

  // E. 从 releases 中剔除旧的 Android 项，并将有序的全部 Android 版本追加进去
  releases = releases.filter(
    (r) => r.category !== "android" && !r.assets.some((a) => a.platform === "android"),
  );
  releases.push(...sortedAndroid);

  // 5. 计算各端最新版本与直达摘要
  const desktopRelease = releases.find((r) => r.category === "desktop");
  const topAndroid = sortedAndroid[0];

  const latestDesktopVersion = desktopRelease?.version || releases[0]?.version || "0.10.2";
  const latestAndroidVersion = topAndroid?.version || androidVersion;

  return {
    app,
    updatedAt: new Date().toISOString(),
    total: releases.length,
    latestVersion: latestDesktopVersion,
    latestDesktopVersion,
    latestAndroidVersion,
    latestReleases: {
      desktop: {
        version: latestDesktopVersion,
        downloadUrl: `${baseUrl}/${app}/${latestDesktopVersion}/`,
        assets: desktopRelease?.assets || [],
      },
      android: {
        version: latestAndroidVersion,
        downloadUrl: `${baseUrl}/${app}/android/latest`,
        fileName: topAndroid?.assets?.[0]?.fileName || androidFileName,
        formattedSize: topAndroid?.assets?.[0]?.formattedSize || formatBytes(androidSizeBytes),
      },
    },
    releases,
  };
}

/**
 * 流式代理并加速 GitHub 资产下载
 */
export async function proxyGitHubAsset(
  sourceUrl: string,
  request: Request,
  customFileName?: string,
): Promise<Response> {
  // 构造回源请求，转发必要的客户端请求头（如 Range）
  const forwardHeaders = new Headers();
  forwardHeaders.set("User-Agent", "Inkpoint-Distribution-Worker/1.0");

  const range = request.headers.get("Range");
  if (range) {
    forwardHeaders.set("Range", range);
  }

  // GitHub Releases 下载链接通常会 302 重定向到 objects.githubusercontent.com
  const response = await fetch(sourceUrl, {
    headers: forwardHeaders,
    redirect: "follow",
  });

  if (!response.ok && response.status !== 206) {
    return new Response(
      JSON.stringify({
        error: "Failed to fetch upstream asset from GitHub",
        status: response.status,
        statusText: response.statusText,
        source: sourceUrl,
      }),
      {
        status: response.status,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  // 构造响应头，设置长期边缘缓存策略
  const responseHeaders = new Headers(response.headers);
  responseHeaders.set("Access-Control-Allow-Origin", "*");
  // 对安装包二进制文件设置 30 天边缘缓存与 1 天客户端缓存
  responseHeaders.set("Cache-Control", "public, max-age=86400, s-maxage=2592000");

  if (customFileName) {
    responseHeaders.set(
      "Content-Disposition",
      `attachment; filename="${encodeURIComponent(customFileName)}"`,
    );
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  });
}

/**
 * 从 R2 读取对象并返回流式响应
 */
export async function serveR2Object(
  object: R2ObjectBody,
  customFileName?: string,
  contentType = "application/octet-stream",
  isImmutable = true,
): Promise<Response> {
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("Content-Type", contentType);
  headers.set("Access-Control-Allow-Origin", "*");
  if (isImmutable) {
    headers.set("Cache-Control", "public, max-age=2592000, s-maxage=31536000, immutable");
  } else {
    headers.set(
      "Cache-Control",
      "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
    );
  }

  if (customFileName) {
    headers.set(
      "Content-Disposition",
      `attachment; filename="${encodeURIComponent(customFileName)}"`,
    );
  }

  return new Response(object.body, {
    headers,
  });
}

/**
 * 核心请求处理器
 */
export async function handleRequest(
  request: Request,
  env: Env,
  ctx?: ExecutionContext,
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const defaultApp = env.DEFAULT_APP || "inkpoint";
  const githubRepo = env.GITHUB_REPO || "wmasfoe/md-editor";

  /** 非阻塞记录下载统计（通过 ctx.waitUntil 异步执行，不影响响应延迟） */
  function trackDownload(app: string, version: string, fileName: string): void {
    if (!ctx || request.method !== "GET") return;
    const lower = fileName.toLowerCase();
    if (lower.endsWith(".sig") || lower.endsWith(".sha256") || lower.endsWith(".json")) {
      return;
    }
    const event = inferDownloadEvent(request, app, version, fileName);
    ctx.waitUntil(recordDownload(ctx, env, request, event));
  }

  // 1. 边缘静态缓存命中检查（只缓存 GET / HEAD 请求，大幅削减 Worker 计费与额度消耗）
  // 本地开发环境 (localhost / 127.0.0.1) 或客户端携带 no-cache 时跳过缓存，确保开发热更与调试实时生效
  const isDevHost = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  const clientBypassCache =
    request.headers.get("Cache-Control")?.includes("no-cache") ||
    request.headers.get("Pragma")?.includes("no-cache");

  const cache =
    typeof caches !== "undefined" && "default" in caches
      ? (caches as unknown as { default: Cache }).default
      : null;
  if (
    cache &&
    !isDevHost &&
    !clientBypassCache &&
    (request.method === "GET" || request.method === "HEAD")
  ) {
    const cachedResponse = await cache.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }
  }

  function respond(response: Response, isStatic = false): Response {
    if (!response.headers.has("Access-Control-Allow-Origin")) {
      response.headers.set("Access-Control-Allow-Origin", "*");
    }
    if (isDevHost) {
      response.headers.set("Cache-Control", "no-cache, no-store, must-revalidate");
    } else if (!response.headers.has("Cache-Control")) {
      if (isStatic) {
        response.headers.set(
          "Cache-Control",
          "public, max-age=2592000, s-maxage=31536000, immutable",
        );
      } else {
        response.headers.set(
          "Cache-Control",
          "public, max-age=60, s-maxage=600, stale-while-revalidate=86400",
        );
      }
    }
    if (
      cache &&
      ctx &&
      !isDevHost &&
      response.ok &&
      (request.method === "GET" || request.method === "HEAD")
    ) {
      ctx.waitUntil(cache.put(request, response.clone()));
    }
    return response;
  }

  // 1.0 缓存清理端点: POST /api/purge-cache
  if (path === "/api/purge-cache") {
    if (request.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method Not Allowed" }), {
        status: 405,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    if (env.PURGE_TOKEN) {
      const authHeader = request.headers.get("Authorization");
      const tokenHeader = request.headers.get("X-Purge-Token");
      const bearer = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
      const token = tokenHeader || bearer || url.searchParams.get("token");
      if (token !== env.PURGE_TOKEN) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        });
      }
    }

    let purgeUrls: string[] = [];
    try {
      const body = (await request.json().catch(() => ({}))) as { urls?: string[] };
      if (Array.isArray(body.urls) && body.urls.length > 0) {
        purgeUrls = body.urls;
      }
    } catch {
      // ignore
    }

    if (purgeUrls.length === 0) {
      purgeUrls = [
        `${url.origin}/`,
        `${url.origin}/${defaultApp}/`,
        `${url.origin}/${defaultApp}`,
        `${url.origin}/${defaultApp}/desktop/`,
        `${url.origin}/${defaultApp}/desktop`,
        `${url.origin}/${defaultApp}/android/`,
        `${url.origin}/${defaultApp}/android`,
        `${url.origin}/releases`,
        `${url.origin}/releases/desktop`,
        `${url.origin}/releases/android`,
        `${url.origin}/api/${defaultApp}/version.json`,
        `${url.origin}/api/${defaultApp}/releases`,
        `${url.origin}/api/${defaultApp}/releases.json`,
        `${url.origin}/${defaultApp}/desktop/updater.json`,
      ];
    }

    const purged: string[] = [];
    if (cache) {
      for (const purgeUrl of purgeUrls) {
        try {
          await cache.delete(new Request(purgeUrl, { method: "GET" }));
          await cache.delete(new Request(purgeUrl, { method: "HEAD" }));
          purged.push(purgeUrl);
        } catch {
          // ignore
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: "Cache purged successfully",
        purgedCount: purged.length,
        purgedUrls: purged,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      },
    );
  }

  // 1. 首页路由：浏览器访问返回应用目录索引 (Index of /)，CLI / API 访问返回网关路由描述
  if (path === "/") {
    const accept = request.headers.get("Accept") || "";
    if (accept.includes("text/html")) {
      const html = renderAppIndexHtml(SUPPORTED_APPS, url.origin);
      return respond(
        new Response(html, {
          headers: {
            "Content-Type": "text/html; charset=utf-8",
          },
        }),
      );
    }

    return new Response(
      JSON.stringify(
        {
          name: "Inkpoint Global Distribution Gateway",
          description:
            "Cloudflare Worker & R2 Edge Distribution for Inkpoint and Multi-App Ecosystem",
          repo: githubRepo,
          routes: {
            appIndex: "/",
            appReleases: "/:app/",
            versionFiles: "/:app/:version/",
            versionDownload: "/:app/:version/:filename",
            releasesPortal: "/releases",
            releasesApi: "/api/:app/releases",
            versionManifest: "/api/:app/version.json",
            desktopUpdater: "/:app/desktop/updater.json",
            desktopLatest: "/:app/desktop/:platform/latest",
            androidLatest: "/:app/android/latest",
            githubMirror: "/gh/:org/:repo/releases/download/:tag/:filename",
          },
          supportedPlatforms: [
            "macos",
            "macos-x64",
            "windows",
            "windows-arm64",
            "linux",
            "android",
          ],
        },
        null,
        2,
      ),
      {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      },
    );
  }

  // 2. 版本清单 API 路由体系 (Strict /api/:app/... Hierarchy)
  // 规范主路径：
  // - /api/:app/:device/releases (如 /api/inkpoint/android/releases, /api/inkpoint/desktop/releases)
  // - /api/:app/releases/:device (如 /api/inkpoint/releases/android)
  // - /api/:app/releases (如 /api/inkpoint/releases)
  // - /api/:app/version.json (如 /api/inkpoint/version.json)
  // 快捷别名重定向（302 重定向至带 :app 的规范路径，保持生态严谨一致）：
  // - /api/:device/releases 或 /api/releases/:device -> /api/:defaultApp/:device/releases
  // - /api/releases -> /api/:defaultApp/releases

  // A. 缺少 :app 名称的平台版本请求 -> 302 重定向到包含 :app 的规范路径
  const noAppDeviceReleasesMatch =
    path.match(/^\/api\/(android|desktop|mobile)\/releases(?:\.json)?$/) ||
    path.match(/^\/api\/releases\/(android|desktop|mobile)(?:\.json)?$/);

  if (noAppDeviceReleasesMatch) {
    const rawCat = noAppDeviceReleasesMatch[1];
    const category = rawCat === "mobile" ? "android" : rawCat;
    return Response.redirect(`${url.origin}/api/${defaultApp}/${category}/releases`, 302);
  }

  // B. 缺少 :app 名称的根 releases API -> 302 重定向到规范路径
  if (path === "/api/releases" || path === "/api/releases.json") {
    return Response.redirect(`${url.origin}/api/${defaultApp}/releases`, 302);
  }

  // C. 规范的专属端版本清单 API: /api/:app/:device/releases 或 /api/:app/releases/:device
  const appDeviceReleasesMatch =
    path.match(/^\/api\/([^/]+)\/(android|desktop|mobile)\/releases(?:\.json)?$/) ||
    path.match(/^\/api\/([^/]+)\/releases\/(android|desktop|mobile)(?:\.json)?$/);

  if (appDeviceReleasesMatch) {
    const rawApp = appDeviceReleasesMatch[1];
    const cat = appDeviceReleasesMatch[2];
    const category = cat === "mobile" ? "android" : (cat as "android" | "desktop");
    const app = rawApp && !KNOWN_PLATFORM_CATEGORIES.has(rawApp) ? rawApp : defaultApp;

    const manifest = await buildReleasesManifest(app, githubRepo, env, url.origin);
    let releases = manifest.releases.filter(
      (r) =>
        r.category === category ||
        (category === "android" && r.assets.some((a) => a.platform === "android")) ||
        (category === "desktop" &&
          r.assets.some(
            (a) =>
              a.platform.includes("macos") ||
              a.platform.includes("windows") ||
              a.platform.includes("linux"),
          )),
    );

    releases = releases.map((r, index) => ({
      ...r,
      isLatest: index === 0,
    }));

    const resultManifest: ReleasesManifest = {
      ...manifest,
      releases,
    };

    return respond(
      new Response(JSON.stringify(resultManifest, null, 2), {
        headers: {
          "Content-Type": "application/json",
        },
      }),
    );
  }

  // D. 规范的应用全量版本清单 API: /api/:app/releases(.json)? 或 /api/:app/history
  const appReleasesMatch = path.match(/^\/api\/([^/]+)\/(?:releases|history)(?:\.json)?$/);
  if (appReleasesMatch) {
    const rawApp = appReleasesMatch[1];
    const app = rawApp && !KNOWN_PLATFORM_CATEGORIES.has(rawApp) ? rawApp : defaultApp;
    const manifest = await buildReleasesManifest(app, githubRepo, env, url.origin);
    return respond(
      new Response(JSON.stringify(manifest, null, 2), {
        headers: {
          "Content-Type": "application/json",
        },
      }),
    );
  }

  // E. 版本元数据 API: /api/:app/version.json 或 /api/version.json
  const apiMatch = path.match(/^\/api(?:\/([^/]+))?\/version(?:\.json)?$/);
  if (apiMatch) {
    let app = apiMatch[1] || defaultApp;
    if (KNOWN_PLATFORM_CATEGORIES.has(app)) {
      app = defaultApp;
    }

    // A. 尝试从 R2 存储桶读取已发布的 version.json
    if (env.RELEASE_BUCKET) {
      const r2Manifest = await env.RELEASE_BUCKET.get(`${app}/version.json`);
      if (r2Manifest) {
        return respond(
          new Response(r2Manifest.body, {
            headers: {
              "Content-Type": "application/json",
            },
          }),
        );
      }
    }

    // B. 回退方案：动态从 GitHub Releases 提取最新桌面版并结合已知移动版返回基础清单
    const release = await fetchLatestRelease(githubRepo, env);
    if (release) {
      const version = release.tag_name.replace(/^(?:desktop-)?v/, "");
      const macArm = matchDesktopAsset(release.assets, "macos");
      const winX64 = matchDesktopAsset(release.assets, "windows");
      const linuxApp = matchDesktopAsset(release.assets, "linux");

      const dynamicManifest: AppVersionManifest = {
        app,
        updatedAt: new Date().toISOString(),
        desktop: {
          version,
          releaseNotesUrl: `https://github.com/${githubRepo}/releases/tag/${release.tag_name}`,
          assets: {
            macos_arm64: macArm
              ? {
                  version,
                  fileName: macArm.name,
                  downloadUrl: `${url.origin}/${app}/desktop/macos/latest`,
                  sizeBytes: macArm.size,
                }
              : undefined,
            windows_x64: winX64
              ? {
                  version,
                  fileName: winX64.name,
                  downloadUrl: `${url.origin}/${app}/desktop/windows/latest`,
                  sizeBytes: winX64.size,
                }
              : undefined,
            linux_appimage: linuxApp
              ? {
                  version,
                  fileName: linuxApp.name,
                  downloadUrl: `${url.origin}/${app}/desktop/linux/latest`,
                  sizeBytes: linuxApp.size,
                }
              : undefined,
          },
        },
        android: {
          version: "0.1.0",
          apk: {
            version: "0.1.0",
            fileName: "inkpoint-v0.1.0.apk",
            downloadUrl: `${url.origin}/${app}/android/latest`,
          },
        },
        ios: {
          version: "0.1.0",
          testFlightUrl: "https://testflight.apple.com/join/placeholder",
        },
      };

      return respond(
        new Response(JSON.stringify(dynamicManifest, null, 2), {
          headers: {
            "Content-Type": "application/json",
          },
        }),
      );
    }

    return new Response(
      JSON.stringify({
        app,
        updatedAt: new Date().toISOString(),
        error: "Manifest not found in R2 and upstream unavailable",
      }),
      {
        status: 404,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      },
    );
  }

  // 3. 通用 GitHub Release 镜像路由: /gh/:owner/:repo/releases/download/:tag/:file
  if (path.startsWith("/gh/")) {
    const rawTarget = path.replace(/^\/gh\//, "https://github.com/");
    return proxyGitHubAsset(rawTarget, request);
  }

  // 4. 桌面端应用内自动更新清单加速: /:app/desktop/updater.json 或 /desktop/updater.json
  const updaterMatch = path.match(/^(?:\/([^/]+))?\/desktop\/updater(?:\.json)?$/);
  if (updaterMatch) {
    const app = updaterMatch[1] || defaultApp;

    // A. 优先从 R2 存储桶读取发布的 updater.json
    if (env.RELEASE_BUCKET) {
      const r2Updater = await env.RELEASE_BUCKET.get(`${app}/desktop/updater.json`);
      if (r2Updater) {
        return respond(
          new Response(r2Updater.body, {
            headers: {
              "Content-Type": "application/json",
            },
          }),
        );
      }
    }

    // B. 回退方案：从 GitHub homebrew-tap 读取并加速
    try {
      const upstream = await fetch(
        "https://raw.githubusercontent.com/wmasfoe/homebrew-tap/main/md-editor-latest.json",
        { headers: { "User-Agent": "Inkpoint-Distribution-Worker/1.0" } },
      );

      if (!upstream.ok) {
        return new Response(
          JSON.stringify({
            error: "Failed to fetch updater manifest",
            status: upstream.status,
          }),
          {
            status: upstream.status,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      const rawText = await upstream.text();
      const manifest = JSON.parse(rawText) as {
        version: string;
        notes?: string;
        platforms: Record<string, { signature: string; url: string }>;
      };

      // 智能将 GitHub 原始下载链接重写为 Worker 边缘加速链接
      if (manifest.platforms) {
        for (const key of Object.keys(manifest.platforms)) {
          const item = manifest.platforms[key];
          if (item?.url && item.url.startsWith("https://github.com/")) {
            item.url = `${url.origin}/gh/${item.url.replace("https://github.com/", "")}`;
          }
        }
      }

      return respond(
        new Response(JSON.stringify(manifest, null, 2), {
          headers: {
            "Content-Type": "application/json",
          },
        }),
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return new Response(
        JSON.stringify({ error: "Failed to process updater manifest", details: message }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
  }

  // 5. Android 最新版直链: /:app/android/latest 或 /android/latest
  const androidMatch = path.match(/^(?:\/([^/]+))?\/android\/(?:latest|latest\.apk)$/);
  if (androidMatch) {
    const app = androidMatch[1] || defaultApp;

    if (env.RELEASE_BUCKET) {
      // 优先找最新版软链/定名文件
      const latestObj = await env.RELEASE_BUCKET.get(`${app}/android/latest.apk`);
      if (latestObj) {
        trackDownload(app, "latest", `${app}-latest.apk`);
        return serveR2Object(
          latestObj,
          `${app}-latest.apk`,
          "application/vnd.android.package-archive",
        );
      }

      // 如果未放 latest.apk，检查清单中指定的最新版
      const manifestObj = await env.RELEASE_BUCKET.get(`${app}/version.json`);
      if (manifestObj) {
        try {
          const manifest = JSON.parse(await manifestObj.text()) as AppVersionManifest;
          if (manifest.android?.version) {
            const version = manifest.android.version;
            const versionObj =
              (await env.RELEASE_BUCKET.get(`${app}/android/${version}/Inkpoint_${version}.apk`)) ||
              (await env.RELEASE_BUCKET.get(`${app}/android/${version}/app-debug.apk`)) ||
              (await env.RELEASE_BUCKET.get(`${app}/android/${version}/inkpoint-${version}.apk`));
            if (versionObj) {
              trackDownload(app, version, `Inkpoint_${version}.apk`);
              return serveR2Object(
                versionObj,
                `Inkpoint_${version}.apk`,
                "application/vnd.android.package-archive",
              );
            }
          }
        } catch {
          // 清单解析失败
        }
      }
    }

    return new Response(
      JSON.stringify({
        error: "Android release artifact not found in R2 bucket",
        app,
        help: "Please upload APK via GitHub Actions workflow 'release-mobile.yml'",
      }),
      { status: 404, headers: { "Content-Type": "application/json" } },
    );
  }

  // 4.5 一键安装脚本路由: /:app/desktop/install.(sh|ps1), /desktop/install.(sh|ps1), /install.(sh|ps1)
  const installScriptMatch = path.match(/^(?:\/([^/]+))?(?:\/desktop)?\/(install\.(?:sh|ps1))$/);
  if (installScriptMatch) {
    const app = installScriptMatch[1] || defaultApp;
    const scriptFile = installScriptMatch[2];
    const isPowerShell = scriptFile.endsWith(".ps1");
    const contentType = isPowerShell
      ? "text/plain; charset=utf-8"
      : "text/x-shellscript; charset=utf-8";

    // A. 优先从 R2 存储桶读取
    if (env.RELEASE_BUCKET) {
      const candidates = [
        `${app}/desktop/${scriptFile}`,
        `${app}/${scriptFile}`,
        `desktop/${scriptFile}`,
        scriptFile,
      ];
      for (const candidate of candidates) {
        const r2Obj = await env.RELEASE_BUCKET.get(candidate);
        if (r2Obj) {
          return serveR2Object(r2Obj, scriptFile, contentType, false);
        }
      }
    }

    // B. 回退代理 GitHub 上游 raw 脚本
    const githubRawFileName = isPowerShell ? "install-md-editor.ps1" : "install-md-editor.sh";
    const rawUrls = [
      `https://raw.githubusercontent.com/wmasfoe/homebrew-tap/main/${githubRawFileName}`,
      `https://raw.githubusercontent.com/${githubRepo}/main/${scriptFile}`,
    ];

    for (const rawUrl of rawUrls) {
      try {
        const rawRes = await fetch(rawUrl, {
          headers: { "User-Agent": "Inkpoint-Distribution-Worker/1.0" },
        });
        if (rawRes.ok) {
          const content = await rawRes.text();
          return respond(
            new Response(content, {
              status: 200,
              headers: {
                "Content-Type": contentType,
                "Access-Control-Allow-Origin": "*",
                "Cache-Control": "public, max-age=300, s-maxage=600",
              },
            }),
          );
        }
      } catch {
        // try next fallback
      }
    }

    return new Response(
      JSON.stringify({
        error: "Install script not found",
        script: scriptFile,
      }),
      { status: 404, headers: { "Content-Type": "application/json" } },
    );
  }

  // 5. 桌面端最新版直链: /:app/desktop/:platform/latest 或 /desktop/:platform/latest
  const desktopMatch = path.match(/^(?:\/([^/]+))?\/desktop\/([^/]+)\/latest$/);
  if (desktopMatch) {
    const app = desktopMatch[1] || defaultApp;
    const platform = desktopMatch[2].toLowerCase();

    // A. 优先从 R2 存储桶获取桌面端产物
    if (env.RELEASE_BUCKET) {
      const mimeTypes: Record<string, string> = {
        dmg: "application/x-apple-diskimage",
        exe: "application/x-msdownload",
        AppImage: "application/x-executable",
        appimage: "application/x-executable",
        deb: "application/vnd.debian.binary-package",
      };

      // 1. 尝试直接获取固化的 latest 别名文件
      const platformCandidates: Record<string, string[]> = {
        macos: [`${app}/desktop/macos/latest.dmg`, `${app}/desktop/latest.dmg`],
        "macos-arm64": [`${app}/desktop/macos/latest.dmg`],
        "macos-x64": [`${app}/desktop/macos-x64/latest.dmg`],
        windows: [`${app}/desktop/windows/latest.exe`, `${app}/desktop/latest.exe`],
        "windows-x64": [`${app}/desktop/windows/latest.exe`],
        "windows-arm64": [`${app}/desktop/windows-arm64/latest.exe`],
        linux: [`${app}/desktop/linux/latest.AppImage`, `${app}/desktop/latest.AppImage`],
        "linux-x64": [`${app}/desktop/linux/latest.AppImage`],
        "linux-deb": [`${app}/desktop/linux/latest.deb`],
      };

      const candidates = platformCandidates[platform] || [
        `${app}/desktop/${platform}/latest.dmg`,
        `${app}/desktop/${platform}/latest.exe`,
        `${app}/desktop/${platform}/latest.AppImage`,
      ];

      for (const candidate of candidates) {
        const r2Obj = await env.RELEASE_BUCKET.get(candidate);
        if (r2Obj) {
          const ext = candidate.split(".").pop() || "";
          trackDownload(app, "latest", `${app}-${platform}-latest.${ext}`);
          return serveR2Object(
            r2Obj,
            `${app}-${platform}-latest.${ext}`,
            mimeTypes[ext] || "application/octet-stream",
          );
        }
      }

      // 2. 检查 R2 中的 version.json 获取已发布的具体文件名
      const manifestObj = await env.RELEASE_BUCKET.get(`${app}/version.json`);
      if (manifestObj) {
        try {
          const manifest = JSON.parse(await manifestObj.text()) as AppVersionManifest;
          const dVer = manifest.desktop?.version;
          const dAssets = manifest.desktop?.assets;
          if (dVer && dAssets) {
            let assetInfo;
            if (platform.includes("mac") || platform.includes("dmg")) {
              assetInfo = platform.includes("x64") ? dAssets.macos_x64 : dAssets.macos_arm64;
            } else if (platform.includes("win") || platform.includes("exe")) {
              assetInfo = platform.includes("arm64") ? dAssets.windows_arm64 : dAssets.windows_x64;
            } else if (platform.includes("deb")) {
              assetInfo = dAssets.linux_deb;
            } else if (platform.includes("linux") || platform.includes("appimage")) {
              assetInfo = dAssets.linux_appimage;
            }

            if (assetInfo?.fileName) {
              const versionedObj = await env.RELEASE_BUCKET.get(
                `${app}/desktop/${dVer}/${assetInfo.fileName}`,
              );
              if (versionedObj) {
                const ext = assetInfo.fileName.split(".").pop() || "";
                trackDownload(app, dVer, assetInfo.fileName);
                return serveR2Object(
                  versionedObj,
                  assetInfo.fileName,
                  mimeTypes[ext] || "application/octet-stream",
                );
              }
            }
          }
        } catch {
          // 清单解析失败时继续回退 GitHub
        }
      }
    }

    // B. 回退方案：从 GitHub Releases 代理获取
    try {
      const release = await fetchLatestRelease(githubRepo, env);

      if (release) {
        const matched = matchDesktopAsset(release.assets, platform);
        if (matched) {
          const v = release.tag_name.replace(/^(?:desktop-)?v/, "");
          trackDownload(app, v, matched.name);
          return proxyGitHubAsset(matched.url, request, matched.name);
        }

        return new Response(
          JSON.stringify({
            error: `No asset found matching platform '${platform}'`,
            availableAssets: release.assets.map((a) => a.name),
          }),
          { status: 404, headers: { "Content-Type": "application/json" } },
        );
      }

      // 如果 GitHub API 频控 (403) 且无本地缓存，直接代理至 GitHub latest/download 约定命名直链，避免 502
      let fallbackFileName = "Inkpoint_aarch64.dmg";
      const p = platform.toLowerCase();
      if (p.includes("mac") || p.includes("dmg")) {
        fallbackFileName = p.includes("x64") ? "Inkpoint_x64.dmg" : "Inkpoint_aarch64.dmg";
      } else if (p.includes("win") || p.includes("exe")) {
        fallbackFileName = p.includes("arm64")
          ? "Inkpoint_arm64-setup.exe"
          : "Inkpoint_x64-setup.exe";
      } else if (p.includes("linux") || p.includes("appimage")) {
        fallbackFileName = "Inkpoint_amd64.AppImage";
      }

      const fallbackUrl = `https://github.com/${githubRepo}/releases/latest/download/${fallbackFileName}`;
      const proxyRes = await proxyGitHubAsset(fallbackUrl, request, fallbackFileName);
      if (proxyRes.ok || proxyRes.status === 206) {
        trackDownload(app, "latest", fallbackFileName);
      }
      return proxyRes;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return new Response(JSON.stringify({ error: "Internal Gateway Error", details: message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  // 8. 规范 HTML 别名与快捷重定向（302 重定向至规范 /:app/:device/ 层级，严格消除平台名冒充应用名的歧义）
  if (
    path === "/android" ||
    path === "/android/" ||
    path === "/releases/android" ||
    path === "/releases/android/" ||
    path === "/releases/mobile" ||
    path === "/releases/mobile/" ||
    path === "/mobile" ||
    path === "/mobile/"
  ) {
    return Response.redirect(`${url.origin}/${defaultApp}/android/`, 302);
  }

  if (
    path === "/desktop" ||
    path === "/desktop/" ||
    path === "/releases/desktop" ||
    path === "/releases/desktop/"
  ) {
    return Response.redirect(`${url.origin}/${defaultApp}/desktop/`, 302);
  }

  if (path === "/releases" || path === "/releases/" || path === "/portal" || path === "/portal/") {
    return Response.redirect(`${url.origin}/${defaultApp}/`, 302);
  }

  // 9. 层级目录与安装包下载路由
  const segments = path.replace(/^\//, "").split("/").filter(Boolean);

  // 9.1 单段路径：应用设备目录 Index of /:app/ (如 /inkpoint)
  if (segments.length === 1) {
    const app = segments[0];
    if (!["api", "gh", "favicon.ico", "releases", "android", "desktop", "mobile"].includes(app)) {
      const manifest = await buildReleasesManifest(app, githubRepo, env, url.origin);
      const html = renderAppDevicesHtml(app, manifest, url.origin);
      return respond(
        new Response(html, {
          headers: {
            "Content-Type": "text/html; charset=utf-8",
          },
        }),
      );
    }
  }

  // 9.2 双段路径：
  // a) /:app/desktop 或 /:app/android: 设备专属版本列表 Index of /:app/:device/
  // b) /:app/:version (兼容旧路由): 具体版本安装包详情
  if (segments.length === 2) {
    const [app, sub] = segments;
    if (!["api", "gh", "favicon.ico"].includes(app)) {
      const manifest = await buildReleasesManifest(app, githubRepo, env, url.origin);

      // 设备分类目录
      if (sub === "desktop") {
        const html = renderDeviceVersionsHtml(app, "desktop", manifest, url.origin);
        return respond(
          new Response(html, {
            headers: {
              "Content-Type": "text/html; charset=utf-8",
            },
          }),
        );
      }
      if (sub === "android" || sub === "mobile") {
        const html = renderDeviceVersionsHtml(app, "android", manifest, url.origin);
        return respond(
          new Response(html, {
            headers: {
              "Content-Type": "text/html; charset=utf-8",
            },
          }),
        );
      }

      // 兼容历史直接访问版本号 /:app/:version/
      const cleanVer = sub.replace(/^v/, "");
      const release = manifest.releases.find(
        (r) =>
          r.version === cleanVer ||
          r.version === sub ||
          r.tagName === sub ||
          r.tagName === `android-v${cleanVer}` ||
          r.tagName === `v${cleanVer}`,
      );

      if (release) {
        const device =
          release.category === "android" ||
          (release.assets.length > 0 && release.assets.every((a) => a.platform === "android"))
            ? "android"
            : "desktop";
        const html = renderVersionFilesHtml(app, device, release, url.origin);
        return respond(
          new Response(html, {
            headers: {
              "Content-Type": "text/html; charset=utf-8",
            },
          }),
        );
      }

      return new Response(
        JSON.stringify({
          error: "Version or device not found",
          app,
          sub,
          hint: `Check available directories at /${app}/`,
        }),
        {
          status: 404,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        },
      );
    }
  }

  // 9.3 三段路径：
  // a) /:app/:device/:version: 设备具体版本详情 (如 /inkpoint/desktop/0.10.2/)
  // b) /:app/:version/:filename: 历史旧下载链接
  if (segments.length === 3) {
    const [app, part2, part3] = segments;
    if (!["api", "gh"].includes(app)) {
      if (part2 === "desktop" || part2 === "android") {
        const device = part2;
        const version = part3;
        const manifest = await buildReleasesManifest(app, githubRepo, env, url.origin);
        const cleanVer = version.replace(/^v/, "");
        const release = manifest.releases.find(
          (r) =>
            (r.category === device ||
              (device === "android"
                ? r.assets.some((a) => a.platform === "android")
                : r.assets.some(
                    (a) =>
                      a.platform.includes("macos") ||
                      a.platform.includes("windows") ||
                      a.platform.includes("linux"),
                  ))) &&
            (r.version === cleanVer ||
              r.version === version ||
              r.tagName === version ||
              r.tagName === `android-v${cleanVer}` ||
              r.tagName === `v${cleanVer}`),
        );

        if (release) {
          const html = renderVersionFilesHtml(app, device, release, url.origin);
          return respond(
            new Response(html, {
              headers: {
                "Content-Type": "text/html; charset=utf-8",
              },
            }),
          );
        }

        return new Response(
          JSON.stringify({
            error: "Version not found for device",
            app,
            device,
            version,
            hint: `Check available versions at /${app}/${device}/`,
          }),
          {
            status: 404,
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
          },
        );
      }

      // b) 兼容旧三段路径下载: /:app/:version/:filename (要求 part2 为版本号且 part3 包含扩展名)
      if (part2.match(/^v?\d+\.\d+/) && part3.includes(".")) {
        const version = part2;
        const filename = part3;
        const contentType = getMimeType(filename);

        // A. 优先从 R2 获取
        if (env.RELEASE_BUCKET) {
          const r2Keys = [
            `${app}/desktop/${version}/${filename}`,
            `${app}/${version}/${filename}`,
            `${app}/android/${version}/${filename}`,
          ];

          for (const r2Key of r2Keys) {
            const obj = await env.RELEASE_BUCKET.get(r2Key);
            if (obj) {
              trackDownload(app, version, filename);
              return serveR2Object(obj, filename, contentType, true);
            }
          }
        }

        // B. 回退 GitHub Releases
        const targetTag = version.startsWith("v") ? version : `v${version}`;
        const sourceUrl = `https://github.com/${githubRepo}/releases/download/${targetTag}/${filename}`;
        const proxyRes = await proxyGitHubAsset(sourceUrl, request, filename);
        if (proxyRes.ok || proxyRes.status === 206) {
          trackDownload(app, version, filename);
        }
        return proxyRes;
      }
    }
  }

  // 9.4 四段路径：规范层级下载 /:app/:device/:version/:filename (如 /inkpoint/desktop/0.10.1/Inkpoint_0.10.1_aarch64.dmg)
  if (segments.length === 4) {
    const [app, device, version, filename] = segments;
    const knownDevices = ["desktop", "android", "macos", "windows", "linux", "mobile"];

    if (knownDevices.includes(device) && filename.includes(".")) {
      const contentType = getMimeType(filename);

      // A. 优先从 R2 获取
      if (env.RELEASE_BUCKET) {
        const r2Keys = [
          `${app}/${device}/${version}/${filename}`,
          `${app}/desktop/${version}/${filename}`,
          `${app}/android/${version}/${filename}`,
          `${app}/${version}/${filename}`,
        ];

        for (const r2Key of r2Keys) {
          const obj = await env.RELEASE_BUCKET.get(r2Key);
          if (obj) {
            trackDownload(app, version, filename);
            return serveR2Object(obj, filename, contentType, true);
          }
        }
      }

      // B. 桌面端或安卓端从 GitHub Release 对应 tag 回源
      const targetTag =
        device === "android"
          ? `android-v${version.replace(/^android-v/, "").replace(/^v/, "")}`
          : version.startsWith("v")
            ? version
            : `v${version}`;
      const sourceUrl = `https://github.com/${githubRepo}/releases/download/${targetTag}/${filename}`;
      const proxyRes = await proxyGitHubAsset(sourceUrl, request, filename);
      if (proxyRes.ok || proxyRes.status === 206) {
        trackDownload(app, version, filename);
      }
      return proxyRes;
    }
  }

  return new Response(
    JSON.stringify({
      error: "Route not found",
      requestedPath: path,
      hint: "Visit / for API and download route documentation",
    }),
    { status: 404, headers: { "Content-Type": "application/json" } },
  );
}
