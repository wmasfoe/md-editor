/**
 * @fileoverview 文件树视图状态工具库
 *
 * 提供文件树目录折叠/展开的默认状态计算、祖先路径解析、首个 Markdown 文件发现
 * 以及基于 localStorage 的持久化状态读写逻辑，供 Web、Desktop、uTools 等各端统一复用。
 */

import type { MarkdownFileTreeNode } from "./index.ts";

const COLLAPSED_PATHS_STORAGE_PREFIX = "md-editor:file-tree:collapsed:";

/**
 * 规范化提取路径的父目录路径
 */
export function getDirectoryPath(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/");
  return index <= 0 ? "." : normalized.slice(0, index);
}

/**
 * 判断目标路径是否与父路径相同，或者是其子孙路径
 */
export function isSameOrChildPath(path: string, parentPath: string): boolean {
  const normalizedPath = path.replace(/\\/g, "/");
  const normalizedParent = parentPath.replace(/\\/g, "/").replace(/\/$/u, "");
  return normalizedPath === normalizedParent || normalizedPath.startsWith(`${normalizedParent}/`);
}

/**
 * 广度优先层级遍历查找文件树中的第一个 Markdown 文件路径
 */
export function findFirstMarkdownPath(node: MarkdownFileTreeNode): string | null {
  let currentLevel: readonly MarkdownFileTreeNode[] = [node];

  while (currentLevel.length > 0) {
    for (const candidate of currentLevel) {
      if (candidate.kind === "markdown") {
        return candidate.path;
      }
    }

    currentLevel = currentLevel.flatMap((candidate) =>
      candidate.kind === "directory" ? (candidate.children ?? []) : [],
    );
  }

  return null;
}

/**
 * 遍历指定节点下的所有目录节点
 */
export function visitDirectoryNodes(
  node: MarkdownFileTreeNode,
  visit: (node: MarkdownFileTreeNode) => void,
): void {
  if (node.kind !== "directory") {
    return;
  }

  visit(node);
  for (const child of node.children ?? []) {
    visitDirectoryNodes(child, visit);
  }
}

/**
 * 收集从目标文件逐级向上至工作区根目录的所有祖先目录路径
 */
export function collectAncestorDirectoryPaths(
  rootPath: string,
  filePath: string | null,
): ReadonlySet<string> {
  const paths = new Set<string>([rootPath]);
  if (!filePath) {
    return paths;
  }

  let current = getDirectoryPath(filePath);
  while (isSameOrChildPath(current, rootPath)) {
    paths.add(current);
    if (current === rootPath) {
      break;
    }
    const parent = getDirectoryPath(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  return paths;
}

/**
 * 计算默认折叠的目录路径集合：
 * 1. 保留根目录展开；
 * 2. 保留当前可见/活跃文件（visibleFilePath）的所有祖先目录展开；
 * 3. 其余所有非祖先子目录均默认折叠。
 */
export function createDefaultCollapsedDirectoryPaths(
  root: MarkdownFileTreeNode,
  visibleFilePath: string | null,
): ReadonlySet<string> {
  const expandedDirectoryPaths = collectAncestorDirectoryPaths(root.path, visibleFilePath);
  const collapsedPaths = new Set<string>();

  visitDirectoryNodes(root, (node) => {
    if (node.path !== root.path && !expandedDirectoryPaths.has(node.path)) {
      collapsedPaths.add(node.path);
    }
  });

  return collapsedPaths;
}

/**
 * 根据工作区根目录路径生成 localStorage 存储键名
 */
export function storageKeyForRoot(rootPath: string): string {
  return `${COLLAPSED_PATHS_STORAGE_PREFIX}${encodeURIComponent(rootPath)}`;
}

/**
 * 从 localStorage 读取已记忆的文件树折叠路径集合
 */
export function readCollapsedPaths(rootPath: string): ReadonlySet<string> | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) {
      return null;
    }
    const raw = window.localStorage.getItem(storageKeyForRoot(rootPath));
    if (!raw) {
      return null;
    }
    const paths = JSON.parse(raw);
    return new Set(Array.isArray(paths) ? paths.filter((p) => typeof p === "string") : []);
  } catch {
    // 损坏的本地存储不应阻塞用户正常编辑流程
    return null;
  }
}

/**
 * 将用户自定义的文件树折叠路径集合写入 localStorage 进行状态记忆
 */
export function writeCollapsedPaths(rootPath: string, collapsedPaths: ReadonlySet<string>): void {
  try {
    if (typeof window === "undefined" || !window.localStorage) {
      return;
    }
    const key = storageKeyForRoot(rootPath);
    if (collapsedPaths.size === 0) {
      window.localStorage.removeItem(key);
      return;
    }

    window.localStorage.setItem(key, JSON.stringify([...collapsedPaths]));
  } catch {
    // 忽略配额满或隐私模式失败，不中断内存树运行
  }
}
