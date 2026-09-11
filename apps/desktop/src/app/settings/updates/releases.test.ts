import { describe, expect, it } from "vitest";
import { compareReleaseVersions, parsePublishedVersionTag } from "./releases";

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
