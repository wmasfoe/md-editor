/**
 * @fileoverview 三层层叠样式编译器与主题包序列化 (Style Compiler)
 *
 * 合成优先级：
 * [Layer 1: 基础主题 Base Theme]
 *       ⬇ 覆盖合并
 * [Layer 2: 结构化可视化覆盖 Structured Overrides (配色分槽 + 字体排版全局共享)]
 *       ⬇ 追加注入
 * [Layer 3: 用户增量自定义 CSS Incremental Custom CSS]
 */

import { builtInThemeCss } from "./built-in-themes";
import type { ThemeCustomizationSettings, ThemePackage } from "./theme-schema";

export interface CompileThemeCssOptions extends ThemeCustomizationSettings {
  /** 额外的自定义 CSS 片段 (如用户通过自定义 CSS 文件或文本区提供的代码) */
  readonly customCssText?: string;
  /** 当前需要生成的色彩方案 */
  readonly colorScheme?: "light" | "dark";
}

/**
 * 编译并生成最终注入 DOM 的完整 CSS 代码
 */
export function compileThemeCss(options: CompileThemeCssOptions): string {
  const baseCss = builtInThemeCss(options.baseTheme);
  const colorScheme =
    options.colorScheme ?? (baseCss.includes("color-scheme: dark;") ? "dark" : "light");
  const colorOverrides = colorScheme === "dark" ? options.darkOverrides : options.lightOverrides;

  const overridesTokens: string[] = [];

  // 1. 结构化配色 Token 派生
  if (colorOverrides) {
    if (colorOverrides.canvasBg) {
      overridesTokens.push(`  --theme-bg: ${colorOverrides.canvasBg};`);
      overridesTokens.push(`  --theme-surface: ${colorOverrides.canvasBg};`);
    }
    if (colorOverrides.chromeBg) {
      overridesTokens.push(`  --theme-chrome: ${colorOverrides.chromeBg};`);
      overridesTokens.push(`  --theme-bg-muted: ${colorOverrides.chromeBg};`);
    }
    if (colorOverrides.textColor) {
      overridesTokens.push(`  --theme-text: ${colorOverrides.textColor};`);
    }
    if (colorOverrides.titleColor) {
      overridesTokens.push(`  --theme-title: ${colorOverrides.titleColor};`);
    }
    if (colorOverrides.primaryColor) {
      overridesTokens.push(`  --theme-primary: ${colorOverrides.primaryColor};`);
      overridesTokens.push(`  --theme-primary-fill: ${colorOverrides.primaryColor};`);
      overridesTokens.push(
        `  --theme-primary-soft: color-mix(in srgb, ${colorOverrides.primaryColor} 12%, transparent);`,
      );
      overridesTokens.push(
        `  --theme-primary-selected: color-mix(in srgb, ${colorOverrides.primaryColor} 26%, transparent);`,
      );
      overridesTokens.push(
        `  --theme-control-hover: color-mix(in srgb, ${colorOverrides.primaryColor} 8%, transparent);`,
      );
    }
    if (colorOverrides.codeBg) {
      overridesTokens.push(`  --theme-code-bg: ${colorOverrides.codeBg};`);
    }
    if (colorOverrides.inlineCodeBg) {
      overridesTokens.push(`  --theme-inline-code-bg: ${colorOverrides.inlineCodeBg};`);
    }
    if (colorOverrides.borderColor) {
      overridesTokens.push(`  --theme-border: ${colorOverrides.borderColor};`);
    }
  }

  // 2. 结构化排版与字体 Token 派生
  const typo = options.typographyOverrides;
  if (typo) {
    if (typo.uiFontFamily) {
      overridesTokens.push(`  --theme-ui-font: ${typo.uiFontFamily};`);
    }
    if (typo.proseFontFamily) {
      overridesTokens.push(`  --theme-font: ${typo.proseFontFamily};`);
    }
    if (typo.headingFontFamily) {
      overridesTokens.push(`  --theme-heading-font: ${typo.headingFontFamily};`);
    }
    if (typo.codeFontFamily) {
      overridesTokens.push(`  --theme-mono-font: ${typo.codeFontFamily};`);
    }
    if (typo.fontSize && Number.isFinite(typo.fontSize) && typo.fontSize > 0) {
      overridesTokens.push(`  --theme-editor-font-size: ${typo.fontSize}px;`);
    }
    if (typo.sourceFontSize && Number.isFinite(typo.sourceFontSize) && typo.sourceFontSize > 0) {
      overridesTokens.push(`  --theme-source-font-size: ${typo.sourceFontSize}px;`);
    }
    if (typo.lineHeight && Number.isFinite(typo.lineHeight) && typo.lineHeight > 0) {
      overridesTokens.push(`  --theme-editor-line-height: ${typo.lineHeight};`);
      overridesTokens.push(`  --theme-editor-line-height-em: ${typo.lineHeight}em;`);
    }
    if (typo.letterSpacing !== undefined) {
      overridesTokens.push(`  --theme-letter-spacing: ${typo.letterSpacing};`);
    }
    if (typo.paragraphSpacing) {
      overridesTokens.push(`  --theme-editor-paragraph-spacing: ${typo.paragraphSpacing};`);
    }
    if (typo.bodyFontWeight) {
      overridesTokens.push(`  --theme-body-font-weight: ${typo.bodyFontWeight};`);
    }
    if (typo.headingFontWeight) {
      overridesTokens.push(`  --theme-heading-font-weight: ${typo.headingFontWeight};`);
    }
    if (typo.boldFontWeight) {
      overridesTokens.push(`  --theme-bold-font-weight: ${typo.boldFontWeight};`);
    }
  }

  // 3. 结构化几何与块级变体 Token 派生
  const geo = options.geometryOverrides;
  if (geo) {
    if (geo.contentMaxWidth !== undefined) {
      const widthVal =
        typeof geo.contentMaxWidth === "number" ? `${geo.contentMaxWidth}px` : geo.contentMaxWidth;
      overridesTokens.push(`  --theme-content-width: ${widthVal};`);
    }
    if (geo.borderRadiusPreset) {
      const r =
        geo.borderRadiusPreset === "sharp"
          ? "3px"
          : geo.borderRadiusPreset === "soft"
            ? "12px"
            : "6px";
      overridesTokens.push(`  --theme-radius-base: ${r};`);
    }
    if (geo.headingDividerStyle) {
      overridesTokens.push(
        `  --theme-heading-divider: ${geo.headingDividerStyle === "none" ? "none" : "block"};`,
      );
    }
    if (geo.blockquoteStyle) {
      if (geo.blockquoteStyle === "borderless") {
        overridesTokens.push("  --theme-blockquote-border: none;");
        overridesTokens.push("  --theme-blockquote-bg: transparent;");
      } else if (geo.blockquoteStyle === "card") {
        overridesTokens.push("  --theme-blockquote-border: 1px solid var(--theme-border);");
        overridesTokens.push("  --theme-blockquote-bg: var(--theme-bg-muted);");
      }
    }
    if (geo.codeBlockStyle) {
      if (geo.codeBlockStyle === "clean") {
        overridesTokens.push("  --theme-code-border: transparent;");
      }
    }
  }

  const generatedOverridesCss =
    overridesTokens.length > 0 ? `\n:root {\n${overridesTokens.join("\n")}\n}\n` : "";

  // 4. 用户增量自定义 CSS (隔离并安全防闭合转义)
  const userCustomCss = sanitizeCustomCss(colorOverrides?.customCss ?? options.customCssText ?? "");

  return `${baseCss.trim()}\n${generatedOverridesCss}${userCustomCss ? `\n/* User Custom CSS */\n${userCustomCss}\n` : ""}`;
}

/**
 * 将结构化主题包导出为格式化 JSON 字符串
 */
export function exportThemePackage(pkg: ThemePackage): string {
  return JSON.stringify(pkg, null, 2);
}

/**
 * 校验并导入主题包 JSON 字符串
 */
export function importThemePackage(
  jsonText: string,
):
  | { readonly ok: true; readonly package: ThemePackage }
  | { readonly ok: false; readonly error: string } {
  try {
    const raw = JSON.parse(jsonText);
    if (typeof raw !== "object" || raw === null) {
      return { ok: false, error: "主题包必须是有效的 JSON 对象。" };
    }
    if (raw.schemaVersion !== 1) {
      return { ok: false, error: `不支持的主题包版本: ${raw.schemaVersion}` };
    }
    if (typeof raw.id !== "string" || !raw.id.trim()) {
      return { ok: false, error: "主题包缺少有效的 id 字段。" };
    }
    if (typeof raw.name !== "string" || !raw.name.trim()) {
      return { ok: false, error: "主题包缺少有效的 name 字段。" };
    }
    if (typeof raw.baseTheme !== "string") {
      return { ok: false, error: "主题包缺少有效的 baseTheme 基础主题字段。" };
    }

    const pkg: ThemePackage = {
      schemaVersion: 1,
      id: raw.id.trim(),
      name: raw.name.trim(),
      author: typeof raw.author === "string" ? raw.author.trim() : undefined,
      description: typeof raw.description === "string" ? raw.description.trim() : undefined,
      baseTheme: raw.baseTheme,
      lightOverrides:
        typeof raw.lightOverrides === "object" && raw.lightOverrides
          ? raw.lightOverrides
          : undefined,
      darkOverrides:
        typeof raw.darkOverrides === "object" && raw.darkOverrides ? raw.darkOverrides : undefined,
      typographyOverrides:
        typeof raw.typographyOverrides === "object" && raw.typographyOverrides
          ? raw.typographyOverrides
          : undefined,
      geometryOverrides:
        typeof raw.geometryOverrides === "object" && raw.geometryOverrides
          ? raw.geometryOverrides
          : undefined,
    };

    return { ok: true, package: pkg };
  } catch (error) {
    return {
      ok: false,
      error: `JSON 解析失败: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function sanitizeCustomCss(css: string): string {
  // 转义针对 </style> 标签注入的潜在破坏
  return css.replace(/<\/style/gi, "<\\/style").trim();
}
