/**
 * @fileoverview 默认在线更新配置与发布地址常量
 */

import type { AppUpdateSettings } from "./types.ts";

export const UPDATE_RELEASES_API_URL =
  "https://api.github.com/repos/wmasfoe/md-editor/releases?per_page=10";
/** 官网更新日志：与客户端更新提示共用同一份 CHANGELOG 事实源 */
export const UPDATE_CHANGELOG_URL = "https://editor.jiaqi.im/changelog";
/** GitHub Releases 页面：notes 只有中文时的英文兜底入口 */
export const UPDATE_RELEASES_PAGE_URL = "https://github.com/wmasfoe/md-editor/releases";
export const INSTALL_WITH_CURL_COMMAND =
  "curl -fsSL https://download.jiaqi.im/inkpoint/desktop/install.sh | bash";
export const INSTALL_WITH_POWERSHELL_COMMAND =
  "irm https://download.jiaqi.im/inkpoint/desktop/install.ps1 | iex";

/**
 * 默认更新检查设置
 */
export const DEFAULT_UPDATE_SETTINGS: AppUpdateSettings = {
  automaticCheck: true,
  automaticDownload: true,
};
