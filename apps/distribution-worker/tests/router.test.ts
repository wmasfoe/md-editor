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

  it("should return 404 on unrecognized route", async () => {
    const req = new Request("https://download.justdev.cn/unknown/invalid/path/test");
    const env: Env = {};

    const res = await handleRequest(req, env);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Route not found");
  });
});
