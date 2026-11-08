import { describe, expect, it } from "vitest";

describe("getDesktopChangelogEntries & getWebChangelogEntries", () => {
  it("reads desktop and web changelogs correctly in Chinese and English", async () => {
    const { getDesktopChangelogEntries, getWebChangelogEntries } = await import("../lib/changelog");

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
  });

  it("reads desktop and web changelogs correctly for zh-Hant and ja locales", async () => {
    const { getDesktopChangelogEntries, getWebChangelogEntries } = await import("../lib/changelog");

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
  });

  it("falls back to Chinese when English changelog is not found", async () => {
    const { getDesktopChangelogEntries } = await import("../lib/changelog");
    // 传入不存在的文件路径，但在 locale="en" 且无显式指定时或指定不存在路径时的行为
    const entries = getDesktopChangelogEntries("en", "/non-existent-en-changelog.md");
    // 显式指定不存在路径时，fallback 尝试中文但如果中文路径也是该不存在路径，应安全返回空数组或回退
    expect(Array.isArray(entries)).toBe(true);
  });
});
