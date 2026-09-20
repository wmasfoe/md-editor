/**
 * @fileoverview 错误上报设置规范化
 */

import { DEFAULT_ERROR_REPORTING_SETTINGS } from "./defaults.ts";
import type { ErrorReportingSettings } from "./types.ts";

/**
 * 规范化错误上报设置对象，补全缺失字段并修正类型
 */
export function normalizeErrorReportingSettings(input: unknown): ErrorReportingSettings {
  if (typeof input !== "object" || input === null) {
    return DEFAULT_ERROR_REPORTING_SETTINGS;
  }

  const record = input as Record<string, unknown>;
  // 字段缺失时沿用默认值（开启），仅在用户显式传入 false 时关闭
  return {
    enabled:
      record.enabled === undefined
        ? DEFAULT_ERROR_REPORTING_SETTINGS.enabled
        : record.enabled === true,
  };
}
