/**
 * @file changelog.ts
 * @module site/lib/changelog
 * @description
 * 官网更新日志解析与加载模块。
 *
 * 支持分别读取并解析 Desktop 桌面客户端（apps/desktop/CHANGELOG.md 或根 CHANGELOG.md）
 * 与 Web 在线版（apps/web/CHANGELOG.md）的版本发布记录，支持嵌套列表项与关联 PR 提取。
 */

import fs from "node:fs";
import path from "node:path";

export interface ChangelogItem {
  text: string;
  items?: ChangelogItem[];
}

export interface ChangelogEntry {
  version: string;
  date: string;
  sourcePR?: number[];
  items: ChangelogItem[];
}

const defaultDesktopChangelogCandidates = [
  path.join(process.cwd(), "..", "apps", "desktop", "CHANGELOG.md"),
  path.join(process.cwd(), "apps", "desktop", "CHANGELOG.md"),
  path.join(process.cwd(), "..", "CHANGELOG.md"),
  path.join(process.cwd(), "CHANGELOG.md"),
];

const defaultDesktopEnChangelogCandidates = [
  path.join(process.cwd(), "..", "apps", "desktop", "CHANGELOG_EN.md"),
  path.join(process.cwd(), "apps", "desktop", "CHANGELOG_EN.md"),
  path.join(process.cwd(), "..", "CHANGELOG_EN.md"),
  path.join(process.cwd(), "CHANGELOG_EN.md"),
];

const defaultWebChangelogCandidates = [
  path.join(process.cwd(), "..", "apps", "web", "CHANGELOG.md"),
  path.join(process.cwd(), "apps", "web", "CHANGELOG.md"),
];

const defaultWebEnChangelogCandidates = [
  path.join(process.cwd(), "..", "apps", "web", "CHANGELOG_EN.md"),
  path.join(process.cwd(), "apps", "web", "CHANGELOG_EN.md"),
];

/**
 * 从文本中提取所有合法的正整数 PR 编号。
 * 支持形如 "(#49)", "(PR #49)", "(#48, #49)" 或纯数组等。
 */
export function extractPrNumbers(text?: string | null): number[] {
  if (!text) {
    return [];
  }
  const matches = text.match(/\b\d+\b/gu);
  if (!matches) {
    return [];
  }
  const numbers = matches
    .map((num) => Number.parseInt(num, 10))
    .filter((num) => Number.isInteger(num) && num > 0);
  return Array.from(new Set(numbers));
}

/**
 * 解析 Markdown 格式的 Changelog 文本，生成结构化版本条目集合。
 */
export function parseChangelog(markdown: string): ChangelogEntry[] {
  const lines = markdown.split(/\r?\n/u);
  const entries: ChangelogEntry[] = [];
  let current: ChangelogEntry | null = null;
  let itemStack: { indent: number; item: ChangelogItem }[] = [];

  for (const line of lines) {
    // 匹配二级版本标题：## 0.10.1 - 2026-09-10 (#56, #57)
    const heading = line.match(/^##\s+(\S+)(?:\s+-\s+([^\s(]+))?(?:\s+\(([^)]+)\))?\s*$/u);
    if (heading) {
      const version = heading[1].trim();
      const date = heading[2]?.trim() ?? "";
      const prText = heading[3]?.trim();
      const sourcePR = prText ? extractPrNumbers(prText) : [];

      current = {
        version,
        date,
        sourcePR: sourcePR.length > 0 ? sourcePR : undefined,
        items: [],
      };
      entries.push(current);
      itemStack = [];
      continue;
    }

    if (!current) {
      continue;
    }

    // 匹配列表项：支持 - 或 * 开头，支持缩进以解析多级嵌套列表
    const listItemMatch = line.match(/^(\s*)[-*]\s+(.+)$/u);
    if (listItemMatch) {
      const rawIndent = listItemMatch[1].replace(/\t/gu, "  ").length;
      const text = listItemMatch[2].trim();
      const newItem: ChangelogItem = { text };

      // 弹出栈中同级或更深层级的节点，恢复上一层父级上下文
      while (itemStack.length > 0 && itemStack[itemStack.length - 1].indent >= rawIndent) {
        itemStack.pop();
      }

      if (itemStack.length === 0) {
        // 顶级列表项
        current.items.push(newItem);
      } else {
        // 作为上一级父节点的子项
        const parent = itemStack[itemStack.length - 1].item;
        if (!parent.items) {
          parent.items = [];
        }
        parent.items.push(newItem);
      }

      itemStack.push({ indent: rawIndent, item: newItem });
    }
  }

  return entries.filter((entry) => entry.version && entry.items.length > 0);
}

/**
 * 获取 Desktop 桌面客户端的更新日志列表。
 */
export function getDesktopChangelogEntries(
  locale: "zh" | "en" = "zh",
  filePath?: string,
): ChangelogEntry[] {
  const candidates =
    locale === "en" ? defaultDesktopEnChangelogCandidates : defaultDesktopChangelogCandidates;
  const resolved = resolveChangelogPath(filePath, candidates);
  if (!resolved) {
    if (locale === "en") {
      return getDesktopChangelogEntries("zh", filePath);
    }
    return [];
  }
  return parseChangelog(fs.readFileSync(resolved, "utf8"));
}

/**
 * 获取 Web 在线版的更新日志列表。
 */
export function getWebChangelogEntries(
  locale: "zh" | "en" = "zh",
  filePath?: string,
): ChangelogEntry[] {
  const candidates =
    locale === "en" ? defaultWebEnChangelogCandidates : defaultWebChangelogCandidates;
  const resolved = resolveChangelogPath(filePath, candidates);
  if (!resolved) {
    if (locale === "en") {
      return getWebChangelogEntries("zh", filePath);
    }
    return [];
  }
  return parseChangelog(fs.readFileSync(resolved, "utf8"));
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
