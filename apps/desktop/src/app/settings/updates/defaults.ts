/**
 * @fileoverview 默认在线更新配置
 */

import type { AppUpdateSettings } from "./types.ts";

/**
 * 默认更新检查设置
 */
export const DEFAULT_UPDATE_SETTINGS: AppUpdateSettings = {
  automaticCheck: true,
  automaticDownload: true,
};
