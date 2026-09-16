import { describe, expect, it } from "vitest";
import { handleRequest, matchDesktopAsset } from "../src/router.ts";
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
    expect(manifest.releases[0].version).toBe("0.10.2");
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

  it("should render version index HTML on /releases or /inkpoint/", async () => {
    const req = new Request("https://download.justdev.cn/releases");
    const env: Env = {
      DEFAULT_APP: "inkpoint",
      GITHUB_REPO: "wmasfoe/md-editor",
    };

    const res = await handleRequest(req, env);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");

    const html = await res.text();
    expect(html).toContain("Index of /inkpoint/");
    expect(html).toContain("[Root]");
    expect(html).toContain("0.10.2/");
  });

  it("should render version package detail HTML on /inkpoint/0.10.2/", async () => {
    const req = new Request("https://download.justdev.cn/inkpoint/0.10.2/");
    const env: Env = {
      DEFAULT_APP: "inkpoint",
      GITHUB_REPO: "wmasfoe/md-editor",
    };

    const res = await handleRequest(req, env);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");

    const html = await res.text();
    expect(html).toContain("Index of /inkpoint/0.10.2/");
    expect(html).toContain("Inkpoint_0.10.2_aarch64.dmg");
    expect(html).toContain("[R2 Edge]");
    expect(html).toContain("../ (Parent Directory)");
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
});
