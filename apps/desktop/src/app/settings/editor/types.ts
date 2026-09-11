/**
 * @fileoverview 编辑器显示偏好与插件设置类型定义
 */

/**
 * 编辑器排版与显示外观偏好
 */
export interface EditorDisplaySettings {
  /** 是否在代码块中显示行号 */
  readonly showCodeBlockLineNumbers: boolean;
  /** 所见即所得编辑区的正文字号 (px, 范围 13~22) */
  readonly wysiwygFontSize: number;
  /** 正文字体族栈 key 或自定义字体名 */
  readonly proseFontFamily: string;
  /** 等宽代码字体族栈 key 或自定义字体名 */
  readonly codeFontFamily: string;
}

/**
 * 语法插件启用/禁用偏好
 */
export interface PluginSettings {
  /** 插件 ID 到是否启用的布尔映射 */
  readonly enabled: Readonly<Record<string, boolean>>;
}
