import fs from "node:fs";
import path from "node:path";

export interface ChangelogEntry {
  version: string;
  date: string;
  items: string[];
}

const changelogPath = path.join(process.cwd(), "..", "CHANGELOG.md");

export function parseChangelog(markdown: string): ChangelogEntry[] {
  const lines = markdown.split(/\r?\n/u);
  const entries: ChangelogEntry[] = [];
  let current: ChangelogEntry | null = null;

  for (const line of lines) {
    // 官网只消费根 CHANGELOG.md 的二级版本标题，避免引入第二套站点专用 changelog 数据源。
    const heading = line.match(/^##\s+(.+?)(?:\s+-\s+(.+))?$/u);
    if (heading) {
      current = {
        version: heading[1].trim(),
        date: heading[2]?.trim() ?? "",
        items: []
      };
      entries.push(current);
      continue;
    }

    const item = line.match(/^\s*[-*]\s+(.+)$/u);
    if (item && current) {
      current.items.push(item[1].trim());
    }
  }

  return entries.filter((entry) => entry.version && entry.items.length > 0);
}

export function getChangelogEntries(filePath = changelogPath): ChangelogEntry[] {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  return parseChangelog(fs.readFileSync(filePath, "utf8"));
}
