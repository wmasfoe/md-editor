import { describe, expect, it } from "vitest";
import { buildDownloadCatalog, getPlatformInstall } from "../lib/downloads";
import { detectLocaleFromHeader, en, getTranslation, isLocale, ja, zh, zhHant } from "../lib/i18n";

function extractPaths(obj: Record<string, unknown>, prefix = ""): string[] {
  const paths: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    const nextPath = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === "object") {
      paths.push(...extractPaths(value as Record<string, unknown>, nextPath));
    } else {
      paths.push(nextPath);
    }
  }
  return paths.toSorted();
}

describe("detectLocaleFromHeader", () => {
  it("detects Simplified Chinese when zh-CN/zh is preferred", () => {
    expect(detectLocaleFromHeader("zh-CN,zh;q=0.9,en;q=0.8")).toBe("zh");
    expect(detectLocaleFromHeader("zh")).toBe("zh");
    expect(detectLocaleFromHeader("ZH-CN")).toBe("zh");
    expect(detectLocaleFromHeader("zh-SG,zh;q=0.9")).toBe("zh");
  });

  it("detects Traditional Chinese when zh-TW/zh-HK/zh-Hant is preferred", () => {
    expect(detectLocaleFromHeader("zh-TW,zh;q=0.9,en-US;q=0.8")).toBe("zh-Hant");
    expect(detectLocaleFromHeader("zh-HK,zh;q=0.8")).toBe("zh-Hant");
    expect(detectLocaleFromHeader("zh-MO,zh;q=0.8")).toBe("zh-Hant");
    expect(detectLocaleFromHeader("zh-Hant-TW,zh-Hant;q=0.9")).toBe("zh-Hant");
  });

  it("detects Japanese when ja is preferred", () => {
    expect(detectLocaleFromHeader("ja-JP,ja;q=0.9,en;q=0.8")).toBe("ja");
    expect(detectLocaleFromHeader("ja")).toBe("ja");
  });

  it("defaults to English when browser language is English or unsupported", () => {
    // 英文优先
    expect(detectLocaleFromHeader("en-US,en;q=0.9,zh-CN;q=0.8")).toBe("en");
    expect(detectLocaleFromHeader("en-GB,en;q=0.5")).toBe("en");
    expect(detectLocaleFromHeader("en")).toBe("en");

    // 不支持的语言一律默认返回英文
    expect(detectLocaleFromHeader("fr-FR,fr;q=0.9")).toBe("en");
    expect(detectLocaleFromHeader("de-DE,de;q=0.9,es;q=0.8")).toBe("en");
    expect(detectLocaleFromHeader("ko-KR,ko;q=0.9")).toBe("en");
    expect(detectLocaleFromHeader("ru-RU,ru;q=0.9")).toBe("en");
  });

  it("defaults to English when header is empty or missing", () => {
    expect(detectLocaleFromHeader("")).toBe("en");
    expect(detectLocaleFromHeader(null)).toBe("en");
    expect(detectLocaleFromHeader(undefined)).toBe("en");
    expect(detectLocaleFromHeader("   ")).toBe("en");
    expect(detectLocaleFromHeader("*;q=0.5")).toBe("en");
  });
});

describe("isLocale", () => {
  it("validates supported locales", () => {
    expect(isLocale("zh")).toBe(true);
    expect(isLocale("en")).toBe(true);
    expect(isLocale("zh-Hant")).toBe(true);
    expect(isLocale("ja")).toBe(true);
    expect(isLocale("fr")).toBe(false);
    expect(isLocale("")).toBe(false);
    expect(isLocale(null)).toBe(false);
    expect(isLocale(123)).toBe(false);
  });
});

describe("translations dictionary completeness", () => {
  it("has matching keys and structure for zh, en, zh-Hant, and ja", () => {
    expect(getTranslation("zh")).toBe(zh);
    expect(getTranslation("en")).toBe(en);
    expect(getTranslation("zh-Hant")).toBe(zhHant);
    expect(getTranslation("ja")).toBe(ja);

    const zhPaths = extractPaths(zh as unknown as Record<string, unknown>);
    const enPaths = extractPaths(en as unknown as Record<string, unknown>);
    const zhHantPaths = extractPaths(zhHant as unknown as Record<string, unknown>);
    const jaPaths = extractPaths(ja as unknown as Record<string, unknown>);

    expect(enPaths).toEqual(zhPaths);
    expect(zhHantPaths).toEqual(zhPaths);
    expect(jaPaths).toEqual(zhPaths);
  });
});

describe("buildDownloadCatalog with i18n", () => {
  it("provides localized labels for Chinese", () => {
    const catalogZh = buildDownloadCatalog("0.1.0", "zh");
    expect(catalogZh.macos.primary.label).toBe("下载 macOS");
    expect(catalogZh.linux.primary.label).toBe("下载 Linux");
    expect(catalogZh.windows.primary.label).toBe("下载 Windows");
    expect(catalogZh.windows.secondary[0].label).toBe("ARM64 安装包");
  });

  it("provides localized labels for Traditional Chinese", () => {
    const catalogZhHant = buildDownloadCatalog("0.1.0", "zh-Hant");
    expect(catalogZhHant.macos.primary.label).toBe("下載 macOS");
    expect(catalogZhHant.linux.primary.label).toBe("下載 Linux");
    expect(catalogZhHant.windows.primary.label).toBe("下載 Windows");
    expect(catalogZhHant.windows.secondary[0].label).toBe("ARM64 安裝套件");
  });

  it("provides localized labels for Japanese", () => {
    const catalogJa = buildDownloadCatalog("0.1.0", "ja");
    expect(catalogJa.macos.primary.label).toBe("macOS 版をダウンロード");
    expect(catalogJa.linux.primary.label).toBe("Linux 版をダウンロード");
    expect(catalogJa.windows.primary.label).toBe("Windows 版をダウンロード");
    expect(catalogJa.windows.secondary[0].label).toBe("ARM64 インストーラー");
  });

  it("provides localized labels for English", () => {
    const catalogEn = buildDownloadCatalog("0.1.0", "en");
    expect(catalogEn.macos.primary.label).toBe("Download for macOS");
    expect(catalogEn.linux.primary.label).toBe("Download for Linux");
    expect(catalogEn.windows.primary.label).toBe("Download for Windows");
    expect(catalogEn.windows.secondary[0].label).toBe("ARM64 Setup");
  });

  it("provides localized coming soon label for iOS", () => {
    expect(zh.download.comingSoon).toBe("敬请期待");
    expect(zhHant.download.comingSoon).toBe("敬請期待");
    expect(ja.download.comingSoon).toBe("近日公開");
    expect(en.download.comingSoon).toBe("Coming Soon");
  });
});

describe("getPlatformInstall with i18n", () => {
  it("provides localized install commands and instructions", () => {
    const macZh = getPlatformInstall("macos", "zh");
    expect(macZh?.title).toBe("终端一键安装");
    expect(macZh?.extra?.title).toBe("若提示「已损坏」，移除隔离标记");

    const macZhHant = getPlatformInstall("macos", "zh-Hant");
    expect(macZhHant?.title).toBe("終端機一鍵安裝");
    expect(macZhHant?.extra?.title).toBe("若提示「已損壞」，移除隔離標記");

    const macJa = getPlatformInstall("macos", "ja");
    expect(macJa?.title).toBe("ターミナルからワンクリックでインストール");
    expect(macJa?.extra?.title).toBe(
      "「壊れているため開けません」と表示される場合は検疫属性を解除",
    );

    const macEn = getPlatformInstall("macos", "en");
    expect(macEn?.title).toBe("One-line Terminal Install");
    expect(macEn?.extra?.title).toBe('If prompted "damaged", remove quarantine attribute');

    const winZh = getPlatformInstall("windows", "zh");
    expect(winZh?.title).toBe("PowerShell 一键安装");

    const winZhHant = getPlatformInstall("windows", "zh-Hant");
    expect(winZhHant?.title).toBe("PowerShell 一鍵安裝");

    const winJa = getPlatformInstall("windows", "ja");
    expect(winJa?.title).toBe("PowerShell からワンクリックでインストール");

    const winEn = getPlatformInstall("windows", "en");
    expect(winEn?.title).toBe("PowerShell One-line Install");
  });
});
