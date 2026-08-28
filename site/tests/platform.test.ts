import { describe, expect, it } from "vitest";
import { detectSitePlatform, isSitePlatform } from "../lib/platform";

describe("detectSitePlatform", () => {
  it("detects Windows desktop browsers", () => {
    expect(
      detectSitePlatform(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0",
      ),
    ).toBe("windows");
  });

  it("detects Linux desktop browsers", () => {
    expect(
      detectSitePlatform("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0"),
    ).toBe("linux");
  });

  it("detects ChromeOS as Linux", () => {
    expect(detectSitePlatform("Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36")).toBe(
      "linux",
    );
  });

  it("does not treat Android as Linux", () => {
    expect(
      detectSitePlatform(
        "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile",
      ),
    ).toBe("macos");
  });

  it("defaults macOS and unknown agents to macos", () => {
    expect(
      detectSitePlatform(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15",
      ),
    ).toBe("macos");
    expect(detectSitePlatform("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)")).toBe(
      "macos",
    );
    expect(detectSitePlatform("")).toBe("macos");
  });
});

describe("isSitePlatform", () => {
  it("accepts known platform ids only", () => {
    expect(isSitePlatform("macos")).toBe(true);
    expect(isSitePlatform("linux")).toBe(true);
    expect(isSitePlatform("windows")).toBe(true);
    expect(isSitePlatform("android")).toBe(false);
    expect(isSitePlatform("")).toBe(false);
  });
});
