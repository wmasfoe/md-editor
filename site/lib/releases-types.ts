/**
 * @file releases-types.ts
 * @module site/lib/releases-types
 * @description
 * 客户端与服务端共享的 Releases 数据模型与前端直链格式化工具。
 * 纯逻辑与类型定义，不依赖任何 Node.js 原生模块（如 node:fs），可安全用于客户端组件。
 */

export interface ReleaseAsset {
  platform: string;
  platformLabel: string;
  fileName: string;
  downloadUrl: string;
  sizeBytes?: number;
  formattedSize?: string;
  isR2Cached?: boolean;
}

export interface VersionRelease {
  version: string;
  tagName: string;
  publishedAt: string;
  isLatest: boolean;
  isPrerelease: boolean;
  category: "desktop" | "android";
  releaseNotesUrl?: string;
  assets: ReleaseAsset[];
}

export interface ReleasesData {
  app: string;
  updatedAt: string;
  total: number;
  latestDesktopVersion: string;
  latestAndroidVersion: string;
  releases: VersionRelease[];
}

/**
 * 根据当前域名动态格式化下载链接，使下载直链与当前访问域名（例如 download.jiaqi.im 或 download.justdev.cn）保持一致
 */
export function formatDownloadUrlWithDomain(url: string, domain?: string): string {
  if (!domain || !url.startsWith("http")) return url;
  try {
    const parsed = new URL(url);
    parsed.host = domain;
    return parsed.toString();
  } catch {
    return url;
  }
}
