/**
 * @file manifest-api.ts
 * @description 版本清单 API 体系（含快捷别名 302）、GitHub Release 镜像与桌面端 updater 清单加速。
 *
 * 自 handleRequest 按路由族整体平移（行为不变）；返回 `undefined` 表示未命中，交由下一族处理。
 */

import type { RouterContext } from "../context.ts";
import type { AppVersionManifest, ReleasesManifest } from "../../types.ts";
import { fetchLatestRelease } from "../../distribution/github-releases.ts";
import { matchDesktopAsset } from "../../distribution/platform-assets.ts";
import { proxyGitHubAsset } from "../../distribution/object-responses.ts";
import { buildReleasesManifest } from "../../releases/manifest.ts";
import { KNOWN_PLATFORM_CATEGORIES } from "../config.ts";

export async function handleManifestApiRoutes(
  context: RouterContext,
): Promise<Response | undefined> {
  const { url, path, defaultApp, env, githubRepo, respond, request } = context;

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
    path.match(/^\/api\/([^/]+)\/(android|desktop|mobile|ios)\/(?:releases|latest)(?:\.json)?$/) ||
    path.match(/^\/api\/([^/]+)\/releases\/(android|desktop|mobile|ios)(?:\.json)?$/);

  if (appDeviceReleasesMatch) {
    const rawApp = appDeviceReleasesMatch[1];
    const cat = appDeviceReleasesMatch[2];
    const category = cat === "mobile" ? "android" : (cat as "android" | "desktop" | "ios");
    const app = rawApp && !KNOWN_PLATFORM_CATEGORIES.has(rawApp) ? rawApp : defaultApp;

    const manifest = await buildReleasesManifest(app, githubRepo, env, url.origin);
    let releases = manifest.releases.filter(
      (r) =>
        r.category === category ||
        (category === "android" && r.assets.some((a) => a.platform === "android")) ||
        (category === "ios" && r.assets.some((a) => a.platform === "ios")) ||
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
        // iOS 未签名 IPA 通道：R2 清单缺失时不做任何虚假承诺（历史上的 TestFlight 占位已移除）
        ios: undefined,
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
        return respond(await serveUpdaterManifest(r2Updater, url.origin));
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

  return undefined;
}

/**
 * 输出 R2 中的 updater.json，并在重写二进制 URL 后返回。
 *
 * R2 里存的清单可能是构建期按默认分发域名生成的（历史上曾指向另一个域名），
 * 若原样透传，Tauri 更新器会跨域去另一个域名下载大二进制——在代理分流
 *（如 `.cn → DIRECT`）下极易命中慢路径。统一改写为本次请求的 origin 后，
 * 清单与二进制永远同域，下载走哪条路完全可预测。
 */
async function serveUpdaterManifest(r2Updater: R2ObjectBody, origin: string): Promise<Response> {
  const raw = await r2Updater.text();
  try {
    const manifest = JSON.parse(raw) as {
      platforms?: Record<string, { signature?: string; url?: unknown }>;
    };
    if (manifest && typeof manifest === "object" && manifest.platforms) {
      for (const item of Object.values(manifest.platforms)) {
        if (item && typeof item.url === "string") {
          try {
            const parsed = new URL(item.url);
            if (parsed.protocol === "http:" || parsed.protocol === "https:") {
              item.url = `${origin}${parsed.pathname}${parsed.search}${parsed.hash}`;
            }
          } catch {
            // 非绝对 URL（如已是相对路径）：保持原样。
          }
        }
      }
    }
    return new Response(JSON.stringify(manifest, null, 2), {
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    // 非 JSON 存量：原样透传，不中断更新。
    return new Response(raw, {
      headers: { "Content-Type": "application/json" },
    });
  }
}
