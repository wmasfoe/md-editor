/**
 * @fileoverview 错误上报默认配置
 */

import type { ErrorReportingSettings } from "./types.ts";

/**
 * 默认错误上报设置：关闭，需用户主动开启
 */
export const DEFAULT_ERROR_REPORTING_SETTINGS: ErrorReportingSettings = {
  enabled: false,
};
