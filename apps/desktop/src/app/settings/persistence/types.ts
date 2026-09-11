/**
 * @fileoverview 应用程序全局设置模型定义
 */

import type { AiSettings } from "@md-editor/ai";
import type { LanguageSetting } from "@md-editor/i18n";
import type { EditorDisplaySettings, PluginSettings } from "../editor/types.ts";
import type { ShortcutSetting } from "../shortcuts/types.ts";
import type { AppThemeSettings } from "../theme/types.ts";
import type { AppUpdateSettings } from "../updates/types.ts";

/**
 * 客户端全局应用设置完整对象
 */
export interface AppSettings {
  /** 快捷键自定义绑定列表 */
  readonly shortcuts: readonly ShortcutSetting[];
  /** 图片资产相对保存目录 */
  readonly assetsDirectory: string;
  /** 编辑器显示偏好 */
  readonly editor: EditorDisplaySettings;
  /** 主题外观偏好 */
  readonly theme: AppThemeSettings;
  /** AI 助写与端侧小模型偏好 */
  readonly ai: AiSettings;
  /** 在线自动更新偏好 */
  readonly update: AppUpdateSettings;
  /** 语法扩展插件开关偏好 */
  readonly plugins: PluginSettings;
  /** 界面本土化语言 */
  readonly language: LanguageSetting;
}
