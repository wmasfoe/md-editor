import { describe, expect, it } from "vitest";
import {
  changeLanguage,
  detectSystemLocale,
  getCurrentLocale,
  normalizeLanguageSetting,
  resolveActiveLocale,
  t,
} from "../src";
import { en } from "../src/locales/en";
import { ja } from "../src/locales/ja";
import { zh } from "../src/locales/zh";
import { zhHant } from "../src/locales/zh-Hant";

function getObjectPaths(obj: Record<string, unknown>, prefix = ""): string[] {
  return Object.keys(obj).flatMap((key) => {
    const nextPrefix = prefix ? `${prefix}.${key}` : key;
    const value = obj[key];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return getObjectPaths(value as Record<string, unknown>, nextPrefix);
    }
    return [nextPrefix];
  });
}

describe("@md-editor/i18n", () => {
  it("should have identical key paths among zh, zh-Hant, ja, and en translations (Key Parity)", () => {
    const zhPaths = getObjectPaths(zh).toSorted();
    const enPaths = getObjectPaths(en).toSorted();
    const zhHantPaths = getObjectPaths(zhHant).toSorted();
    const jaPaths = getObjectPaths(ja).toSorted();

    expect(enPaths).toEqual(zhPaths);
    expect(zhHantPaths).toEqual(zhPaths);
    expect(jaPaths).toEqual(zhPaths);
  });

  it("should resolve active locale properly", () => {
    expect(resolveActiveLocale("zh")).toBe("zh");
    expect(resolveActiveLocale("en")).toBe("en");
    expect(resolveActiveLocale("zh-Hant")).toBe("zh-Hant");
    expect(resolveActiveLocale("ja")).toBe("ja");
    expect(resolveActiveLocale("invalid")).toBe("en");
    // "system" will resolve to one of supported locales
    const systemLocale = resolveActiveLocale("system");
    expect(["zh", "en", "zh-Hant", "ja"]).toContain(systemLocale);
  });

  it("should normalize language setting correctly", () => {
    expect(normalizeLanguageSetting("zh")).toBe("zh");
    expect(normalizeLanguageSetting("zh-Hant")).toBe("zh-Hant");
    expect(normalizeLanguageSetting("en")).toBe("en");
    expect(normalizeLanguageSetting("ja")).toBe("ja");
    expect(normalizeLanguageSetting("system")).toBe("system");
    expect(normalizeLanguageSetting("fr")).toBe("system");
    expect(normalizeLanguageSetting("invalid")).toBe("system");
    expect(normalizeLanguageSetting(null)).toBe("system");
    expect(normalizeLanguageSetting(undefined)).toBe("system");
    expect(normalizeLanguageSetting(123)).toBe("system");
    expect(normalizeLanguageSetting({})).toBe("system");
  });

  it("should detect system locale correctly and default to en when unsupported", () => {
    expect(detectSystemLocale({ languages: ["zh-CN", "zh"] })).toBe("zh");
    expect(detectSystemLocale({ languages: ["zh-TW", "zh"] })).toBe("zh-Hant");
    expect(detectSystemLocale({ languages: ["zh-HK"] })).toBe("zh-Hant");
    expect(detectSystemLocale({ languages: ["ja-JP", "ja"] })).toBe("ja");
    expect(detectSystemLocale({ languages: ["en-US", "en"] })).toBe("en");
    // Unsupported languages default to English
    expect(detectSystemLocale({ languages: ["fr-FR", "fr"] })).toBe("en");
    expect(detectSystemLocale({ languages: ["de-DE"] })).toBe("en");
    expect(detectSystemLocale({ languages: ["ko-KR"] })).toBe("en");
    expect(detectSystemLocale({ languages: [] })).toBe("en");
  });

  it("should change language and translate keys correctly across all languages", async () => {
    await changeLanguage("zh");
    expect(getCurrentLocale()).toBe("zh");
    expect(t("common.save")).toBe("保存");
    expect(t("settings.title")).toBe("设置");

    await changeLanguage("en");
    expect(getCurrentLocale()).toBe("en");
    expect(t("common.save")).toBe("Save");
    expect(t("settings.title")).toBe("Settings");

    await changeLanguage("zh-Hant");
    expect(getCurrentLocale()).toBe("zh-Hant");
    expect(t("common.save")).toBe("儲存");
    expect(t("settings.title")).toBe("設定");

    await changeLanguage("ja");
    expect(getCurrentLocale()).toBe("ja");
    expect(t("common.save")).toBe("保存");
    expect(t("settings.title")).toBe("設定");
  });

  it("should support parameter interpolation", async () => {
    await changeLanguage("zh");
    expect(t("settings.general.currentVersion", { version: "1.0.0" })).toBe("当前版本 1.0.0");

    await changeLanguage("en");
    expect(t("settings.general.currentVersion", { version: "1.0.0" })).toBe(
      "Current version 1.0.0",
    );

    await changeLanguage("zh-Hant");
    expect(t("settings.general.currentVersion", { version: "1.0.0" })).toBe("目前版本 1.0.0");

    await changeLanguage("ja");
    expect(t("settings.general.currentVersion", { version: "1.0.0" })).toBe(
      "現在のバージョン: 1.0.0",
    );
  });

  it("translates plugin items and tags properly", async () => {
    await changeLanguage("en");
    expect(t("settings.plugins.items.markdown.math.name")).toBe("LaTeX Math Formulas");
    expect(t("settings.plugins.items.markdown.highlight.name")).toBe("Text Highlight");
    expect(t("settings.plugins.items.markdown.mermaid.name")).toBe("Mermaid Diagrams");
    expect(t("settings.plugins.items.markdown.directive.name")).toBe(
      "Container Directives (Admonition)",
    );
    expect(t("settings.plugins.tags.katex")).toBe("KaTeX");
    expect(t("settings.plugins.tags.wysiwyg")).toBe("WYSIWYG");
    expect(t("settings.plugins.tags.mathTypesetting")).toBe("Math Typesetting");

    await changeLanguage("zh");
    expect(t("settings.plugins.items.markdown.math.name")).toBe("LaTeX 数学公式");
    expect(t("settings.plugins.items.markdown.highlight.name")).toBe("文本高亮");
    expect(t("settings.plugins.items.markdown.mermaid.name")).toBe("Mermaid 图表");
    expect(t("settings.plugins.items.markdown.directive.name")).toBe("容器指令 (Admonition)");
    expect(t("settings.plugins.tags.katex")).toBe("KaTeX");
    expect(t("settings.plugins.tags.wysiwyg")).toBe("所见即所得");
    expect(t("settings.plugins.tags.mathTypesetting")).toBe("数学排版");

    await changeLanguage("zh-Hant");
    expect(t("settings.plugins.items.markdown.math.name")).toBe("LaTeX 數學公式");
    expect(t("settings.plugins.items.markdown.highlight.name")).toBe("文字醒目標記");
    expect(t("settings.plugins.items.markdown.mermaid.name")).toBe("Mermaid 圖表");
    expect(t("settings.plugins.items.markdown.directive.name")).toBe("容器指令 (Admonition)");

    await changeLanguage("ja");
    expect(t("settings.plugins.items.markdown.math.name")).toBe("LaTeX 数式");
    expect(t("settings.plugins.items.markdown.highlight.name")).toBe("テキストハイライト");
    expect(t("settings.plugins.items.markdown.mermaid.name")).toBe("Mermaid 図表");
    expect(t("settings.plugins.items.markdown.directive.name")).toBe("コンテナ記法 (Admonition)");
  });
});
