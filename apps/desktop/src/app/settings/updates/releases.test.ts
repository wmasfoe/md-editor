import { describe, expect, it } from "vitest";
import {
  compareReleaseVersions,
  detectRuntimeArch,
  parsePublishedVersionTag,
  pickPlatformAssetUrl,
} from "./releases";

describe("parsePublishedVersionTag", () => {
  describe("conventional desktop tags (current baseline)", () => {
    it("parses vX.Y.Z tags", () => {
      expect(parsePublishedVersionTag("v0.10.1")).toBe("0.10.1");
      expect(parsePublishedVersionTag("v1.0.0")).toBe("1.0.0");
      expect(parsePublishedVersionTag("v2.15.3")).toBe("2.15.3");
    });

    it("parses prerelease tags with v prefix", () => {
      expect(parsePublishedVersionTag("v0.10.2-beta.1")).toBe("0.10.2-beta.1");
      expect(parsePublishedVersionTag("v1.0.0-rc.2")).toBe("1.0.0-rc.2");
      expect(parsePublishedVersionTag("v0.10.2-beta.sha1234567")).toBe("0.10.2-beta.sha1234567");
    });
  });

  describe("forward-compatible desktop tags (desktop-*)", () => {
    it("parses desktop-vX.Y.Z tags", () => {
      expect(parsePublishedVersionTag("desktop-v0.10.2")).toBe("0.10.2");
      expect(parsePublishedVersionTag("desktop-v1.0.0")).toBe("1.0.0");
    });

    it("parses desktop-X.Y.Z tags without v", () => {
      expect(parsePublishedVersionTag("desktop-0.10.2")).toBe("0.10.2");
      expect(parsePublishedVersionTag("desktop-1.0.0")).toBe("1.0.0");
    });

    it("parses desktop prerelease tags", () => {
      expect(parsePublishedVersionTag("desktop-v0.10.2-beta.1")).toBe("0.10.2-beta.1");
      expect(parsePublishedVersionTag("desktop-0.10.2-beta.sha1234567")).toBe(
        "0.10.2-beta.sha1234567",
      );
    });
  });

  describe("Homebrew tap release tags", () => {
    it("parses md-editor-vX.Y.Z tags", () => {
      expect(parsePublishedVersionTag("md-editor-v0.10.1")).toBe("0.10.1");
    });

    it("parses md-editor-desktop-vX.Y.Z tags", () => {
      expect(parsePublishedVersionTag("md-editor-desktop-v0.10.2")).toBe("0.10.2");
    });
  });

  describe("strict filtering of non-desktop tags", () => {
    it("ignores Web releases", () => {
      expect(parsePublishedVersionTag("web-v0.1.0")).toBeNull();
      expect(parsePublishedVersionTag("web-v0.2.0")).toBeNull();
      expect(parsePublishedVersionTag("web-0.1.0")).toBeNull();
    });

    it("ignores Mobile releases", () => {
      expect(parsePublishedVersionTag("mobile-v1.0.0")).toBeNull();
      expect(parsePublishedVersionTag("mobile-1.0.0")).toBeNull();
    });

    it("ignores site or docs releases", () => {
      expect(parsePublishedVersionTag("site-v1.0.0")).toBeNull();
      expect(parsePublishedVersionTag("docs-v1.0.0")).toBeNull();
    });
  });

  describe("invalid or malformed inputs", () => {
    it("returns null for null, undefined or empty strings", () => {
      expect(parsePublishedVersionTag(null)).toBeNull();
      expect(parsePublishedVersionTag("")).toBeNull();
      expect(parsePublishedVersionTag("   ")).toBeNull();
    });

    it("returns null for non-semver strings", () => {
      expect(parsePublishedVersionTag("v")).toBeNull();
      expect(parsePublishedVersionTag("desktop-v")).toBeNull();
      expect(parsePublishedVersionTag("v-invalid")).toBeNull();
      expect(parsePublishedVersionTag("desktop-v-invalid")).toBeNull();
      expect(parsePublishedVersionTag("release-notes")).toBeNull();
    });
  });
});

describe("compareReleaseVersions", () => {
  it("compares semver versions correctly", () => {
    expect(compareReleaseVersions("0.10.2", "0.10.1")).toBe(1);
    expect(compareReleaseVersions("0.10.1", "0.10.2")).toBe(-1);
    expect(compareReleaseVersions("0.10.1", "0.10.1")).toBe(0);
    expect(compareReleaseVersions("1.0.0", "0.10.1")).toBe(1);
    expect(compareReleaseVersions("0.11.0", "0.10.9")).toBe(1);
  });
});

describe("detectRuntimeArch", () => {
  it("detects ARM64 from aarch64 and arm64 tokens", () => {
    expect(detectRuntimeArch("Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/605.1.15", "")).toBe(
      "arm64",
    );
    expect(detectRuntimeArch("Mozilla/5.0 (Windows NT 10.0; ARM64) AppleWebKit/537.36", "")).toBe(
      "arm64",
    );
  });

  it("detects x64 from x86_64, amd64, x64 and win64 tokens", () => {
    expect(detectRuntimeArch("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36", "")).toBe("x64");
    expect(
      detectRuntimeArch("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36", ""),
    ).toBe("x64");
  });

  it("never mistakes frozen Intel Mac UA for x64-capable detection", () => {
    // macOS UA 冻结为 Intel 字样，无法区分 Apple Silicon / Intel，必须返回 unknown
    // 交由首个匹配兜底（当前只发布 aarch64 DMG）。
    expect(
      detectRuntimeArch(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15",
        "MacIntel",
      ),
    ).toBe("unknown");
  });

  it("returns unknown when no arch token is present", () => {
    expect(detectRuntimeArch("Mozilla/5.0 AppleWebKit/605.1.15", "")).toBe("unknown");
  });
});

describe("pickPlatformAssetUrl", () => {
  const linuxAssets = [
    { name: "inkpoint_0.12.1_aarch64.appimage", downloadUrl: "https://example.com/arm64" },
    { name: "inkpoint_0.12.1_amd64.appimage", downloadUrl: "https://example.com/x64" },
    { name: "inkpoint_0.12.1_arm64.deb", downloadUrl: "https://example.com/arm64-deb" },
    { name: "inkpoint_0.12.1_amd64.deb", downloadUrl: "https://example.com/x64-deb" },
  ];

  it("prefers same-arch asset regardless of list order", () => {
    expect(pickPlatformAssetUrl(linuxAssets, matchLinuxInstaller, "arm64")).toBe(
      "https://example.com/arm64",
    );
    expect(pickPlatformAssetUrl(linuxAssets, matchLinuxInstaller, "x64")).toBe(
      "https://example.com/x64",
    );
  });

  it("keeps legacy first-match behavior when arch is unknown", () => {
    expect(pickPlatformAssetUrl(linuxAssets, matchLinuxInstaller, "unknown")).toBe(
      "https://example.com/arm64",
    );
  });

  it("falls back to any available asset when same-arch build is missing", () => {
    const x64Only = linuxAssets.filter((asset) => asset.downloadUrl.includes("x64"));
    expect(pickPlatformAssetUrl(x64Only, matchLinuxInstaller, "arm64")).toBe(
      "https://example.com/x64",
    );
  });

  it("returns undefined when nothing matches", () => {
    expect(pickPlatformAssetUrl(linuxAssets, () => false, "x64")).toBeUndefined();
  });
});

function matchLinuxInstaller(name: string): boolean {
  return name.endsWith(".appimage") || name.endsWith(".deb");
}
