import { describe, expect, it } from "vitest";
import { changeLanguage, getCurrentLocale, resolveActiveLocale, t } from "../src";
import { en } from "../src/locales/en";
import { zh } from "../src/locales/zh";

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
  it("should have identical key paths between zh and en translations (Key Parity)", () => {
    const zhPaths = getObjectPaths(zh).toSorted();
    const enPaths = getObjectPaths(en).toSorted();

    expect(zhPaths).toEqual(enPaths);
  });

  it("should resolve active locale properly", () => {
    expect(resolveActiveLocale("zh")).toBe("zh");
    expect(resolveActiveLocale("en")).toBe("en");
    expect(resolveActiveLocale("invalid")).toBe("zh");
    // "system" will resolve to zh or en depending on environment
    const systemLocale = resolveActiveLocale("system");
    expect(["zh", "en"]).toContain(systemLocale);
  });

  it("should change language and translate keys correctly", async () => {
    await changeLanguage("zh");
    expect(getCurrentLocale()).toBe("zh");
    expect(t("common.save")).toBe("保存");
    expect(t("settings.title")).toBe("设置");

    await changeLanguage("en");
    expect(getCurrentLocale()).toBe("en");
    expect(t("common.save")).toBe("Save");
    expect(t("settings.title")).toBe("Settings");
  });

  it("should support parameter interpolation", async () => {
    await changeLanguage("zh");
    expect(t("settings.general.currentVersion", { version: "1.0.0" })).toBe("当前版本 1.0.0");

    await changeLanguage("en");
    expect(t("settings.general.currentVersion", { version: "1.0.0" })).toBe(
      "Current version 1.0.0",
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
  });
});
