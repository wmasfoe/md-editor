import { describe, expect, it } from "vitest";
import { buildDownloadDedupKey } from "../src/analytics.ts";

const baseEvent = {
  app: "inkpoint",
  platform: "windows-x64",
  version: "0.11.0",
  fileName: "Inkpoint_0.11.0_x64-setup.exe",
  country: "US",
  source: "direct",
  userAgent: "vitest",
} as const;

describe("download analytics", () => {
  it("distinguishes downloads of different platforms and files", () => {
    const windowsKey = buildDownloadDedupKey("203.0.113.1", baseEvent, "20260922");
    const linuxKey = buildDownloadDedupKey(
      "203.0.113.1",
      {
        ...baseEvent,
        platform: "linux-x64",
        fileName: "Inkpoint_0.11.0_amd64.AppImage",
      },
      "20260922",
    );

    expect(windowsKey).not.toBe(linuxKey);
    expect(windowsKey).toContain(":windows-x64:");
    expect(windowsKey).toContain(":Inkpoint_0.11.0_x64-setup.exe:");
  });

  it("keeps identical download events on the same day deduplicated", () => {
    expect(buildDownloadDedupKey("203.0.113.1", baseEvent, "20260922")).toBe(
      buildDownloadDedupKey("203.0.113.1", baseEvent, "20260922"),
    );
  });
});
