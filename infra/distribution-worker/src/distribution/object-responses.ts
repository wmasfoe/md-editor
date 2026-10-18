/**
 * @file object-responses.ts
 * @description GitHub 资产流式代理与 R2 对象流式响应（自 router.ts 拆出，行为不变）。
 */

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
