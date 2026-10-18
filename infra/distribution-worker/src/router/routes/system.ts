/**
 * @file system.ts
 * @description 系统路由：缓存清理端点与首页（HTML 目录 / 网关描述）。
 *
 * 自 handleRequest 按路由族整体平移（行为不变）；返回 `undefined` 表示未命中，交由下一族处理。
 */

import type { RouterContext } from "../context.ts";
import { renderAppIndexHtml } from "../../portal.ts";
import { SUPPORTED_APPS } from "../config.ts";

export async function handleSystemRoutes(context: RouterContext): Promise<Response | undefined> {
  const { request, url, path, defaultApp, env, cache, respond, githubRepo } = context;

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
            iosLatest: "/:app/ios/latest",
            githubMirror: "/gh/:org/:repo/releases/download/:tag/:filename",
          },
          supportedPlatforms: [
            "macos",
            "macos-x64",
            "windows",
            "windows-arm64",
            "linux",
            "linux-arm64",
            "linux-deb",
            "linux-deb-arm64",
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

  return undefined;
}
