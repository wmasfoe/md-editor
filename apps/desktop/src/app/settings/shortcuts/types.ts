/**
 * @fileoverview 快捷键设置类型定义
 */

/**
 * 单条自定义快捷键配置
 */
export interface ShortcutSetting {
  /** 快捷键项唯一 ID (例如 "editor.find") */
  readonly id: string;
  /** 触发的命令 ID */
  readonly commandId: string;
  /** 人类可读标签名称 */
  readonly label: string;
  /** 默认快捷键字符串表示 (例如 "Mod-F") */
  readonly defaultKey: string;
  /** 用户当前配置的快捷键字符串 (例如 "Mod-F") */
  readonly key: string;
}
