/**
 * @fileoverview 把更新状态里的 `releaseNotes` 转成与官网一致的更新日志条目
 *
 * notes 有两个来源：
 * 1. R2 `updater.json.notes`：由发版链路写入的 CHANGELOG 版本区块（带 `## <version>` 标题）；
 * 2. GitHub Releases 回退路径：可能是没有版本标题的扁平正文。
 *
 * 两种来源都归一成 `ChangelogEntry`，渲染层只认这一种结构。
 */

import {
  findChangelogEntry,
  parseChangelog,
  type ChangelogEntry,
  type ChangelogItem,
} from "@md-editor/changelog";
import type { UpdateStatus } from "../settings/app-settings";
import { normalizeVersion } from "./prompt-state";

/** 占位文案：旧版 manifest / Release 模板产物，展示出来只是噪音。 */
const PLACEHOLDER_PATTERNS: readonly RegExp[] = [
  /^inkpoint\s+v?\d[\w.+-]*$/iu,
  /^multi-platform release for\b/iu,
];

/** 判断 notes 是否只是占位内容（空串、版本号回显、旧 Release 模板）。 */
export function isPlaceholderReleaseNotes(text: string): boolean {
  const normalized = text.trim();
  if (normalized === "") {
    return true;
  }
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(normalized));
}

/**
 * 读取本次更新对应的日志条目。
 * 优先按 `latestVersion` 命中版本区块；命中不到时退化为整个 notes，再进行扁平正文兜底。
 */
export function readReleaseNotesEntry(status: UpdateStatus): ChangelogEntry | null {
  const notes = status.releaseNotes?.trim();
  if (!notes || isPlaceholderReleaseNotes(notes)) {
    return null;
  }

  const version = normalizeVersion(status.latestVersion) ?? "";
  const entries = parseChangelog(notes);
  if (entries.length > 0) {
    const matched = version ? findChangelogEntry(entries, version) : null;
    if (matched) {
      return matched;
    }
    // 发版管道可能把版本号写错；降级展示首条，但要留下可定位的证据。
    console.warn(
      `更新日志未包含版本 ${version || "(unknown)"}，已降级展示首条 ${entries[0].version}。`,
    );
    return entries[0];
  }

  const items = toFallbackItems(notes);
  if (items.length === 0) {
    return null;
  }

  return { version, date: "", items };
}

/**
 * 扁平正文兜底：旧版 GitHub Release body 没有版本标题，只有列表。
 * 只收列表行——引导句（"What's new:"）与 HTML 片段都不是条目；
 * 一条列表行都没有时返回空，交给「本次更新没有附带更新日志」。
 */
function toFallbackItems(notes: string): ChangelogItem[] {
  return notes
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+\S/u.test(line))
    .map((line) => line.replace(/^[-*]\s+/u, "").trim())
    .map((text) => ({ text }));
}
