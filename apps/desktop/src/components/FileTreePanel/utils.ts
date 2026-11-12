import type { MarkdownFileTreeNode } from "@md-editor/file-system";
import type { SearchResultNode } from "./types";

export function normalizeSearchQuery(query: string): string {
  return query.trim().toLowerCase();
}

export function collectSearchResults(
  root: MarkdownFileTreeNode,
  normalizedQuery: string,
): readonly SearchResultNode[] {
  const results: SearchResultNode[] = [];

  const visit = (node: MarkdownFileTreeNode) => {
    if (isSearchResultNode(node)) {
      const haystack = `${node.name}\n${node.path}`.toLowerCase();
      if (haystack.includes(normalizedQuery)) {
        results.push(node);
      }
      return;
    }
    node.children?.forEach(visit);
  };

  visit(root);
  return results;
}

export function isSearchResultNode(node: MarkdownFileTreeNode): node is SearchResultNode {
  return node.kind === "markdown" || node.kind === "asset";
}
