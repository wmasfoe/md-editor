/**
 * @fileoverview 更新偏好的规范化与客户端版本读取
 */

import { DEFAULT_UPDATE_SETTINGS } from "./defaults.ts";
import type { AppUpdateSettings } from "./types.ts";

declare const __APP_VERSION__: string;

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null;
}

/**
 * 获取当前编译嵌入的客户端版本号
 */
export function appVersion(): string {
  return __APP_VERSION__;
}

/**
 * 规范化更新偏好设置对象：自动下载依赖自动检测，关闭检测时下载一并关闭。
 */
export function normalizeUpdateSettings(input: unknown): AppUpdateSettings {
  if (!isRecord(input)) {
    return DEFAULT_UPDATE_SETTINGS;
  }

  const automaticCheck =
    input.automaticCheck === undefined
      ? DEFAULT_UPDATE_SETTINGS.automaticCheck
      : input.automaticCheck === true;
  const automaticDownload = automaticCheck
    ? input.automaticDownload === undefined
      ? DEFAULT_UPDATE_SETTINGS.automaticDownload
      : input.automaticDownload === true
    : false;

  return {
    automaticCheck,
    automaticDownload,
  };
}
