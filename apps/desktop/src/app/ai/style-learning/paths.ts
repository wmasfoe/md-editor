/**
 * @file paths.ts
 * @description 风格学习使用的工作区相对路径工具（以 `/` 分隔）。
 */

/** 计算文件在工作区内的相对路径；不在工作区内时返回 null */
export function workspaceRelativePath(rootPath: string, filePath: string): string | null {
  const root = rootPath.replaceAll("\\", "/").replace(/\/+$/u, "");
  const normalized = filePath.replaceAll("\\", "/");
  const prefix = `${root}/`;
  return normalized.startsWith(prefix) ? normalized.slice(prefix.length) : null;
}
