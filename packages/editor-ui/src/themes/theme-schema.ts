/**
 * @fileoverview 主题结构模型、Token 契约与自定义排版覆盖类型 (Theme Schema)
 */

export type BuiltInThemeId =
  | "paper-light"
  | "kami-light"
  | "github-light"
  | "gothic-light"
  | "charcoal-dark"
  | "kami-dark"
  | "night-dark";

export interface BuiltInThemeOption {
  readonly id: BuiltInThemeId;
  readonly label: string;
}

/** 色彩明暗模式 */
export type ThemeColorScheme = "system" | "light" | "dark";

/**
 * 结构化明暗配色覆盖项 (Per-Scheme)
 */
export interface ColorSchemeOverrides {
  /** 画布与表面底色 (映射到 --theme-bg, --theme-surface) */
  readonly canvasBg?: string;
  /** 外壳与侧栏底色 (映射到 --theme-chrome, --theme-bg-muted) */
  readonly chromeBg?: string;
  /** 主正文文字颜色 (映射到 --theme-text) */
  readonly textColor?: string;
  /** 标题颜色 (映射到 --theme-title) */
  readonly titleColor?: string;
  /** 品牌与聚焦强调色 (映射到 --theme-primary 及派生变量) */
  readonly primaryColor?: string;
  /** 代码块底色 (映射到 --theme-code-bg) */
  readonly codeBg?: string;
  /** 行内代码底色 (映射到 --theme-inline-code-bg) */
  readonly inlineCodeBg?: string;
  /** 边框颜色 (映射到 --theme-border) */
  readonly borderColor?: string;
  /** 该色彩模式下的增量自定义 CSS 代码 */
  readonly customCss?: string;
}

/**
 * 全局共享字体与排版覆盖项 (Shared across Light/Dark)
 */
export interface TypographyOverrides {
  /** 界面外壳字体族 (映射到 --theme-ui-font) */
  readonly uiFontFamily?: string;
  /** 编辑器正文字体族 (映射到 --theme-font) */
  readonly proseFontFamily?: string;
  /** 标题独立字体族 (映射到 --theme-heading-font，留空跟随正文) */
  readonly headingFontFamily?: string;
  /** 等宽代码字体族 (映射到 --theme-mono-font) */
  readonly codeFontFamily?: string;
  /** 所见即所得正文字号 (px，默认 13~24) */
  readonly fontSize?: number;
  /** 源码模式字号 (px，留空跟随正文字号) */
  readonly sourceFontSize?: number;
  /** 正文阅读行高 (如 1.35 ~ 2.10) */
  readonly lineHeight?: number;
  /** 字符间距 (如 "0.02em" 或 "0.35px") */
  readonly letterSpacing?: string;
  /** 段落间距 (em，如 0.6 ~ 1.5) */
  readonly paragraphSpacing?: string;
  /** 正文字重 (如 400) */
  readonly bodyFontWeight?: number;
  /** 标题字重 (如 500) */
  readonly headingFontWeight?: number;
  /** 粗体标记 **bold** 字重 (如 500 或 700，解除 700 !important 限制) */
  readonly boldFontWeight?: number;
}

/**
 * 全局共享几何与块级视觉样式覆盖项 (Shared across Light/Dark)
 */
export interface GeometryOverrides {
  /** 编辑画布最大版心宽度 (px，如 820) */
  readonly contentMaxWidth?: number | string;
  /** UI 与组件圆角风格 */
  readonly borderRadiusPreset?: "sharp" | "standard" | "soft";
  /** 一级标题底部分隔线风格 */
  readonly headingDividerStyle?: "none" | "line";
  /** 引用块视觉风格 */
  readonly blockquoteStyle?: "borderless" | "classic" | "card";
  /** 代码块边框与卡片风格 */
  readonly codeBlockStyle?: "clean" | "bordered";
}

/**
 * 完整主题定制数据模型
 */
export interface ThemeCustomizationSettings {
  /** 当前激活的基础主题 ID */
  readonly baseTheme: BuiltInThemeId;
  /** 浅色方案专用配色微调 */
  readonly lightOverrides?: ColorSchemeOverrides;
  /** 深色方案专用配色微调 */
  readonly darkOverrides?: ColorSchemeOverrides;
  /** 全局共享排版配置 */
  readonly typographyOverrides?: TypographyOverrides;
  /** 全局共享几何与块样式配置 */
  readonly geometryOverrides?: GeometryOverrides;
}

/**
 * 版本化可导入导出主题包格式 (JSON Theme Package)
 */
export interface ThemePackage {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly name: string;
  readonly author?: string;
  readonly description?: string;
  readonly baseTheme: BuiltInThemeId;
  readonly lightOverrides?: ColorSchemeOverrides;
  readonly darkOverrides?: ColorSchemeOverrides;
  readonly typographyOverrides?: TypographyOverrides;
  readonly geometryOverrides?: GeometryOverrides;
}
