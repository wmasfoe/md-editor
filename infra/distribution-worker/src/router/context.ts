/**
 * @file context.ts
 * @description 请求上下文：URL/路径解析、应用与仓库默认值、边缘缓存读取、统一响应包装与下载统计闭包。
 *
 * 自 `handleRequest` 头部整体平移（行为不变）。各路由族只通过本上下文访问这些共享行为，
 * 避免各路由各自复制 CORS / Cache-Control / 统计逻辑而导致响应头与统计口径不一致。
 */

import { inferDownloadEvent, recordDownload } from "../analytics.ts";
import type { Env } from "../types.ts";
import { SUPPORTED_APPS } from "./config.ts";

export interface RouterContext {
  readonly request: Request;
  readonly env: Env;
  readonly ctx?: ExecutionContext;
  readonly url: URL;
  readonly path: string;
  readonly defaultApp: string;
  readonly githubRepo: string;
  /** 已解析的边缘缓存（运行环境无 `caches.default` 时为 `null`）。 */
  readonly cache: Cache | null;
  /** 本地开发宿主（localhost / 127.0.0.1）：跳过缓存并强制 no-store，便于热更调试。 */
  readonly isDevHost: boolean;
  /** 统一响应包装：补 CORS、按环境与静态性设置 Cache-Control，并写入边缘缓存。 */
  respond(response: Response, isStatic?: boolean): Response;
  /** 非阻塞记录下载统计（仅 GET、仅已知应用、跳过 .sig/.sha256/.json）。 */
  trackDownload(app: string, version: string, fileName: string): void;
}

/**
 * 建立请求上下文，并顺带完成一次边缘缓存命中检查。
 *
 * 缓存命中检查只对 GET/HEAD、非本地开发宿主、且客户端未带 no-cache 的请求生效
 * （大幅削减 Worker 计费与额度消耗）。
 */
export async function createRouterContext(
  request: Request,
  env: Env,
  ctx?: ExecutionContext,
): Promise<{ context: RouterContext; cachedResponse: Response | null }> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const defaultApp = env.DEFAULT_APP || "inkpoint";
  const githubRepo = env.GITHUB_REPO || "wmasfoe/md-editor";
  const analyticsApps = new Set(SUPPORTED_APPS.map(({ name }) => name.toLowerCase()));

  /** 非阻塞记录下载统计（通过 ctx.waitUntil 异步执行，不影响响应延迟） */
  function trackDownload(app: string, version: string, fileName: string): void {
    const canonicalApp = app.trim().toLowerCase();
    if (!ctx || request.method !== "GET" || !analyticsApps.has(canonicalApp)) return;
    const lower = fileName.toLowerCase();
    if (lower.endsWith(".sig") || lower.endsWith(".sha256") || lower.endsWith(".json")) {
      return;
    }
    const event = inferDownloadEvent(request, canonicalApp, version, fileName);
    ctx.waitUntil(recordDownload(ctx, env, request, event));
  }

  const isDevHost = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  const clientBypassCache =
    request.headers.get("Cache-Control")?.includes("no-cache") ||
    request.headers.get("Pragma")?.includes("no-cache");

  const cache =
    typeof caches !== "undefined" && "default" in caches
      ? (caches as unknown as { default: Cache }).default
      : null;

  let cachedResponse: Response | null = null;
  if (
    cache &&
    !isDevHost &&
    !clientBypassCache &&
    (request.method === "GET" || request.method === "HEAD")
  ) {
    cachedResponse = (await cache.match(request)) ?? null;
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

  return {
    context: {
      request,
      env,
      ctx,
      url,
      path,
      defaultApp,
      githubRepo,
      cache,
      isDevHost,
      respond,
      trackDownload,
    },
    cachedResponse,
  };
}
