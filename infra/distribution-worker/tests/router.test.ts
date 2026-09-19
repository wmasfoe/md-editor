import { describe, expect, it } from "vitest";
import { buildReleasesManifest, handleRequest, matchDesktopAsset } from "../src/router.ts";
import type { Env } from "../src/types.ts";

describe("Distribution Worker Router & Matcher", () => {
  const sampleAssets = [
    {
      name: "Inkpoint_0.10.2_aarch64.dmg",
      browser_download_url:
        "https://github.com/wmasfoe/md-editor/releases/download/v0.10.2/Inkpoint_0.10.2_aarch64.dmg",
      size: 85000000,
    },
    {
      name: "Inkpoint_0.10.2_x64.dmg",
      browser_download_url:
        "https://github.com/wmasfoe/md-editor/releases/download/v0.10.2/Inkpoint_0.10.2_x64.dmg",
      size: 90000000,
    },
    {
      name: "Inkpoint_0.10.2_x64-setup.exe",
      browser_download_url:
        "https://github.com/wmasfoe/md-editor/releases/download/v0.10.2/Inkpoint_0.10.2_x64-setup.exe",
      size: 75000000,
    },
    {
      name: "Inkpoint_0.10.2_arm64-setup.exe",
      browser_download_url:
        "https://github.com/wmasfoe/md-editor/releases/download/v0.10.2/Inkpoint_0.10.2_arm64-setup.exe",
      size: 78000000,
    },
    {
      name: "Inkpoint_0.10.2_amd64.AppImage",
      browser_download_url:
        "https://github.com/wmasfoe/md-editor/releases/download/v0.10.2/Inkpoint_0.10.2_amd64.AppImage",
      size: 95000000,
    },
  ];

  it("should match macOS ARM64 DMG correctly", () => {
    const matched = matchDesktopAsset(sampleAssets, "macos");
    expect(matched).not.toBeNull();
    expect(matched?.name).toBe("Inkpoint_0.10.2_aarch64.dmg");

    const matchedAlias = matchDesktopAsset(sampleAssets, "mac-arm64");
    expect(matchedAlias?.name).toBe("Inkpoint_0.10.2_aarch64.dmg");
  });

  it("should match macOS Intel DMG correctly", () => {
    const matched = matchDesktopAsset(sampleAssets, "macos-x64");
    expect(matched).not.toBeNull();
    expect(matched?.name).toBe("Inkpoint_0.10.2_x64.dmg");
  });

  it("should match Windows x64 and ARM64 setup executables", () => {
    const winX64 = matchDesktopAsset(sampleAssets, "windows");
    expect(winX64?.name).toBe("Inkpoint_0.10.2_x64-setup.exe");

    const winArm = matchDesktopAsset(sampleAssets, "windows-arm64");
    expect(winArm?.name).toBe("Inkpoint_0.10.2_arm64-setup.exe");
  });

  it("should match Linux AppImage", () => {
    const linux = matchDesktopAsset(sampleAssets, "linux");
    expect(linux?.name).toBe("Inkpoint_0.10.2_amd64.AppImage");
  });

  it("should return gateway info JSON on root path /", async () => {
    const req = new Request("https://download.justdev.cn/");
    const env: Env = {
      DEFAULT_APP: "inkpoint",
      GITHUB_REPO: "wmasfoe/md-editor",
    };

    const res = await handleRequest(req, env);
    expect(res.status).toBe(200);

    const body = (await res.json()) as { name: string; routes: Record<string, string> };
    expect(body.name).toContain("Inkpoint Global Distribution Gateway");
    expect(body.routes.versionManifest).toBe("/api/:app/version.json");
    expect(body.routes.desktopLatest).toBe("/:app/desktop/:platform/latest");
    expect(body.routes.androidLatest).toBe("/:app/android/latest");
  });

  it("should read version.json from R2 bucket when available", async () => {
    const mockManifest = {
      app: "inkpoint",
      updatedAt: "2026-09-16T12:00:00Z",
      android: {
        version: "0.1.0",
        apk: {
          version: "0.1.0",
          fileName: "Inkpoint_0.1.0.apk",
          downloadUrl: "https://download.justdev.cn/inkpoint/android/latest",
        },
      },
    };

    const mockBucket = {
      get: async (key: string) => {
        if (key === "inkpoint/version.json") {
          return {
            body: new ReadableStream({
              start(controller) {
                controller.enqueue(new TextEncoder().encode(JSON.stringify(mockManifest)));
                controller.close();
              },
            }),
          };
        }
        return null;
      },
    };

    const req = new Request("https://download.justdev.cn/api/inkpoint/version.json");
    const env: Env = {
      DEFAULT_APP: "inkpoint",
      RELEASE_BUCKET: mockBucket as unknown as R2Bucket,
    };

    const res = await handleRequest(req, env);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual(mockManifest);
  });

  it("should return 404 with helpful error when Android APK is not in R2", async () => {
    const req = new Request("https://download.justdev.cn/inkpoint/android/latest");
    const env: Env = {
      DEFAULT_APP: "inkpoint",
      RELEASE_BUCKET: {
        get: async () => null,
      } as unknown as R2Bucket,
    };

    const res = await handleRequest(req, env);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string; app: string };
    expect(body.error).toContain("Android release artifact not found in R2 bucket");
    expect(body.app).toBe("inkpoint");
  });

  it("should proxy and rewrite updater manifest URLs to edge proxy", async () => {
    const mockUpstreamManifest = {
      version: "v0.10.2",
      notes: "Inkpoint v0.10.2 release notes",
      platforms: {
        "darwin-aarch64": {
          signature: "sig-arm64",
          url: "https://github.com/wmasfoe/md-editor/releases/download/v0.10.2/Inkpoint_aarch64.app.tar.gz",
        },
        "windows-x86_64": {
          signature: "sig-win",
          url: "https://github.com/wmasfoe/md-editor/releases/download/v0.10.2/Inkpoint_x64-setup.nsis.zip",
        },
      },
    };

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input: RequestInfo | URL) => {
      const urlStr =
        typeof input === "string" ? input : input instanceof Request ? input.url : input.toString();
      if (urlStr.includes("md-editor-latest.json")) {
        return new Response(JSON.stringify(mockUpstreamManifest), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return originalFetch(input);
    };

    try {
      const req = new Request("https://download.justdev.cn/inkpoint/desktop/updater.json");
      const env: Env = {
        DEFAULT_APP: "inkpoint",
        GITHUB_REPO: "wmasfoe/md-editor",
      };

      const res = await handleRequest(req, env);
      expect(res.status).toBe(200);

      const data = (await res.json()) as typeof mockUpstreamManifest;
      expect(data.version).toBe("v0.10.2");
      expect(data.platforms["darwin-aarch64"].url).toBe(
        "https://download.justdev.cn/gh/wmasfoe/md-editor/releases/download/v0.10.2/Inkpoint_aarch64.app.tar.gz",
      );
      expect(data.platforms["windows-x86_64"].url).toBe(
        "https://download.justdev.cn/gh/wmasfoe/md-editor/releases/download/v0.10.2/Inkpoint_x64-setup.nsis.zip",
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("should read desktop updater.json directly from R2 bucket when available", async () => {
    const mockR2Updater = {
      version: "0.10.2",
      notes: "Inkpoint 0.10.2",
      platforms: {
        "darwin-aarch64": {
          signature: "r2-sig-mac",
          url: "https://download.justdev.cn/inkpoint/desktop/0.10.2/Inkpoint.app.tar.gz",
        },
      },
    };

    const mockBucket = {
      get: async (key: string) => {
        if (key === "inkpoint/desktop/updater.json") {
          return {
            body: JSON.stringify(mockR2Updater),
          } as unknown as R2ObjectBody;
        }
        return null;
      },
    };

    const req = new Request("https://download.justdev.cn/inkpoint/desktop/updater.json");
    const env: Env = {
      DEFAULT_APP: "inkpoint",
      RELEASE_BUCKET: mockBucket as unknown as R2Bucket,
    };

    const res = await handleRequest(req, env);
    expect(res.status).toBe(200);
    const data = (await res.json()) as typeof mockR2Updater;
    expect(data.version).toBe("0.10.2");
    expect(data.platforms["darwin-aarch64"].url).toBe(
      "https://download.justdev.cn/inkpoint/desktop/0.10.2/Inkpoint.app.tar.gz",
    );
  });

  it("should serve desktop latest artifact directly from R2 when available", async () => {
    const mockBucket = {
      get: async (key: string) => {
        if (key === "inkpoint/desktop/macos/latest.dmg") {
          return {
            body: new ReadableStream(),
            httpEtag: "etag-dmg",
            writeHttpMetadata: (_headers: Headers) => {},
          } as unknown as R2ObjectBody;
        }
        return null;
      },
    };

    const req = new Request("https://download.justdev.cn/inkpoint/desktop/macos/latest");
    const env: Env = {
      DEFAULT_APP: "inkpoint",
      RELEASE_BUCKET: mockBucket as unknown as R2Bucket,
    };

    const res = await handleRequest(req, env);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/x-apple-diskimage");
  });

  it("should serve desktop versioned artifact directly from R2 when available", async () => {
    const mockBucket = {
      get: async (key: string) => {
        if (key === "inkpoint/desktop/0.10.2/Inkpoint_0.10.2_aarch64.dmg") {
          return {
            body: new ReadableStream(),
            httpEtag: "etag-versioned-dmg",
            writeHttpMetadata: (_headers: Headers) => {},
          } as unknown as R2ObjectBody;
        }
        return null;
      },
    };

    const req = new Request(
      "https://download.justdev.cn/inkpoint/desktop/0.10.2/Inkpoint_0.10.2_aarch64.dmg",
    );
    const env: Env = {
      DEFAULT_APP: "inkpoint",
      RELEASE_BUCKET: mockBucket as unknown as R2Bucket,
    };

    const res = await handleRequest(req, env);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/x-apple-diskimage");
    expect(res.headers.get("Content-Disposition")).toContain("Inkpoint_0.10.2_aarch64.dmg");
  });

  it("should return releases manifest JSON on /api/inkpoint/releases", async () => {
    const req = new Request("https://download.justdev.cn/api/inkpoint/releases");
    const env: Env = {
      DEFAULT_APP: "inkpoint",
      GITHUB_REPO: "wmasfoe/md-editor",
    };

    const res = await handleRequest(req, env);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/json");

    const manifest = (await res.json()) as { app: string; releases: Array<{ version: string }> };
    expect(manifest.app).toBe("inkpoint");
    expect(manifest.releases.length).toBeGreaterThan(0);
    expect(manifest.releases[0].version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("should return android releases on canonical /api/inkpoint/android/releases", async () => {
    const req = new Request("https://download.justdev.cn/api/inkpoint/android/releases");
    const env: Env = {
      DEFAULT_APP: "inkpoint",
      GITHUB_REPO: "wmasfoe/md-editor",
    };

    const res = await handleRequest(req, env);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/json");

    const manifest = (await res.json()) as {
      app: string;
      releases: Array<{ version: string; category: string; isLatest: boolean }>;
    };
    expect(manifest.app).toBe("inkpoint");
    expect(manifest.releases.length).toBeGreaterThanOrEqual(2);
    expect(manifest.releases.every((r) => r.category === "android")).toBe(true);
    expect(manifest.releases[0].version).toBe("0.1.1");
    expect(manifest.releases[0].isLatest).toBe(true);
    expect(manifest.releases[1].version).toBe("0.1.0");
    expect(manifest.releases[1].isLatest).toBe(false);
  });

  it("should return android releases on RESTful /api/inkpoint/releases/android", async () => {
    const req = new Request("https://download.justdev.cn/api/inkpoint/releases/android");
    const env: Env = {
      DEFAULT_APP: "inkpoint",
      GITHUB_REPO: "wmasfoe/md-editor",
    };

    const res = await handleRequest(req, env);
    expect(res.status).toBe(200);
    const manifest = (await res.json()) as {
      releases: Array<{ version: string; category: string }>;
    };
    expect(manifest.releases.length).toBeGreaterThanOrEqual(2);
    expect(manifest.releases[0].version).toBe("0.1.1");
  });

  it("should 302 redirect non-app release APIs /api/android/releases and /api/releases/android to canonical path", async () => {
    const env: Env = {
      DEFAULT_APP: "inkpoint",
      GITHUB_REPO: "wmasfoe/md-editor",
    };

    const res1 = await handleRequest(
      new Request("https://download.justdev.cn/api/android/releases"),
      env,
    );
    expect(res1.status).toBe(302);
    expect(res1.headers.get("Location")).toBe(
      "https://download.justdev.cn/api/inkpoint/android/releases",
    );

    const res2 = await handleRequest(
      new Request("https://download.justdev.cn/api/releases/android"),
      env,
    );
    expect(res2.status).toBe(302);
    expect(res2.headers.get("Location")).toBe(
      "https://download.justdev.cn/api/inkpoint/android/releases",
    );

    const res3 = await handleRequest(new Request("https://download.justdev.cn/api/releases"), env);
    expect(res3.status).toBe(302);
    expect(res3.headers.get("Location")).toBe("https://download.justdev.cn/api/inkpoint/releases");
  });

  it("should handle /api/android/version.json by mapping to default app", async () => {
    const mockBucket = {
      get: async (key: string) => {
        if (key === "inkpoint/version.json") {
          return {
            body: JSON.stringify({
              app: "inkpoint",
              desktop: { version: "0.10.2" },
              android: { version: "0.1.1" },
            }),
          };
        }
        return null;
      },
    };
    const req = new Request("https://download.justdev.cn/api/android/version.json");
    const env: Env = {
      DEFAULT_APP: "inkpoint",
      GITHUB_REPO: "wmasfoe/md-editor",
      RELEASE_BUCKET: mockBucket as unknown as R2Bucket,
    };

    const res = await handleRequest(req, env);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { app: string };
    expect(data.app).toBe("inkpoint");
  });

  it("should render app index HTML on / when Accept header is text/html", async () => {
    const req = new Request("https://download.justdev.cn/", {
      headers: { Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" },
    });
    const env: Env = {
      DEFAULT_APP: "inkpoint",
      GITHUB_REPO: "wmasfoe/md-editor",
    };

    const res = await handleRequest(req, env);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");

    const html = await res.text();
    expect(html).toContain("Index of /");
    expect(html).toContain("/inkpoint/");
    expect(html).toContain("Inkpoint");
  });

  it("should render version index HTML on /inkpoint/ and 302 redirect /releases", async () => {
    const env: Env = {
      DEFAULT_APP: "inkpoint",
      GITHUB_REPO: "wmasfoe/md-editor",
    };

    // 1. /inkpoint/ (canonical 200)
    const reqApp = new Request("https://download.justdev.cn/inkpoint/");
    const resApp = await handleRequest(reqApp, env);
    expect(resApp.status).toBe(200);
    expect(resApp.headers.get("Content-Type")).toContain("text/html");
    const html = await resApp.text();
    expect(html).toContain("Index of /inkpoint/");
    expect(html).toContain("[Root]");
    expect(html).toContain("0.10.2/");

    // 2. /releases (302 redirect to /inkpoint/)
    const reqReleases = new Request("https://download.justdev.cn/releases");
    const resReleases = await handleRequest(reqReleases, env);
    expect(resReleases.status).toBe(302);
    expect(resReleases.headers.get("Location")).toBe("https://download.justdev.cn/inkpoint/");
  });

  it("should render version package detail HTML on /inkpoint/0.10.2/ and /inkpoint/desktop/0.10.2/", async () => {
    const env: Env = {
      DEFAULT_APP: "inkpoint",
      GITHUB_REPO: "wmasfoe/md-editor",
    };

    // 1. 兼容路由 /inkpoint/0.10.2/
    const req1 = new Request("https://download.justdev.cn/inkpoint/0.10.2/");
    const res1 = await handleRequest(req1, env);
    expect(res1.status).toBe(200);
    expect(res1.headers.get("Content-Type")).toContain("text/html");
    const html1 = await res1.text();
    expect(html1).toContain("Index of /inkpoint/desktop/0.10.2/");
    expect(html1).toContain("Inkpoint_0.10.2_aarch64.dmg");
    expect(html1).toContain("[R2 Edge]");
    expect(html1).toContain("../ (Parent Directory)");

    // 2. 规范层级路由 /inkpoint/desktop/0.10.2/
    const req2 = new Request("https://download.justdev.cn/inkpoint/desktop/0.10.2/");
    const res2 = await handleRequest(req2, env);
    expect(res2.status).toBe(200);
    const html2 = await res2.text();
    expect(html2).toContain("Index of /inkpoint/desktop/0.10.2/");
    expect(html2).toContain("Inkpoint_0.10.2_aarch64.dmg");
  });

  it("should render device-specific portal on /inkpoint/android and 302 redirect /releases/android", async () => {
    const env: Env = {
      DEFAULT_APP: "inkpoint",
      GITHUB_REPO: "wmasfoe/md-editor",
    };

    // 1. /inkpoint/android (canonical 200)
    const req1 = new Request("https://download.justdev.cn/inkpoint/android");
    const res1 = await handleRequest(req1, env);
    expect(res1.status).toBe(200);
    const html1 = await res1.text();
    expect(html1).toContain("Index of /inkpoint/android/");
    expect(html1).toContain("Android 移动端");
    expect(html1).toContain("0.1.1/");
    expect(html1).toContain("0.1.0/");
    expect(html1).toContain("/api/inkpoint/android/releases");

    // 2. /releases/android (302 redirect to canonical)
    const req2 = new Request("https://download.justdev.cn/releases/android");
    const res2 = await handleRequest(req2, env);
    expect(res2.status).toBe(302);
    expect(res2.headers.get("Location")).toBe("https://download.justdev.cn/inkpoint/android/");

    // 3. /android shortcut (302 redirect to canonical)
    const req3 = new Request("https://download.justdev.cn/android");
    const res3 = await handleRequest(req3, env);
    expect(res3.status).toBe(302);
    expect(res3.headers.get("Location")).toBe("https://download.justdev.cn/inkpoint/android/");
  });

  it("should render device-specific portal on /inkpoint/desktop and 302 redirect /releases/desktop and /desktop", async () => {
    const env: Env = {
      DEFAULT_APP: "inkpoint",
      GITHUB_REPO: "wmasfoe/md-editor",
    };

    const req = new Request("https://download.justdev.cn/inkpoint/desktop");
    const res = await handleRequest(req, env);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Index of /inkpoint/desktop/");
    expect(html).toContain("Desktop 桌面端");
    expect(html).toContain("0.10.2/");
    expect(html).toContain("/api/inkpoint/desktop/releases");

    const reqDesktop = new Request("https://download.justdev.cn/desktop");
    const resDesktop = await handleRequest(reqDesktop, env);
    expect(resDesktop.status).toBe(302);
    expect(resDesktop.headers.get("Location")).toBe(
      "https://download.justdev.cn/inkpoint/desktop/",
    );
  });

  it("should provide latestDesktopVersion and latestAndroidVersion in releases manifest API", async () => {
    const env: Env = {
      DEFAULT_APP: "inkpoint",
      GITHUB_REPO: "wmasfoe/md-editor",
    };

    const req = new Request("https://download.justdev.cn/api/inkpoint/releases");
    const res = await handleRequest(req, env);
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      latestDesktopVersion?: string;
      latestAndroidVersion?: string;
      latestReleases?: {
        android?: { version: string; downloadUrl: string };
      };
    };

    expect(data.latestDesktopVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(data.latestAndroidVersion).toBe("0.1.1");
    expect(data.latestReleases?.android?.version).toBe("0.1.1");
  });

  it("should serve 3-segment versioned artifact directly from R2 when available", async () => {
    const mockBucket = {
      get: async (key: string) => {
        if (key === "inkpoint/desktop/0.10.2/Inkpoint_0.10.2_aarch64.dmg") {
          return {
            body: new ReadableStream(),
            httpEtag: "etag-3seg-dmg",
            writeHttpMetadata: (_headers: Headers) => {},
          } as unknown as R2ObjectBody;
        }
        return null;
      },
    };

    const req = new Request(
      "https://download.justdev.cn/inkpoint/0.10.2/Inkpoint_0.10.2_aarch64.dmg",
    );
    const env: Env = {
      DEFAULT_APP: "inkpoint",
      RELEASE_BUCKET: mockBucket as unknown as R2Bucket,
    };

    const res = await handleRequest(req, env);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/x-apple-diskimage");
    expect(res.headers.get("Content-Disposition")).toContain("Inkpoint_0.10.2_aarch64.dmg");
  });

  it("should return 404 on unrecognized route", async () => {
    const req = new Request("https://download.justdev.cn/unknown/invalid/path/test");
    const env: Env = {};

    const res = await handleRequest(req, env);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Route not found");
  });

  it("should provide both fallback desktop and android releases when upstream is unavailable", async () => {
    const env: Env = {};
    const manifest = await buildReleasesManifest(
      "inkpoint",
      "non-existent/non-existent-repo-for-testing",
      env,
      "https://download.justdev.cn",
    );

    expect(manifest.latestDesktopVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(manifest.latestAndroidVersion).toBe("0.1.1");
    expect(manifest.releases.some((r) => r.category === "desktop")).toBe(true);
    expect(manifest.releases.some((r) => r.category === "android" && r.version === "0.1.1")).toBe(
      true,
    );
    expect(manifest.releases.some((r) => r.category === "android" && r.version === "0.1.0")).toBe(
      true,
    );
  });

  it("should return edge ISR Cache-Control headers on HTML and API responses", async () => {
    const req = new Request("https://download.justdev.cn/inkpoint/desktop", {
      headers: { Accept: "text/html" },
    });
    const env: Env = {
      DEFAULT_APP: "inkpoint",
    };

    const res = await handleRequest(req, env);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe(
      "public, max-age=60, s-maxage=600, stale-while-revalidate=86400",
    );
  });

  it("should dynamically render newly updated version from R2 version.json without static rebuild", async () => {
    const updatedManifest = {
      app: "inkpoint",
      updatedAt: "2026-09-17T12:00:00Z",
      desktop: {
        version: "0.11.0",
        releaseNotesUrl: "https://github.com/wmasfoe/md-editor/releases/tag/v0.11.0",
        assets: {
          macos_arm64: {
            version: "0.11.0",
            fileName: "Inkpoint_0.11.0_aarch64.dmg",
            downloadUrl: "https://download.justdev.cn/inkpoint/desktop/macos/latest",
            sizeBytes: 88000000,
          },
        },
      },
    };

    const mockBucket = {
      get: async (key: string) => {
        if (key === "inkpoint/version.json") {
          return {
            text: async () => JSON.stringify(updatedManifest),
            body: new ReadableStream(),
          } as unknown as R2ObjectBody;
        }
        return null;
      },
    };

    const req = new Request("https://download.justdev.cn/inkpoint/desktop", {
      headers: { Accept: "text/html" },
    });
    const env: Env = {
      DEFAULT_APP: "inkpoint",
      RELEASE_BUCKET: mockBucket as unknown as R2Bucket,
    };

    const res = await handleRequest(req, env);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("0.11.0");
    expect(html).toContain("Index of /inkpoint/desktop/");
  });

  it("should handle /api/purge-cache endpoint correctly", async () => {
    // 1. Method not allowed for GET
    const getReq = new Request("https://download.justdev.cn/api/purge-cache", { method: "GET" });
    const resGet = await handleRequest(getReq, { DEFAULT_APP: "inkpoint" });
    expect(resGet.status).toBe(405);

    // 2. Unauthorized when PURGE_TOKEN is configured but missing/invalid
    const postUnauthorized = new Request("https://download.justdev.cn/api/purge-cache", {
      method: "POST",
    });
    const resUnauthorized = await handleRequest(postUnauthorized, {
      DEFAULT_APP: "inkpoint",
      PURGE_TOKEN: "secret-token",
    });
    expect(resUnauthorized.status).toBe(401);

    // 3. Authorized cache purge
    const postAuthorized = new Request("https://download.justdev.cn/api/purge-cache", {
      method: "POST",
      headers: {
        "X-Purge-Token": "secret-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        urls: ["https://download.justdev.cn/inkpoint/desktop"],
      }),
    });
    const resAuthorized = await handleRequest(postAuthorized, {
      DEFAULT_APP: "inkpoint",
      PURGE_TOKEN: "secret-token",
    });
    expect(resAuthorized.status).toBe(200);
    const body = (await resAuthorized.json()) as { success: boolean; message: string };
    expect(body.success).toBe(true);
    expect(body.message).toContain("purged successfully");
  });

  it("should discover and list multiple Android versions from R2 bucket list and keep historical versions", async () => {
    const mockObjects = [
      {
        key: "inkpoint/android/0.1.0/Inkpoint_0.1.0.apk",
        size: 45000000,
        uploaded: new Date("2026-09-16T12:00:00Z"),
      },
      {
        key: "inkpoint/android/0.1.1/Inkpoint_0.1.1.apk",
        size: 46000000,
        uploaded: new Date("2026-09-17T12:00:00Z"),
      },
    ];

    const mockBucket = {
      list: async ({ prefix }: { prefix?: string }) => {
        if (prefix === "inkpoint/android/") {
          return { objects: mockObjects };
        }
        return { objects: [] };
      },
      get: async () => null,
    };

    const req = new Request("https://download.justdev.cn/inkpoint/android");
    const env: Env = {
      DEFAULT_APP: "inkpoint",
      RELEASE_BUCKET: mockBucket as unknown as R2Bucket,
    };

    const res = await handleRequest(req, env);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("0.1.1/");
    expect(html).toContain("0.1.0/");
    expect(html).toContain("共 2 个版本");
  });

  it("should filter out non-desktop and non-android releases (e.g. utools-v*, web-v*) from manifest", async () => {
    const env: Env = {
      DEFAULT_APP: "inkpoint",
      GITHUB_REPO: "wmasfoe/md-editor",
    };

    const manifest = await buildReleasesManifest(
      "inkpoint",
      "wmasfoe/md-editor",
      env,
      "https://download.justdev.cn",
    );

    expect(manifest.releases.length).toBeGreaterThan(0);
    expect(
      manifest.releases.every((r) => r.category === "desktop" || r.category === "android"),
    ).toBe(true);
    expect(
      manifest.releases.some((r) => r.version.includes("utools") || r.version.includes("web")),
    ).toBe(false);
    expect(manifest.latestDesktopVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(manifest.releases[0].version).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
