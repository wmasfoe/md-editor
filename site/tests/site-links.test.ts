import { describe, expect, it } from "vitest";
import {
  buildMacosDmgUrl,
  GITHUB_RELEASES_URL,
  GITHUB_REPO_URL,
  normalizeVersion,
} from "../lib/site-links";

describe("site-links", () => {
  it("exposes project and public release URLs", () => {
    expect(GITHUB_REPO_URL).toBe("https://github.com/wmasfoe/md-editor");
    expect(GITHUB_RELEASES_URL).toBe("https://github.com/wmasfoe/homebrew-tap/releases");
  });

  it("normalizes optional v prefix", () => {
    expect(normalizeVersion("0.3.16")).toBe("0.3.16");
    expect(normalizeVersion("v0.3.16")).toBe("0.3.16");
    expect(normalizeVersion("  v1.0.0  ")).toBe("1.0.0");
    expect(normalizeVersion("")).toBeNull();
    expect(normalizeVersion("   ")).toBeNull();
  });

  it("builds stable DMG download URL matching cask naming", () => {
    expect(buildMacosDmgUrl("0.3.16")).toBe(
      "https://github.com/wmasfoe/homebrew-tap/releases/download/md-editor-v0.3.16/Markdown.Editor_0.3.16_aarch64.dmg",
    );
    expect(buildMacosDmgUrl("v0.3.16")).toBe(
      "https://github.com/wmasfoe/homebrew-tap/releases/download/md-editor-v0.3.16/Markdown.Editor_0.3.16_aarch64.dmg",
    );
  });

  it("rejects empty version when building DMG url", () => {
    expect(() => buildMacosDmgUrl("")).toThrow(/Invalid macOS DMG version/u);
  });
});
