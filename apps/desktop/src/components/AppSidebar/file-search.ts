import type { MarkdownFileTreeNode } from "@md-editor/file-system";

/**
 * 递归计算文件夹文件树中与搜索查询词匹配的文件数量。
 *
 * @param root 当前目录节点树，为 null 时直接返回 0
 * @param query 搜索关键词（按文件名和路径做不区分大小写的包含匹配）
 * @returns 匹配的文件总数
 */
export function countMatchedFiles(root: MarkdownFileTreeNode | null, query: string): number {
  const normalizedQuery = normalizeSearchQuery(query);
  if (!root || !normalizedQuery) {
    return 0;
  }

  let count = 0;
  const visit = (node: MarkdownFileTreeNode) => {
    if (node.kind !== "directory") {
      const haystack = `${node.name}\n${node.path}`.toLowerCase();
      if (haystack.includes(normalizedQuery)) {
        count += 1;
      }
      return;
    }
    node.children?.forEach(visit);
  };

  visit(root);
  return count;
}

/**
 * 规范化搜索查询字符串（去除前后空格并转为小写）。
 */
export function normalizeSearchQuery(query: string): string {
  return query.trim().toLowerCase();
}
