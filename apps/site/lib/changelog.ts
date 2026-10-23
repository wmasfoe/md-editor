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
 * 获取 Desktop 桌面客户端的更新日志列表。
 */
export function getDesktopChangelogEntries(
  locale: Locale = "zh",
  filePath?: string,
): ChangelogEntry[] {
  const isEn = locale === "en" || locale === "ja";
  const candidates = isEn ? defaultDesktopEnChangelogCandidates : defaultDesktopChangelogCandidates;
  const resolved = resolveChangelogPath(filePath, candidates);
  if (!resolved) {
    if (isEn) {
      return getDesktopChangelogEntries("zh", filePath);
    }
    return [];
  }
  return parseChangelog(fs.readFileSync(resolved, "utf8"));
}

/**
 * 获取 Web 在线版的更新日志列表。
 */
export function getWebChangelogEntries(locale: Locale = "zh", filePath?: string): ChangelogEntry[] {
  const isEn = locale === "en" || locale === "ja";
  const candidates = isEn ? defaultWebEnChangelogCandidates : defaultWebChangelogCandidates;
  const resolved = resolveChangelogPath(filePath, candidates);
  if (!resolved) {
    if (isEn) {
      return getWebChangelogEntries("zh", filePath);
    }
    return [];
  }
  return parseChangelog(fs.readFileSync(resolved, "utf8"));
}

/**
 * 获取 Android 移动端的更新日志列表。
 */
export function getAndroidChangelogEntries(
  locale: Locale = "zh",
  filePath?: string,
): ChangelogEntry[] {
  const isEn = locale === "en" || locale === "ja";
  const candidates = isEn ? defaultAndroidEnChangelogCandidates : defaultAndroidChangelogCandidates;
  const resolved = resolveChangelogPath(filePath, candidates);
  if (!resolved) {
    if (isEn) {
      return getAndroidChangelogEntries("zh", filePath);
    }
    return [];
  }
  return parseChangelog(fs.readFileSync(resolved, "utf8"));
}

/**
 * 获取 iOS 移动端的更新日志列表。
 */
export function getIosChangelogEntries(locale: Locale = "zh", filePath?: string): ChangelogEntry[] {
  const isEn = locale === "en" || locale === "ja";
  const candidates = isEn ? defaultIosEnChangelogCandidates : defaultIosChangelogCandidates;
  const resolved = resolveChangelogPath(filePath, candidates);
  if (!resolved) {
    if (isEn) {
      return getIosChangelogEntries("zh", filePath);
    }
    return [];
  }
  return parseChangelog(fs.readFileSync(resolved, "utf8"));
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
