import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { proxyGitHubAsset, serveR2Object } from "../src/distribution/object-responses.ts";

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
