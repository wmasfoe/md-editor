/**
 * @file config.ts
 * @description 分发 Worker 的应用与平台常量（自 router.ts 拆出，行为不变）。
 */

export const SUPPORTED_APPS = [
  {
    name: "inkpoint",
    title: "Inkpoint",
    description: "下一代跨平台 Markdown 知识管理与富文本编辑器",
  },
];

export const KNOWN_PLATFORM_CATEGORIES = new Set(["android", "ios", "desktop", "mobile"]);

/**
 * 移动端已停止发版，最后发布的版本固定在这里。
 * 只在 R2 清单缺失时作为兜底；清单存在时以清单为准。
 */
export const PUBLISHED_ANDROID_VERSION = "0.2.1";
