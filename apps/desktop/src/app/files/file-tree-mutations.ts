import type { FileTreeMutationResult, MarkdownFileTreeNode } from "@md-editor/file-system";
import { isSameOrChildPath } from "../../lib/path";

export type OpenDocumentMutation =
  | {
      readonly kind: "none";
    }
  | {
      readonly kind: "move";
      readonly filePath: string;
    }
  | {
      readonly kind: "close";
    };

export function findFirstMarkdownPath(node: MarkdownFileTreeNode): string | null {
  let currentLevel: readonly MarkdownFileTreeNode[] = [node];

  while (currentLevel.length > 0) {
    for (const candidate of currentLevel) {
      if (candidate.kind === "markdown") {
        return candidate.path;
      }
    }

    currentLevel = currentLevel.flatMap((candidate) =>
      candidate.kind === "directory" ? candidate.children ?? [] : []
    );
  }

  return null;
}

export function resolveOpenDocumentMutation(
  currentFilePath: string | null,
  result: FileTreeMutationResult,
  previousPath?: string
): OpenDocumentMutation {
  if (!currentFilePath || !previousPath || !isSameOrChildPath(currentFilePath, previousPath)) {
    return { kind: "none" };
  }

  if (!result.affectedPath) {
    return { kind: "close" };
  }

  // Rename returns the new root path for the changed item. If the open document
  // is inside that renamed folder, preserve its relative suffix.
  const filePath =
    currentFilePath === previousPath
      ? result.affectedPath
      : `${result.affectedPath}${currentFilePath.slice(previousPath.length)}`;

  return { kind: "move", filePath };
}
