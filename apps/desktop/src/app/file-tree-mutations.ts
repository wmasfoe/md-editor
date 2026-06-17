import type { FileTreeMutationResult } from "@md-editor/file-system";
import { isSameOrChildPath } from "../lib/path";

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
