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

let cachedReleasePayload: GitHubReleasePayload | null = null;

/**
 * 获取 GitHub 最新 Release，并通过 Cloudflare 边缘强缓存与内存容灾避免 API 频控 (403 Rate Limit)
 */
export async function fetchLatestRelease(
  githubRepo: string,
  env: Env,
): Promise<GitHubReleasePayload | null> {
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
      cachedReleasePayload = data;
      return data;
    }
  } catch {
    // 捕获网络异常
  }

  // 触发频控 (403) 或网络故障时，优先回退到内存缓存的最新发布
  if (cachedReleasePayload) {
    return cachedReleasePayload;
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

let cachedReleasesList: RawGitHubRelease[] | null = null;

/**
 * 获取 GitHub 所有 Release 列表，带 Cloudflare 边缘缓存与内存容灾
 */
export async function fetchAllGitHubReleases(
  githubRepo: string,
  env: Env,
): Promise<RawGitHubRelease[]> {
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
        cachedReleasesList = data;
        return data;
      }
    }
  } catch {
    // 网络异常
  }

  if (cachedReleasesList) {
    return cachedReleasesList;
  }

  return [];
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
      const version = raw.tag_name.replace(/^v/, "").replace(/^desktop-v/, "");
      const isLatest = releases.length === 0;
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

        const downloadUrl = `${baseUrl}/${app}/${version}/${encodeURIComponent(name)}`;

        assets.push({
          platform,
          platformLabel,
          fileName: name,
          downloadUrl,
          sizeBytes: asset.size,
          formattedSize: formatBytes(asset.size),
          isR2Cached: version === "0.10.2",
        });
      }

      const hasAndroid = assets.some((a) => a.platform === "android");
      const hasDesktop = assets.some(
        (a) =>
          a.platform.includes("macos") ||
          a.platform.includes("windows") ||
          a.platform.includes("linux"),
      );
      const category: ReleaseInfo["category"] = hasAndroid && !hasDesktop ? "android" : "desktop";

      releases.push({
        version,
        tagName: raw.tag_name,
        publishedAt: raw.published_at || new Date().toISOString(),
        isLatest,
        isPrerelease: Boolean(raw.prerelease),
        category,
        releaseNotesUrl:
          raw.html_url || `https://github.com/${githubRepo}/releases/tag/${raw.tag_name}`,
        assets,
      });
    }
  }

  // 3. 如果 GitHub API 失败或被限流，使用内置全量历史版本清单作为底座
  if (releases.length === 0) {
    const fallback = fallbackManifest as unknown as ReleasesManifest;
    if (fallback && Array.isArray(fallback.releases) && fallback.releases.length > 0) {
      releases = [...fallback.releases];
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

  // 4. 确保清单中包含专属 Android Release
  const existingAndroid = releases.find(
    (r) =>
      r.category === "android" ||
      (r.version === androidVersion && r.assets.some((a) => a.platform === "android")),
  );

  if (!existingAndroid) {
    releases.push({
      version: androidVersion,
      tagName: `android-v${androidVersion}`,
      publishedAt: androidPublishedAt,
      isLatest: true,
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

  // 4. 计算各端最新版本与直达摘要
  const desktopRelease = releases.find((r) => r.category === "desktop");
  const androidRelease = releases.find(
    (r) => r.category === "android" || r.assets.some((a) => a.platform === "android"),
  );

  const latestDesktopVersion = desktopRelease?.version || releases[0]?.version || "0.10.2";
  const latestAndroidVersion = androidRelease?.version || androidVersion;

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
        fileName: androidFileName,
        formattedSize: formatBytes(androidSizeBytes),
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

  // 1. 边缘静态缓存命中检查（只缓存 GET / HEAD 请求，大幅削减 Worker 计费与额度消耗）
  const cache =
    typeof caches !== "undefined" && "default" in caches
      ? (caches as unknown as { default: Cache }).default
      : null;
  if (cache && (request.method === "GET" || request.method === "HEAD")) {
    const cachedResponse = await cache.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }
  }

  function respond(response: Response, isStatic = false): Response {
    if (!response.headers.has("Access-Control-Allow-Origin")) {
      response.headers.set("Access-Control-Allow-Origin", "*");
    }
    if (!response.headers.has("Cache-Control")) {
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
    if (cache && ctx && response.ok && (request.method === "GET" || request.method === "HEAD")) {
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

  // 2. 全量历史版本清单 API: /api/:app/releases(.json)? 或 /api/releases(.json)? 或 /api/:app/history
  const releasesApiMatch = path.match(/^\/api(?:\/([^/]+))?\/(?:releases|history)(?:\.json)?$/);
  if (releasesApiMatch) {
    const app = releasesApiMatch[1] || defaultApp;
    const manifest = await buildReleasesManifest(app, githubRepo, env, url.origin);
    return respond(
      new Response(JSON.stringify(manifest, null, 2), {
        headers: {
          "Content-Type": "application/json",
        },
      }),
    );
  }

  // 2. 版本清单 API: /api/:app/version.json 或 /api/version.json
  const apiMatch = path.match(/^\/api(?:\/([^/]+))?\/version(?:\.json)?$/);
  if (apiMatch) {
    const app = apiMatch[1] || defaultApp;

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
      const version = release.tag_name.replace(/^v/, "");
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
      return proxyGitHubAsset(fallbackUrl, request, fallbackFileName);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return new Response(JSON.stringify({ error: "Internal Gateway Error", details: message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  // 8. 兼容别名路径: /releases, /portal 或 /:app/releases, /:app/portal (支持 /releases/android, /releases/desktop)
  const portalMatch = path.match(
    /^(?:\/([^/]+))?\/(?:releases|portal)(?:\/(android|desktop|mobile))?(?:\.html)?$/,
  );
  if (portalMatch) {
    const app = portalMatch[1] || defaultApp;
    const catParam =
      portalMatch[2] === "mobile"
        ? "android"
        : (portalMatch[2] as "android" | "desktop" | undefined);
    const manifest = await buildReleasesManifest(app, githubRepo, env, url.origin);
    const html = catParam
      ? renderDeviceVersionsHtml(app, catParam, manifest, url.origin)
      : renderAppDevicesHtml(app, manifest, url.origin);
    return respond(
      new Response(html, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
        },
      }),
    );
  }

  // 9. 层级目录与安装包下载路由
  const segments = path.replace(/^\//, "").split("/").filter(Boolean);

  // 9.1 单段路径：应用设备目录 Index of /:app/ (如 /inkpoint)
  if (segments.length === 1) {
    const app = segments[0];
    if (!["api", "gh", "favicon.ico", "releases"].includes(app)) {
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
              return serveR2Object(obj, filename, contentType, true);
            }
          }
        }

        // B. 回退 GitHub Releases
        const targetTag = version.startsWith("v") ? version : `v${version}`;
        const sourceUrl = `https://github.com/${githubRepo}/releases/download/${targetTag}/${filename}`;
        return proxyGitHubAsset(sourceUrl, request, filename);
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
      return proxyGitHubAsset(sourceUrl, request, filename);
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
