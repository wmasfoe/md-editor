/**
 * @fileoverview 主题设置模型与实时预览协议类型
 */

/**
 * 主题色彩模式
 * - `system`: 跟随操作系统深浅色
 * - `light`: 强制浅色
 * - `dark`: 强制深色
 */
export type ThemeColorScheme = "system" | "light" | "dark";

/**
 * 主题样式来源：内置预设或用户自定义 CSS
 */
export type ThemeSourceType = "builtin" | "custom";

/**
 * 内置预设主题标识
 */
export type BuiltInThemeId =
  "github-light" | "gothic-light" | "night-dark" | "paper-light" | "charcoal-dark";

/**
 * 单一色彩方案（浅色或深色）下的具体主题配置
 */
export interface ThemeSchemeSettings {
  readonly source: ThemeSourceType;
  readonly builtinTheme: BuiltInThemeId;
  readonly customCssPath: string | null;
}

/**
 * 应用程序主题整体配置
 */
export interface AppThemeSettings {
  readonly mode: ThemeColorScheme;
  readonly light: ThemeSchemeSettings;
  readonly dark: ThemeSchemeSettings;
}

/**
 * 跨窗口主题实时预览事件载荷
 */
export interface AppThemePreviewEvent {
  readonly sessionId: string;
  readonly sequence: number;
  readonly theme: AppThemeSettings | null;
}

/**
 * 主题实时预览发布会话契约
 */
export interface AppThemePreviewSession {
  readonly sessionId: string;
  readonly publish: (theme: AppThemeSettings | null) => Promise<void>;
}

/**
 * 主题实时预览跨窗口协调器
 */
export interface AppThemePreviewCoordinator {
  readonly handle: (event: AppThemePreviewEvent) => Promise<void>;
  readonly dispose: () => void;
}
