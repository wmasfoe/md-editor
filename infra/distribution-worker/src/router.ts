/**
 * @file router.ts
 * @description 分发 Worker 的请求入口：建立上下文 → 边缘缓存命中 → 按既有顺序分发路由族 → 404。
 *
 * 路由族按职责拆在 `router/routes/` 与 `distribution/`、`releases/` 下（见各自文件头）。
 * **顺序本身有行为语义**：purge/首页 → 版本 API/镜像/updater → 各端 latest/安装脚本 →
 * 跳转/目录/下载，因此这里保持显式顺序调用，不做注册表式重排。
 */

import type { Env } from "./types.ts";
import { createRouterContext } from "./router/context.ts";
import { handleCatalogRoutes } from "./router/routes/catalog.ts";
import { handleLatestArtifactsRoutes } from "./router/routes/latest-artifacts.ts";
import { handleManifestApiRoutes } from "./router/routes/manifest-api.ts";
import { handleSystemRoutes } from "./router/routes/system.ts";

/**
 * 核心请求处理器
 */
export async function handleRequest(
  request: Request,
  env: Env,
  ctx?: ExecutionContext,
): Promise<Response> {
  const { context, cachedResponse } = await createRouterContext(request, env, ctx);
  if (cachedResponse) {
    return cachedResponse;
  }

  const systemResponse = await handleSystemRoutes(context);
  if (systemResponse) {
    return systemResponse;
  }

  const manifestApiResponse = await handleManifestApiRoutes(context);
  if (manifestApiResponse) {
    return manifestApiResponse;
  }

  const latestArtifactResponse = await handleLatestArtifactsRoutes(context);
  if (latestArtifactResponse) {
    return latestArtifactResponse;
  }

  const catalogResponse = await handleCatalogRoutes(context);
  if (catalogResponse) {
    return catalogResponse;
  }

  return new Response(
    JSON.stringify({
      error: "Route not found",
      requestedPath: context.path,
      hint: "Visit / for API and download route documentation",
    }),
    { status: 404, headers: { "Content-Type": "application/json" } },
  );
}
