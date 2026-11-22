/**
 * @file types.ts
 * @description 公开主题契约。
 *
 * 形状与业界收敛：Monaco 的 `base + colors`、本仓 `app-ui` 的
 * `baseTheme + per-scheme overrides` 是同一模型。这里取"预设 base + 分组语义覆盖"，
 * 因为它同时满足两件事：
 * - 零配置可用（`theme={{ base: "dark" }}`）；
 * - 语义槽可枚举（`colors.textColor` 而不是 `--theme-text`），且编译后落到
 *   既有的 `--theme-*` 变量基座上，宿主仍可直接写 CSS 覆盖。
 *
 * 不做的事：不定义调色板、不内置预设值。预设属于应用层（`app-ui` 保持私有）。
 */

/** 语义配色槽。每个槽编译到一组 `--theme-*` 变量（含派生色）。 */
export interface EditorThemeColors {
  /** 画布/表面底色 → `--theme-bg`、`--theme-surface` */
  readonly canvasBg?: string;
  /** 外壳/侧栏底色 → `--theme-chrome`、`--theme-bg-muted` */
  readonly chromeBg?: string;
  /** 正文文字 → `--theme-text` */
  readonly textColor?: string;
  /** 标题文字 → `--theme-title` */
  readonly titleColor?: string;
  /** 品牌与聚焦强调色 → `--theme-primary` 及派生变量 */
  readonly primaryColor?: string;
  /** 代码块底色 → `--theme-code-bg` */
  readonly codeBg?: string;
  /** 行内代码底色 → `--theme-inline-code-bg` */
  readonly inlineCodeBg?: string;
  /** 边框 → `--theme-border` */
  readonly borderColor?: string;
}

/** 排版槽。这些能力此前散落在 9 个 React props 上。 */
export interface EditorThemeTypography {
  /** 正文/界面字体族 → `--theme-font` */
  readonly proseFontFamily?: string;
  /** 等宽/代码字体族 → `--theme-mono-font` */
  readonly codeFontFamily?: string;
  /** 标题字体族 → `--theme-heading-font` */
  readonly headingFontFamily?: string;
  /** 正文字号（px）→ `--theme-editor-font-size` */
  readonly fontSize?: number;
  /** 行高（无单位）→ `--theme-editor-line-height` */
  readonly lineHeight?: number;
  /** 字符间距 → `--theme-letter-spacing` */
  readonly letterSpacing?: string;
  /** `**bold**` 字重 → `--theme-bold-font-weight` */
  readonly boldFontWeight?: number;
  /** 标题字重 → `--theme-heading-font-weight` */
  readonly headingFontWeight?: number;
}

/** 几何槽。 */
export interface EditorThemeGeometry {
  /** 版心最大宽度 → `--theme-content-width`（数字按 px） */
  readonly contentMaxWidth?: number | string;
}

export interface EditorTheme {
  /**
   * 明暗基底。它不是一套配色，只用于让宿主/宿主 CSS 知道当前基底
   * （React 层会映射为 `color-scheme`）；具体颜色仍由配色槽与 `--theme-*` 决定。
   */
  readonly base?: "light" | "dark";
  readonly colors?: EditorThemeColors;
  readonly typography?: EditorThemeTypography;
  readonly geometry?: EditorThemeGeometry;
}
