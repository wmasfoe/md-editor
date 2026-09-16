import type { AppVersionManifest, Env } from "./types.ts";

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
): Promise<Response> {
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("Content-Type", contentType);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Cache-Control", "public, max-age=86400, s-maxage=604800");

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
export async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const defaultApp = env.DEFAULT_APP || "inkpoint";
  const githubRepo = env.GITHUB_REPO || "wmasfoe/md-editor";

  // 1. 首页信息
  if (path === "/") {
    return new Response(
      JSON.stringify(
        {
          name: "Inkpoint Global Distribution Gateway",
          description:
            "Cloudflare Worker & R2 Edge Distribution for Inkpoint and Multi-App Ecosystem",
          repo: githubRepo,
          routes: {
            versionManifest: "/api/:app/version.json",
            desktopUpdater: "/:app/desktop/updater.json",
            desktopLatest: "/:app/desktop/:platform/latest",
            androidLatest: "/:app/android/latest",
            versionedDownload: "/:app/:platform/:version/:filename",
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

  // 2. 版本清单 API: /api/:app/version.json 或 /api/version.json
  const apiMatch = path.match(/^\/api(?:\/([^/]+))?\/version(?:\.json)?$/);
  if (apiMatch) {
    const app = apiMatch[1] || defaultApp;

    // A. 尝试从 R2 存储桶读取已发布的 version.json
    if (env.RELEASE_BUCKET) {
      const r2Manifest = await env.RELEASE_BUCKET.get(`${app}/version.json`);
      if (r2Manifest) {
        return new Response(r2Manifest.body, {
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "public, max-age=300, s-maxage=300",
          },
        });
      }
    }

    // B. 回退方案：动态从 GitHub Releases 提取最新桌面版并结合已知移动版返回基础清单
    try {
      const ghRes = await fetch(`https://api.github.com/repos/${githubRepo}/releases/latest`, {
        headers: { "User-Agent": "Inkpoint-Distribution-Worker/1.0" },
      });

      if (ghRes.ok) {
        const release = (await ghRes.json()) as {
          tag_name: string;
          assets: Array<{ name: string; browser_download_url: string; size: number }>;
        };
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

        return new Response(JSON.stringify(dynamicManifest, null, 2), {
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "public, max-age=300, s-maxage=300",
          },
        });
      }
    } catch {
      // 忽略 GitHub API 临时失败
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

      return new Response(JSON.stringify(manifest, null, 2), {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "public, max-age=300, s-maxage=300",
        },
      });
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
    const platform = desktopMatch[2];

    try {
      const ghRes = await fetch(`https://api.github.com/repos/${githubRepo}/releases/latest`, {
        headers: { "User-Agent": "Inkpoint-Distribution-Worker/1.0" },
      });

      if (!ghRes.ok) {
        return new Response(
          JSON.stringify({ error: "Failed to query GitHub Releases API", status: ghRes.status }),
          { status: 502, headers: { "Content-Type": "application/json" } },
        );
      }

      const release = (await ghRes.json()) as {
        assets: Array<{ name: string; browser_download_url: string; size: number }>;
      };
      const matched = matchDesktopAsset(release.assets, platform);

      if (!matched) {
        return new Response(
          JSON.stringify({
            error: `No asset found matching platform '${platform}'`,
            availableAssets: release.assets.map((a) => a.name),
          }),
          { status: 404, headers: { "Content-Type": "application/json" } },
        );
      }

      return proxyGitHubAsset(matched.url, request, matched.name);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return new Response(JSON.stringify({ error: "Internal Gateway Error", details: message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  // 6. 指定版本精确下载: /:app/:platform/:version/:filename
  const versionedMatch = path.match(/^\/([^/]+)\/([^/]+)\/([^/]+)\/([^/]+)$/);
  if (versionedMatch) {
    const [, app, platform, version, filename] = versionedMatch;

    // A. 移动端直接从 R2 获取
    if (platform === "android" && env.RELEASE_BUCKET) {
      const r2Key = `${app}/android/${version}/${filename}`;
      const obj = await env.RELEASE_BUCKET.get(r2Key);
      if (obj) {
        return serveR2Object(obj, filename, "application/vnd.android.package-archive");
      }
    }

    // B. 桌面端从 GitHub Release 对应 tag 回源
    if (
      platform === "desktop" ||
      platform === "macos" ||
      platform === "windows" ||
      platform === "linux"
    ) {
      const targetTag = version.startsWith("v") ? version : `v${version}`;
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
