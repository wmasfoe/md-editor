/**
 * @fileoverview 默认在线更新配置与发布地址常量
 */

import { APP_REPOSITORY_URL } from "../../../lib/app-links.ts";
import type { AppUpdateSettings } from "./types.ts";

const GITHUB_REPO_PATH = APP_REPOSITORY_URL.replace("https://github.com/", "");
export const UPDATE_RELEASES_API_URL = `https://api.github.com/repos/${GITHUB_REPO_PATH}/releases?per_page=10`;

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
