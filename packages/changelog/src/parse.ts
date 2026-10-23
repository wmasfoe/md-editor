/**
 * @fileoverview CHANGELOG Markdown 解析
 *
 * 纯函数、零 Node 依赖：官网在构建期读取文件，桌面端解析 updater manifest 的 notes，
 * 两侧都走这一份实现，避免出现两套「更新内容」语义。
 */

import type { ChangelogEntry, ChangelogItem } from "./types.ts";

/**
 * 从文本中提取所有合法的正整数 PR 编号。
 * 支持形如 "(#49)"、"(PR #49)"、"(#48, #49)" 或纯数组等。
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
 *
 * - 版本标题：`## 0.10.1 - 2026-09-10 (#56, #57)`（日期与 PR 均可缺省）
 * - 列表项：`-` / `*`，按缩进解析多级嵌套
 * - 没有任何列表项的区块会被丢弃（例如 `## Draft` 占位）
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
      // 标题可能写成 `## v0.16.0`；归一化后渲染层统一加 `v`，不会出现 `vv0.16.0`。
      const version = heading[1].trim().replace(/^v/iu, "");
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
 * 按版本号查找条目：忽略大小写与 `v` 前缀，未命中返回 null。
 * 桌面端用它把「最新版本」映射到当次更新的日志区块。
 */
export function findChangelogEntry(
  entries: readonly ChangelogEntry[],
  version: string,
): ChangelogEntry | null {
  const normalized = version.trim().replace(/^v/iu, "");
  if (!normalized) {
    return null;
  }
  return entries.find((entry) => entry.version === normalized) ?? null;
}
