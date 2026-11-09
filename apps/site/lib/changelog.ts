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
 * CHANGELOG 的候选路径。
 *
 * 必须是**静态字面量**：Next/Turbopack 的 output file tracing 会对 `path.join(cwd, ...segments)`
 * 这类动态拼接做保守展开，把整个仓库（数万个文件）trace 进 server function，
 * 既拖慢构建、也会让部署产物超限。这里改成逐条写死的路径，tracing 只会命中这几个文件。
 *
 * cwd 差异（Vercel 为 apps/site，本地 vitest 可能是仓库根或 apps/）用「先尝试再回退」覆盖，
 * 而不是用循环拼接动态生成路径。
 */
const CHANGELOG_FILES = {
  desktopZh: [
    path.resolve(process.cwd(), "../../apps/desktop/CHANGELOG.md"),
    path.resolve(process.cwd(), "../apps/desktop/CHANGELOG.md"),
    path.resolve(process.cwd(), "apps/desktop/CHANGELOG.md"),
  ],
  desktopEn: [
    path.resolve(process.cwd(), "../../apps/desktop/CHANGELOG_EN.md"),
    path.resolve(process.cwd(), "../apps/desktop/CHANGELOG_EN.md"),
    path.resolve(process.cwd(), "apps/desktop/CHANGELOG_EN.md"),
  ],
  webZh: [
    path.resolve(process.cwd(), "../../apps/web/CHANGELOG.md"),
    path.resolve(process.cwd(), "../apps/web/CHANGELOG.md"),
    path.resolve(process.cwd(), "apps/web/CHANGELOG.md"),
  ],
  webEn: [
    path.resolve(process.cwd(), "../../apps/web/CHANGELOG_EN.md"),
    path.resolve(process.cwd(), "../apps/web/CHANGELOG_EN.md"),
    path.resolve(process.cwd(), "apps/web/CHANGELOG_EN.md"),
  ],
} as const;

const defaultDesktopChangelogCandidates = [...CHANGELOG_FILES.desktopZh];
const defaultDesktopEnChangelogCandidates = [...CHANGELOG_FILES.desktopEn];
const defaultWebChangelogCandidates = [...CHANGELOG_FILES.webZh];
const defaultWebEnChangelogCandidates = [...CHANGELOG_FILES.webEn];

/**
 * 读取指定平台的更新日志。
 *
 * 两个平台（Desktop / Web）只有候选文件不同，读取与回退规则完全一致：
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
