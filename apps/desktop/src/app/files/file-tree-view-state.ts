import type { MarkdownFileTreeNode } from "@md-editor/file-system";
import { dirname, isSameOrChildPath } from "../../lib/path";

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

function collectAncestorDirectoryPaths(
  rootPath: string,
  filePath: string | null,
): ReadonlySet<string> {
  const paths = new Set<string>([rootPath]);
  if (!filePath) {
    return paths;
  }

  let current = dirname(filePath);
  while (isSameOrChildPath(current, rootPath)) {
    paths.add(current);
    if (current === rootPath) {
      break;
    }
    current = dirname(current);
  }

  return paths;
}

function visitDirectoryNodes(
  node: MarkdownFileTreeNode,
  visit: (node: MarkdownFileTreeNode) => void,
) {
  if (node.kind !== "directory") {
    return;
  }

  visit(node);
  for (const child of node.children ?? []) {
    visitDirectoryNodes(child, visit);
  }
}
