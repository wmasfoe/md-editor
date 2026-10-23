/**
 * @fileoverview 对外链接的唯一来源
 *
 * 关于窗口、设置页与更新提示都从这里取地址：域名或仓库迁移时只改一处，
 * 避免「四个文件各写一份 https://editor.jiaqi.im」。
 */

/** 官方站点 */
export const APP_WEBSITE_URL = "https://editor.jiaqi.im";

/** 更新日志（官网，与客户端共用同一份 CHANGELOG 事实源） */
export const APP_CHANGELOG_URL = `${APP_WEBSITE_URL}/changelog`;

/** 源码仓库 */
export const APP_REPOSITORY_URL = "https://github.com/wmasfoe/md-editor";

/** GitHub Releases 页面：notes 只有中文时的英文兜底入口 */
export const APP_RELEASES_URL = `${APP_REPOSITORY_URL}/releases`;

/** 许可证全文 */
export const APP_LICENSE_URL = `${APP_REPOSITORY_URL}/blob/main/LICENSE`;
