/**
 * @fileoverview 错误上报默认配置
 */

import type { ErrorReportingSettings } from "./types.ts";

/**
 * 默认错误上报设置：默认开启，用户可在设置中关闭
 */
export const DEFAULT_ERROR_REPORTING_SETTINGS: ErrorReportingSettings = {
  enabled: true,
};
