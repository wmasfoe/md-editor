import { describe, expect, it } from "vitest";
import { buildFallbackReleasesData, getReleasesData } from "../lib/releases";
import { formatDownloadUrlWithDomain } from "../lib/releases-types";

describe("releases library", () => {
  it("builds fallback releases data with desktop and android entries", () => {
    const data = buildFallbackReleasesData();

    expect(data.app).toBe("inkpoint");
    expect(data.total).toBeGreaterThan(0);
    expect(data.latestDesktopVersion).toBeDefined();
    expect(data.latestAndroidVersion).toBeDefined();

    const desktopReleases = data.releases.filter((r) => r.category === "desktop");
    const androidReleases = data.releases.filter((r) => r.category === "android");

    expect(desktopReleases.length).toBeGreaterThan(0);
    expect(androidReleases.length).toBeGreaterThan(0);

    // 检查 Desktop 最新版本包结构
    const latestDesktop = desktopReleases[0];
    expect(latestDesktop.isLatest).toBe(true);
    expect(latestDesktop.assets.length).toBeGreaterThanOrEqual(4);
    expect(latestDesktop.assets.some((a) => a.platform === "macos-arm64")).toBe(true);
    expect(latestDesktop.assets.some((a) => a.platform === "windows-x64")).toBe(true);
    expect(latestDesktop.assets.some((a) => a.platform === "linux-appimage")).toBe(true);

    // 检查 Android 移动端最新版本包结构
    const latestAndroid = androidReleases[0];
    expect(latestAndroid.category).toBe("android");
    expect(latestAndroid.assets.some((a) => a.platform === "android")).toBe(true);
    expect(latestAndroid.assets[0].fileName).toContain(".apk");
    expect(latestAndroid.assets[0].downloadUrl).toContain("/inkpoint/android/");
  });

  it("formats download URLs with dynamic host domain", () => {
    const rawUrl =
      "https://download.justdev.cn/inkpoint/desktop/0.10.2/Inkpoint_0.10.2_aarch64.dmg";

    // 映射到 download.jiaqi.im
    const customUrl = formatDownloadUrlWithDomain(rawUrl, "download.jiaqi.im");
    expect(customUrl).toBe(
      "https://download.jiaqi.im/inkpoint/desktop/0.10.2/Inkpoint_0.10.2_aarch64.dmg",
    );

    // 空域名保持原样
    expect(formatDownloadUrlWithDomain(rawUrl)).toBe(rawUrl);

    // 非标准 URL 安全处理
    expect(formatDownloadUrlWithDomain("/relative/path", "download.jiaqi.im")).toBe(
      "/relative/path",
    );
  });

  it("loads releases data safely without throwing", async () => {
    const data = await getReleasesData();
    expect(data).toBeDefined();
    expect(data.app).toBe("inkpoint");
    expect(data.releases.length).toBeGreaterThan(0);
    expect(data.latestDesktopVersion).toBeDefined();
    expect(data.latestAndroidVersion).toBeDefined();
  });
});
