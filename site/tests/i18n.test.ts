import { describe, expect, it } from "vitest";
import { buildDownloadCatalog, getPlatformInstall } from "../lib/downloads";
import { detectLocaleFromHeader, en, getTranslation, isLocale, zh } from "../lib/i18n";

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
  it("detects Chinese when zh is the preferred language", () => {
    expect(detectLocaleFromHeader("zh-CN,zh;q=0.9,en;q=0.8")).toBe("zh");
    expect(detectLocaleFromHeader("zh-TW,zh;q=0.9,en-US;q=0.8")).toBe("zh");
    expect(detectLocaleFromHeader("zh-HK,zh;q=0.8")).toBe("zh");
    expect(detectLocaleFromHeader("zh")).toBe("zh");
    expect(detectLocaleFromHeader("ZH-CN")).toBe("zh");
  });

  it("defaults to English when browser language is not Chinese", () => {
    // 英文优先
    expect(detectLocaleFromHeader("en-US,en;q=0.9,zh-CN;q=0.8")).toBe("en");
    expect(detectLocaleFromHeader("en-GB,en;q=0.5")).toBe("en");
    expect(detectLocaleFromHeader("en")).toBe("en");

    // 其他非中文语言一律展示英文
    expect(detectLocaleFromHeader("ja-JP,ja;q=0.9,en;q=0.8")).toBe("en");
    expect(detectLocaleFromHeader("fr-FR,fr;q=0.9")).toBe("en");
    expect(detectLocaleFromHeader("de-DE,de;q=0.9,es;q=0.8")).toBe("en");
    expect(detectLocaleFromHeader("ko-KR,ko;q=0.9")).toBe("en");
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
    expect(isLocale("fr")).toBe(false);
    expect(isLocale("")).toBe(false);
    expect(isLocale(null)).toBe(false);
    expect(isLocale(123)).toBe(false);
  });
});

describe("translations dictionary completeness", () => {
  it("has matching keys and structure for zh and en", () => {
    expect(getTranslation("zh")).toBe(zh);
    expect(getTranslation("en")).toBe(en);

    const zhPaths = extractPaths(zh as unknown as Record<string, unknown>);
    const enPaths = extractPaths(en as unknown as Record<string, unknown>);
    expect(enPaths).toEqual(zhPaths);
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

  it("provides localized labels for English", () => {
    const catalogEn = buildDownloadCatalog("0.1.0", "en");
    expect(catalogEn.macos.primary.label).toBe("Download for macOS");
    expect(catalogEn.linux.primary.label).toBe("Download for Linux");
    expect(catalogEn.windows.primary.label).toBe("Download for Windows");
    expect(catalogEn.windows.secondary[0].label).toBe("ARM64 Setup");
  });
});

describe("getPlatformInstall with i18n", () => {
  it("provides localized install commands and instructions", () => {
    const macZh = getPlatformInstall("macos", "zh");
    expect(macZh.title).toBe("终端一键安装");
    expect(macZh.extra?.title).toBe("若提示「已损坏」，移除隔离标记");

    const macEn = getPlatformInstall("macos", "en");
    expect(macEn.title).toBe("One-line Terminal Install");
    expect(macEn.extra?.title).toBe('If prompted "damaged", remove quarantine attribute');

    const winZh = getPlatformInstall("windows", "zh");
    expect(winZh.title).toBe("PowerShell 一键安装");

    const winEn = getPlatformInstall("windows", "en");
    expect(winEn.title).toBe("PowerShell One-line Install");
  });
});
