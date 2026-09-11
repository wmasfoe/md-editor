/**
 * @fileoverview 默认在线更新配置与发布地址常量
 */

import type { AppUpdateSettings } from "./types.ts";

export const UPDATE_RELEASES_API_URL =
  "https://api.github.com/repos/wmasfoe/md-editor/releases?per_page=10";
export const INSTALL_WITH_CURL_COMMAND =
  "curl -fsSL https://raw.githubusercontent.com/wmasfoe/md-editor/main/install.sh | bash";
export const INSTALL_WITH_POWERSHELL_COMMAND =
  "irm https://raw.githubusercontent.com/wmasfoe/md-editor/main/install.ps1 | iex";

/**
 * 默认更新检查设置
 */
export const DEFAULT_UPDATE_SETTINGS: AppUpdateSettings = {
  automaticCheck: true,
  automaticDownload: true,
};
