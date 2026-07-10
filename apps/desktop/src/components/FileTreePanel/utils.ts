import type { MarkdownFileTreeNode } from "@md-editor/file-system";
import type { SearchResultNode } from "./types";

const COLLAPSED_PATHS_STORAGE_PREFIX = "md-editor:file-tree:collapsed:";

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

export function relativePathFromRoot(rootPath: string, path: string): string {
  const normalizedRoot = rootPath.replace(/\\/g, "/").replace(/\/$/u, "");
  const normalizedPath = path.replace(/\\/g, "/");
  return normalizedPath.startsWith(`${normalizedRoot}/`)
    ? normalizedPath.slice(normalizedRoot.length + 1)
    : normalizedPath;
}

export function storageKeyForRoot(rootPath: string): string {
  return `${COLLAPSED_PATHS_STORAGE_PREFIX}${encodeURIComponent(rootPath)}`;
}

export function readCollapsedPaths(rootPath: string): ReadonlySet<string> | null {
  try {
    const raw = window.localStorage.getItem(storageKeyForRoot(rootPath));
    if (!raw) {
      return null;
    }
    const paths = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(paths) ? paths.filter((path) => typeof path === "string") : []);
  } catch {
    // Persisted tree state is a convenience only; broken storage should not block authoring.
    return null;
  }
}

export function writeCollapsedPaths(rootPath: string, collapsedPaths: ReadonlySet<string>) {
  try {
    const key = storageKeyForRoot(rootPath);
    if (collapsedPaths.size === 0) {
      window.localStorage.removeItem(key);
      return;
    }

    window.localStorage.setItem(key, JSON.stringify([...collapsedPaths]));
  } catch {
    // Ignore quota/private-mode failures and keep the in-memory tree usable.
  }
}

export function isPathInsideRoot(path: string, rootPath: string): boolean {
  return path === rootPath || path.startsWith(`${rootPath}/`);
}
