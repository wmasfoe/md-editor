/**
 * @fileoverview 错误上报偏好设置类型定义
 */

/**
 * 匿名错误上报与崩溃日志偏好
 */
export interface ErrorReportingSettings {
  /** 是否启用匿名错误上报（默认关闭，需用户主动开启） */
  readonly enabled: boolean;
}
