/**
 * @file changelog.ts
 * @module site/lib/changelog
 * @description
 * 官网更新日志加载模块：负责在构建期按平台与语言定位 CHANGELOG 文件。
 *
 * 解析与数据模型由 `@md-editor/changelog` 提供，与桌面端共用同一份实现；
 * 本模块只保留 Node fs 相关的读取与路径候选逻辑。
 */

import fs from "node:fs";
import path from "node:path";
import { parseChangelog, type ChangelogEntry } from "@md-editor/changelog";
import type { Locale } from "./i18n/types";

/**
 * 仓库根候选：生产环境（Vercel）与 `pnpm --filter @md-editor/site` 的 cwd 为 `apps/site`，
 * 但本地 vitest 的 cwd 可能是仓库根或 `apps/`。逐个尝试，避免把解析绑死在单一 cwd 假设上。
 */
const repoRootCandidates = [
  path.resolve(process.cwd(), "..", ".."),
  path.resolve(process.cwd(), ".."),
  process.cwd(),
];

/** 在仓库根候选下展开同一相对路径的候选列表。 */
function repoCandidates(...segments: string[]): string[] {
  return repoRootCandidates.map((root) => path.join(root, ...segments));
}

const defaultDesktopChangelogCandidates = repoCandidates("apps", "desktop", "CHANGELOG.md");

const defaultDesktopEnChangelogCandidates = repoCandidates("apps", "desktop", "CHANGELOG_EN.md");

const defaultWebChangelogCandidates = repoCandidates("apps", "web", "CHANGELOG.md");

const defaultWebEnChangelogCandidates = repoCandidates("apps", "web", "CHANGELOG_EN.md");

const defaultAndroidChangelogCandidates = repoCandidates(
  "apps",
  "mobile",
  "android",
  "CHANGELOG.md",
);

const defaultAndroidEnChangelogCandidates = repoCandidates(
  "apps",
  "mobile",
  "android",
  "CHANGELOG_EN.md",
);

const defaultIosChangelogCandidates = repoCandidates("apps", "mobile", "ios", "CHANGELOG.md");

const defaultIosEnChangelogCandidates = repoCandidates("apps", "mobile", "ios", "CHANGELOG_EN.md");

/**
 * 读取指定平台的更新日志。
 *
 * 四个平台（Desktop / Web / Android / iOS）只有候选文件不同，读取与回退规则完全一致：
 * 英文缺失时回退中文，两者都缺失时返回空数组（官网页面显示空状态，而不是抛错）。
 */
function readChangelogEntries(
  locale: Locale,
  zhCandidates: string[],
  enCandidates: string[],
  filePath: string | undefined,
  isEnglish: (locale: Locale) => boolean,
): ChangelogEntry[] {
  const wantsEnglish = isEnglish(locale);
  const resolved = resolveChangelogPath(filePath, wantsEnglish ? enCandidates : zhCandidates);
  if (!resolved) {
    return wantsEnglish
      ? readChangelogEntries("zh", zhCandidates, enCandidates, filePath, isEnglish)
      : [];
  }
  return parseChangelog(fs.readFileSync(resolved, "utf8"));
}

/** ja 与 en 共用英文日志：仓库里没有日文 CHANGELOG。 */
function prefersEnglishChangelog(locale: Locale): boolean {
  return locale === "en" || locale === "ja";
}

/** 获取 Desktop 桌面客户端的更新日志列表。 */
export function getDesktopChangelogEntries(
  locale: Locale = "zh",
  filePath?: string,
): ChangelogEntry[] {
  return readChangelogEntries(
    locale,
    defaultDesktopChangelogCandidates,
    defaultDesktopEnChangelogCandidates,
    filePath,
    prefersEnglishChangelog,
  );
}

/** 获取 Web 在线版的更新日志列表。 */
export function getWebChangelogEntries(locale: Locale = "zh", filePath?: string): ChangelogEntry[] {
  return readChangelogEntries(
    locale,
    defaultWebChangelogCandidates,
    defaultWebEnChangelogCandidates,
    filePath,
    prefersEnglishChangelog,
  );
}

/** 获取 Android 移动端的更新日志列表。 */
export function getAndroidChangelogEntries(
  locale: Locale = "zh",
  filePath?: string,
): ChangelogEntry[] {
  return readChangelogEntries(
    locale,
    defaultAndroidChangelogCandidates,
    defaultAndroidEnChangelogCandidates,
    filePath,
    prefersEnglishChangelog,
  );
}

/** 获取 iOS 移动端的更新日志列表。 */
export function getIosChangelogEntries(locale: Locale = "zh", filePath?: string): ChangelogEntry[] {
  return readChangelogEntries(
    locale,
    defaultIosChangelogCandidates,
    defaultIosEnChangelogCandidates,
    filePath,
    prefersEnglishChangelog,
  );
}

/**
 * 获取当前最新的 iOS 版本号。
 * 优先从 iOS 更新日志首条提取，兜底解析 Xcode 工程里的 MARKETING_VERSION。
 */
export function getLatestIosVersion(): string {
  const entries = getIosChangelogEntries("zh");
  if (entries.length > 0 && entries[0].version) {
    return entries[0].version;
  }
  const projectCandidates = repoCandidates(
    "apps",
    "mobile",
    "ios",
    "Inkpoint.xcodeproj",
    "project.pbxproj",
  );
  for (const candidate of projectCandidates) {
    if (fs.existsSync(candidate)) {
      const match = fs.readFileSync(candidate, "utf8").match(/MARKETING_VERSION\s*=\s*([^;]+);/);
      if (match?.[1]) {
        return match[1].trim();
      }
    }
  }
  return "0.1.0";
}

/**
 * 获取当前最新的 Android 版本号。
 * 优先从 Android 更新日志首条提取，兜底解析 build.gradle.kts 或回退 0.1.1。
 */
export function getLatestAndroidVersion(): string {
  const entries = getAndroidChangelogEntries("zh");
  if (entries.length > 0 && entries[0].version) {
    return entries[0].version;
  }
  const gradleCandidates = repoCandidates("apps", "mobile", "android", "app", "build.gradle.kts");
  for (const candidate of gradleCandidates) {
    if (fs.existsSync(candidate)) {
      const match = fs.readFileSync(candidate, "utf8").match(/versionName\s*=\s*"([^"]+)"/);
      if (match?.[1]) {
        return match[1];
      }
    }
  }
  return "0.1.1";
}

/**
 * 默认更新日志获取函数（对齐 Desktop 客户端日志）。
 */
export function getChangelogEntries(filePath?: string): ChangelogEntry[] {
  return getDesktopChangelogEntries("zh", filePath);
}

function resolveChangelogPath(filePath: string | undefined, candidates: string[]): string | null {
  if (filePath) {
    return fs.existsSync(filePath) ? filePath : null;
  }

  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}
