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

// monorepo 根优先；site 目录内副本次之（预留给打包工具只带 site 子树的场景）。
const defaultChangelogCandidates = [
  path.join(process.cwd(), "..", "CHANGELOG.md"),
  path.join(process.cwd(), "CHANGELOG.md"),
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

export function parseChangelog(markdown: string): ChangelogEntry[] {
  const lines = markdown.split(/\r?\n/u);
  const entries: ChangelogEntry[] = [];
  let current: ChangelogEntry | null = null;
  let itemStack: { indent: number; item: ChangelogItem }[] = [];

  for (const line of lines) {
    // 官网只消费根 CHANGELOG.md 的二级版本标题，匹配版本、日期及可选 PR 编号。
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

export function getChangelogEntries(filePath?: string): ChangelogEntry[] {
  const resolved = resolveChangelogPath(filePath);
  if (!resolved) {
    return [];
  }

  return parseChangelog(fs.readFileSync(resolved, "utf8"));
}

function resolveChangelogPath(filePath?: string): string | null {
  if (filePath) {
    return fs.existsSync(filePath) ? filePath : null;
  }

  return defaultChangelogCandidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}
