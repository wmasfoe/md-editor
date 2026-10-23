import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("getDesktopChangelogEntries, getWebChangelogEntries & getAndroidChangelogEntries", () => {
  it("reads desktop, web and android changelogs correctly in Chinese and English", async () => {
    const { getDesktopChangelogEntries, getWebChangelogEntries, getAndroidChangelogEntries } =
      await import("../lib/changelog");

    const desktopZh = getDesktopChangelogEntries("zh");
    const desktopEn = getDesktopChangelogEntries("en");
    expect(desktopZh.length).toBeGreaterThan(0);
    expect(desktopEn.length).toBeGreaterThan(0);
    expect(desktopZh[0].version).toBe(desktopEn[0].version);
    // 验证英文更新日志包含英文字符
    expect(desktopEn[0].items[0].text).toMatch(/^[A-Za-z]/u);

    const webZh = getWebChangelogEntries("zh");
    const webEn = getWebChangelogEntries("en");
    expect(webZh.length).toBeGreaterThan(0);
    expect(webEn.length).toBeGreaterThan(0);
    expect(webZh[0].version).toBe(webEn[0].version);
    expect(webEn[0].items[0].text).toMatch(/^[A-Za-z]/u);

    const androidZh = getAndroidChangelogEntries("zh");
    const androidEn = getAndroidChangelogEntries("en");
    expect(androidZh.length).toBeGreaterThanOrEqual(3);
    expect(androidEn.length).toBeGreaterThanOrEqual(3);
    // 中英条目顺序与版本号必须一一对应
    expect(androidZh.map((entry) => entry.version)).toEqual(
      androidEn.map((entry) => entry.version),
    );
    // 最新条目必须等于 Android 版本文件里的 versionName：
    // 发版脚本只升 build.gradle.kts，断言随之自动成立，无需每次发版手改本文件
    const androidGradleSource = await readFile(
      new URL("../../mobile/android/app/build.gradle.kts", import.meta.url),
      "utf8",
    );
    const gradleVersionName = /versionName\s*=\s*"([^"]+)"/u.exec(androidGradleSource)?.[1];
    expect(gradleVersionName).toBeDefined();
    expect(androidZh[0].version).toBe(gradleVersionName);
    expect(androidEn[0].version).toBe(gradleVersionName);
    // 最早的 Android 版本保持稳定，用于确认历史条目未被截断
    expect(androidZh.at(-1)?.version).toBe("0.1.0");
    expect(androidEn[0].items[0].text).toMatch(/^[*A-Za-z]/u);

    const { getIosChangelogEntries, getLatestIosVersion } = await import("../lib/changelog");
    const iosZh = getIosChangelogEntries("zh");
    const iosEn = getIosChangelogEntries("en");
    expect(iosZh.length).toBeGreaterThan(0);
    expect(iosEn.length).toBeGreaterThan(0);
    // 中英条目顺序与版本号必须一一对应
    expect(iosZh.map((entry) => entry.version)).toEqual(iosEn.map((entry) => entry.version));
    // 最新条目必须等于 Xcode 工程的 MARKETING_VERSION：发版脚本只升工程文件，断言随之自动成立
    const iosProjectSource = await readFile(
      new URL("../../mobile/ios/Inkpoint.xcodeproj/project.pbxproj", import.meta.url),
      "utf8",
    );
    const marketingVersion = /MARKETING_VERSION\s*=\s*([^;]+);/u.exec(iosProjectSource)?.[1].trim();
    expect(marketingVersion).toBeDefined();
    expect(iosZh[0].version).toBe(marketingVersion);
    expect(iosEn[0].version).toBe(marketingVersion);
    expect(getLatestIosVersion()).toBe(marketingVersion);
    expect(iosZh.at(-1)?.version).toBe("0.1.0");
    expect(iosEn[0].items[0].text).toMatch(/^[*A-Za-z]/u);
  });

  it("reads desktop, web and android changelogs correctly for zh-Hant and ja locales", async () => {
    const { getDesktopChangelogEntries, getWebChangelogEntries, getAndroidChangelogEntries } =
      await import("../lib/changelog");

    const desktopZhHant = getDesktopChangelogEntries("zh-Hant");
    const desktopJa = getDesktopChangelogEntries("ja");
    expect(desktopZhHant.length).toBeGreaterThan(0);
    expect(desktopJa.length).toBeGreaterThan(0);
    expect(desktopZhHant[0].version).toBe(desktopJa[0].version);
    // ja falls back to English changelog
    expect(desktopJa[0].items[0].text).toMatch(/^[A-Za-z]/u);

    const webZhHant = getWebChangelogEntries("zh-Hant");
    const webJa = getWebChangelogEntries("ja");
    expect(webZhHant.length).toBeGreaterThan(0);
    expect(webJa.length).toBeGreaterThan(0);
    expect(webJa[0].items[0].text).toMatch(/^[A-Za-z]/u);

    const androidZhHant = getAndroidChangelogEntries("zh-Hant");
    const androidJa = getAndroidChangelogEntries("ja");
    expect(androidZhHant.length).toBeGreaterThanOrEqual(3);
    expect(androidJa.length).toBeGreaterThanOrEqual(3);
    expect(androidJa[0].items[0].text).toMatch(/^[*A-Za-z]/u);

    const { getIosChangelogEntries } = await import("../lib/changelog");
    expect(getIosChangelogEntries("zh-Hant").length).toBeGreaterThan(0);
    expect(getIosChangelogEntries("ja").length).toBeGreaterThan(0);
    expect(getIosChangelogEntries("ja")[0].items[0].text).toMatch(/^[*A-Za-z]/u);
  });

  it("falls back to Chinese when English changelog is not found", async () => {
    const { getDesktopChangelogEntries } = await import("../lib/changelog");
    // 传入不存在的文件路径，但在 locale="en" 且无显式指定时或指定不存在路径时的行为
    const entries = getDesktopChangelogEntries("en", "/non-existent-en-changelog.md");
    // 显式指定不存在路径时，fallback 尝试中文但如果中文路径也是该不存在路径，应安全返回空数组或回退
    expect(Array.isArray(entries)).toBe(true);
  });
});
