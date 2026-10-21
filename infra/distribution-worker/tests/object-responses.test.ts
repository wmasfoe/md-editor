import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  proxyGitHubAsset,
  serveFirstR2BucketObject,
  serveR2BucketObject,
  serveR2Object,
} from "../src/distribution/object-responses.ts";

/**
 * 响应 helper 的独立单测。
 *
 * 这两个函数此前只有「经由路由间接覆盖」，缺少对 Range/206、缓存头、ETag 与
 * Content-Disposition 的直接断言 —— 而它们正是安装包分发链路上最容易回归的部分。
 */

describe("proxyGitHubAsset", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("转发 Range 请求头并保留 206 与上游响应头，附加 CORS 与边缘缓存策略", async () => {
    const seen: { url: string; range: string | null; redirect?: RequestRedirect } = {
      url: "",
      range: null,
    };
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof Request ? input.url : "";
      const headers = new Headers(init?.headers);
      seen.url = url;
      seen.range = headers.get("Range");
      seen.redirect = init?.redirect;
      return new Response("partial-bytes", {
        status: 206,
        headers: { "Content-Range": "bytes 0-12/100", ETag: '"upstream-etag"' },
      });
    });

    const request = new Request("https://download.jiaqi.im/gh/a/b/releases/download/v1/x.dmg", {
      headers: { Range: "bytes=0-12" },
    });
    const response = await proxyGitHubAsset(
      "https://github.com/a/b/releases/download/v1/x.dmg",
      request,
    );

    expect(seen.url).toBe("https://github.com/a/b/releases/download/v1/x.dmg");
    expect(seen.range).toBe("bytes=0-12");
    expect(seen.redirect).toBe("follow");
    expect(response.status).toBe(206);
    expect(response.headers.get("Content-Range")).toBe("bytes 0-12/100");
    expect(response.headers.get("ETag")).toBe('"upstream-etag"');
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=86400, s-maxage=2592000");
  });

  it("指定文件名时写入编码后的 Content-Disposition", async () => {
    vi.stubGlobal("fetch", async () => new Response("ok", { status: 200 }));
    const response = await proxyGitHubAsset(
      "https://github.com/a/b/releases/download/v1/x.dmg",
      new Request("https://download.jiaqi.im/x"),
      "Inkpoint 0.10.2 aarch64.dmg",
    );
    expect(response.headers.get("Content-Disposition")).toBe(
      `attachment; filename="${encodeURIComponent("Inkpoint 0.10.2 aarch64.dmg")}"`,
    );
  });

  it("上游失败时返回 JSON 错误并透传状态码，不抛出", async () => {
    vi.stubGlobal(
      "fetch",
      async () => new Response("nope", { status: 404, statusText: "Not Found" }),
    );
    const response = await proxyGitHubAsset(
      "https://github.com/a/b/releases/download/v1/missing.dmg",
      new Request("https://download.jiaqi.im/x"),
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("Content-Type")).toBe("application/json");
    const body = (await response.json()) as { error: string; status: number; source: string };
    expect(body.error).toBe("Failed to fetch upstream asset from GitHub");
    expect(body.status).toBe(404);
    expect(body.source).toContain("missing.dmg");
  });
});

const makeObject = (): R2ObjectBody =>
  ({
    body: "r2-bytes",
    size: 9,
    httpEtag: '"r2-etag"',
    writeHttpMetadata: (headers: Headers) => {
      headers.set("Content-Type", "application/octet-stream");
    },
  }) as unknown as R2ObjectBody;

const rangePayload = "0123456789";

const makeRangeBucket = (files: Record<string, string> = { "k/bin": rangePayload }) =>
  ({
    head: async (key: string) =>
      key in files
        ? ({ size: files[key].length, httpEtag: `"etag-${key}"` } as unknown as R2Object)
        : null,
    get: async (
      key: string,
      options?: { range?: { offset?: number; length?: number; suffix?: number } },
    ) => {
      if (!(key in files)) {
        return null;
      }
      const full = files[key];
      let body = full;
      const range = options?.range;
      if (range) {
        if (typeof range.suffix === "number") {
          body = full.slice(Math.max(0, full.length - range.suffix));
        } else if (typeof range.offset === "number") {
          body = full.slice(range.offset, range.offset + (range.length ?? full.length));
        }
      }
      return {
        body,
        size: body.length,
        httpEtag: `"etag-${key}"`,
        writeHttpMetadata: (_headers: Headers) => {},
      } as unknown as R2ObjectBody;
    },
  }) as unknown as R2Bucket;

const makeRangeRequest = (range?: string) =>
  new Request("https://download.jiaqi.im/k/bin", range ? { headers: { Range: range } } : {});

describe("serveR2BucketObject", () => {
  const payload = rangePayload;

  it("缺 bucket 时返回 null，调用方可继续回退", async () => {
    expect(await serveR2BucketObject(undefined, "k/bin", makeRangeRequest())).toBeNull();
    expect(await serveFirstR2BucketObject(undefined, ["k/bin"], makeRangeRequest())).toBeNull();
  });

  it("无 Range 时 200 全量并声明 Accept-Ranges", async () => {
    const response = await serveR2BucketObject(makeRangeBucket(), "k/bin", makeRangeRequest(), {
      customFileName: "bin",
    });
    expect(response?.status).toBe(200);
    expect(response?.headers.get("Accept-Ranges")).toBe("bytes");
    expect(response?.headers.get("Content-Disposition")).toContain("bin");
    expect(await response?.text()).toBe(payload);
  });

  it("bytes=2-5 返回 206 与 Content-Range", async () => {
    const response = await serveR2BucketObject(
      makeRangeBucket(),
      "k/bin",
      makeRangeRequest("bytes=2-5"),
    );
    expect(response?.status).toBe(206);
    expect(response?.headers.get("Content-Range")).toBe("bytes 2-5/10");
    expect(response?.headers.get("Content-Length")).toBe("4");
    expect(response?.headers.get("Accept-Ranges")).toBe("bytes");
    expect(await response?.text()).toBe("2345");
  });

  it("开放区间与后缀区间正确钳制", async () => {
    const open = await serveR2BucketObject(
      makeRangeBucket(),
      "k/bin",
      makeRangeRequest("bytes=7-"),
    );
    expect(open?.status).toBe(206);
    expect(open?.headers.get("Content-Range")).toBe("bytes 7-9/10");
    expect(await open?.text()).toBe("789");

    const suffix = await serveR2BucketObject(
      makeRangeBucket(),
      "k/bin",
      makeRangeRequest("bytes=-3"),
    );
    expect(suffix?.status).toBe(206);
    expect(suffix?.headers.get("Content-Range")).toBe("bytes 7-9/10");

    const clamped = await serveR2BucketObject(
      makeRangeBucket(),
      "k/bin",
      makeRangeRequest("bytes=5-100"),
    );
    expect(clamped?.status).toBe(206);
    expect(clamped?.headers.get("Content-Range")).toBe("bytes 5-9/10");
    expect(await clamped?.text()).toBe("56789");
  });

  it("起点越界/倒置区间返回 416", async () => {
    for (const range of ["bytes=10-", "bytes=99-100", "bytes=8-3"]) {
      const response = await serveR2BucketObject(
        makeRangeBucket(),
        "k/bin",
        makeRangeRequest(range),
      );
      expect(response?.status).toBe(416);
      expect(response?.headers.get("Content-Range")).toBe("bytes */10");
    }
  });

  it("非法 Range 回退 200 全量而非报错", async () => {
    for (const range of ["bytes=0-1,3-4", "items=0-1", "bytes=-", "bytes=abc-def"]) {
      const response = await serveR2BucketObject(
        makeRangeBucket(),
        "k/bin",
        makeRangeRequest(range),
      );
      expect(response?.status).toBe(200);
      expect(await response?.text()).toBe(payload);
    }
  });

  it("key 不存在返回 null；HEAD 请求忽略 Range", async () => {
    const bucket = makeRangeBucket();
    expect(await serveR2BucketObject(bucket, "missing", makeRangeRequest("bytes=0-1"))).toBeNull();
    const headRes = await serveR2BucketObject(
      bucket,
      "k/bin",
      new Request("https://download.jiaqi.im/k/bin", {
        method: "HEAD",
        headers: { Range: "bytes=0-1" },
      }),
    );
    expect(headRes?.status).toBe(200);
  });

  it("serveFirst 按优先级命中并返回 key", async () => {
    const bucket = makeRangeBucket({ b: "B", a: "A" });
    const hit = await serveFirstR2BucketObject(bucket, ["missing", "a", "b"], makeRangeRequest());
    expect(hit?.key).toBe("a");
    expect(await hit?.response.text()).toBe("A");
    expect(await serveFirstR2BucketObject(bucket, ["x", "y"], makeRangeRequest())).toBeNull();
  });
});

describe("serveR2Object", () => {
  it("不可变对象使用 immutable 长缓存并写入 ETag 与 CORS", async () => {
    const response = await serveR2Object(
      makeObject(),
      undefined,
      "application/x-apple-diskimage",
      true,
    );
    expect(response.headers.get("etag")).toBe('"r2-etag"');
    expect(response.headers.get("Content-Type")).toBe("application/x-apple-diskimage");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("Cache-Control")).toBe(
      "public, max-age=2592000, s-maxage=31536000, immutable",
    );
    expect(response.headers.get("Content-Disposition")).toBeNull();
  });

  it("可变对象使用短缓存 + stale-while-revalidate", async () => {
    const response = await serveR2Object(
      makeObject(),
      "latest.apk",
      "application/vnd.android.package-archive",
      false,
    );
    expect(response.headers.get("Cache-Control")).toBe(
      "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
    );
    expect(response.headers.get("Content-Disposition")).toBe('attachment; filename="latest.apk"');
  });
});
