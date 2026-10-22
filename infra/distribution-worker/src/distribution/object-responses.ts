/**
 * @file object-responses.ts
 * @description GitHub 资产流式代理与 R2 对象流式响应（自 router.ts 拆出，行为不变）。
 *
 * R2 下载统一经由 `serveFirstR2BucketObject`：无 Range 时单次 `get()` 直出（行为与此前一致），
 * 携带单段 `Range` 时先 `head()` 取尺寸再 ranged `get()`，返回 206/416，支撑更新器断点续传。
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

/** R2 下载的展示选项（文件名、MIME、缓存策略）。 */
export interface R2DownloadOptions {
  readonly customFileName?: string;
  readonly contentType?: string;
  readonly isImmutable?: boolean;
}

/** 解析后的单段 Range 请求（均为闭区间字节偏移）。 */
interface ParsedRange {
  readonly offset: number;
  readonly length: number;
}

/**
 * 解析单段 `Range` 请求头。
 *
 * - 返回 `null`：无 Range / 非单段 Range（如多段、格式非法），调用方应回退 200 全量；
 * - 返回 `{ unsatisfiable: true }`：起点超出对象尺寸，应回 416；
 * - 否则返回钳制到对象尺寸内的 offset/length。
 */
function parseRangeHeader(
  range: string | null,
  size: number,
): ParsedRange | { unsatisfiable: true } | null {
  if (!range) {
    return null;
  }
  const match = range.match(/^bytes=(\d*)-(\d*)$/);
  if (!match) {
    return null;
  }
  const [, startText, endText] = match;
  if (!startText && !endText) {
    return null;
  }
  if (!startText) {
    // 后缀 Range：bytes=-N 表示最后 N 字节。
    const suffix = Number.parseInt(endText, 10);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) {
      return null;
    }
    if (size === 0) {
      return { unsatisfiable: true };
    }
    const length = Math.min(suffix, size);
    return { offset: size - length, length };
  }
  const start = Number.parseInt(startText, 10);
  if (!Number.isSafeInteger(start) || start < 0) {
    return null;
  }
  if (start >= size) {
    return { unsatisfiable: true };
  }
  if (!endText) {
    return { offset: start, length: size - start };
  }
  const end = Number.parseInt(endText, 10);
  if (!Number.isSafeInteger(end) || end < 0) {
    return null;
  }
  if (end < start) {
    return { unsatisfiable: true };
  }
  return { offset: start, length: Math.min(end, size - 1) - start + 1 };
}

/** 为 R2 流式响应写入统一展示头（ETag / CORS / 缓存 / 断点续传声明）。 */
function applyR2ResponseHeaders(
  headers: Headers,
  etag: string,
  contentType: string,
  isImmutable: boolean,
): void {
  headers.set("etag", etag);
  headers.set("Content-Type", contentType);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Accept-Ranges", "bytes");
  if (isImmutable) {
    headers.set("Cache-Control", "public, max-age=2592000, s-maxage=31536000, immutable");
  } else {
    headers.set(
      "Cache-Control",
      "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
    );
  }
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
  applyR2ResponseHeaders(headers, object.httpEtag, contentType, isImmutable);

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
 * 按 key 从 R2 取对象并返回流式下载响应（支持单段 Range 断点续传）。
 *
 * - 对象不存在返回 `null`，由调用方决定回退（GitHub 代理 / 404）；
 * - 无有效单段 Range 时行为与 `serveR2Object` 一致（单次 `get()` 200 直出）；
 * - `bytes=start-` / `bytes=start-end` / `bytes=-suffix` 返回 206，起点越界返回 416；
 * - HEAD 请求忽略 Range（保持既有行为，交由边缘层处理）。
 */
export async function serveR2BucketObject(
  bucket: R2Bucket | undefined | null,
  key: string,
  request: Request,
  options: R2DownloadOptions = {},
): Promise<Response | null> {
  if (!bucket) {
    return null;
  }
  const { customFileName, contentType = "application/octet-stream", isImmutable = true } = options;
  const rangeHeader = request.method === "GET" ? request.headers.get("Range") : null;
  if (!rangeHeader) {
    const object = await bucket.get(key);
    return object ? serveR2Object(object, customFileName, contentType, isImmutable) : null;
  }

  const head = await bucket.head(key);
  if (!head) {
    return null;
  }
  const parsed = parseRangeHeader(rangeHeader.trim(), head.size);
  if (!parsed) {
    const object = await bucket.get(key);
    return object ? serveR2Object(object, customFileName, contentType, isImmutable) : null;
  }
  if ("unsatisfiable" in parsed) {
    return new Response("Range Not Satisfiable", {
      status: 416,
      headers: {
        "Content-Range": `bytes */${head.size}`,
        "Accept-Ranges": "bytes",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  const ranged = await bucket.get(key, {
    range: { offset: parsed.offset, length: parsed.length },
  });
  if (!ranged) {
    return null;
  }
  const end = parsed.offset + parsed.length - 1;
  const headers = new Headers();
  ranged.writeHttpMetadata(headers);
  applyR2ResponseHeaders(headers, head.httpEtag, contentType, isImmutable);
  headers.set("Content-Range", `bytes ${parsed.offset}-${end}/${head.size}`);
  headers.set("Content-Length", String(parsed.length));
  if (customFileName) {
    headers.set(
      "Content-Disposition",
      `attachment; filename="${encodeURIComponent(customFileName)}"`,
    );
  }
  return new Response(ranged.body, { status: 206, headers });
}

/**
 * 按优先级依次尝试多个 R2 key，命中第一个即返回其下载响应。
 *
 * 调用方保留统计与回退逻辑：返回 `null` 表示全部缺失，调用方可继续走 GitHub 代理或 404。
 */
export async function serveFirstR2BucketObject(
  bucket: R2Bucket | undefined | null,
  keys: readonly string[],
  request: Request,
  options: R2DownloadOptions = {},
): Promise<{ key: string; response: Response } | null> {
  if (!bucket) {
    return null;
  }
  for (const key of keys) {
    const response = await serveR2BucketObject(bucket, key, request, options);
    if (response) {
      return { key, response };
    }
  }
  return null;
}
