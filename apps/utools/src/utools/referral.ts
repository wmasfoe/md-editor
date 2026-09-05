// apps/utools/src/utools/referral.ts
// 官网与原生桌面端导流模块

import { OFFICIAL_SITE_URL } from "@md-editor/shared";

/** 官网基础 URL（统一收敛自 @md-editor/shared 常量） */
export const OFFICIAL_SITE_BASE_URL = OFFICIAL_SITE_URL;

export type ReferralSource =
  "top_banner" | "compact_header" | "status_bar" | "settings" | "ai_disclaimer" | "detach_notice";

/**
 * 构建携带 UTM 溯源参数的官网跳转链接
 */
export function buildReferralUrl(source: ReferralSource): string {
  const url = new URL(OFFICIAL_SITE_BASE_URL);
  url.searchParams.set("utm_source", "utools");
  url.searchParams.set("utm_medium", "plugin");
  url.searchParams.set("utm_campaign", source);
  return url.toString();
}

/**
 * 引导用户前往官网下载完整原生桌面端
 * 优先调用 uTools 系统外部浏览器打开 API，若在开发或纯 Web 模式下则降级使用 window.open
 */
export function openOfficialSite(source: ReferralSource = "top_banner"): void {
  const targetUrl = buildReferralUrl(source);
  if (typeof window !== "undefined" && typeof window.utools !== "undefined") {
    window.utools.shellOpenExternal(targetUrl);
  } else if (typeof window !== "undefined") {
    window.open(targetUrl, "_blank", "noopener,noreferrer");
  }
}
