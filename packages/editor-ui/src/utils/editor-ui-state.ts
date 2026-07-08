import type { EditorMode } from "@md-editor/editor-core";
import type { EditorScrollTarget } from "../types";

export interface PendingModeScrollTarget {
  readonly mode: EditorMode;
  readonly target: EditorScrollTarget;
}

export function createEditorDocumentKey(filePath: string | null | undefined, revision: number): string {
  return `${filePath ?? "untitled"}:${Math.max(0, Math.trunc(revision))}`;
}

export function clampEditorScrollRatio(ratio: number): number | null {
  if (!Number.isFinite(ratio)) {
    return null;
  }

  return Math.min(Math.max(ratio, 0), 1);
}

export function createModeScrollTarget(
  mode: EditorMode,
  ratio: number,
  nonce = Date.now()
): PendingModeScrollTarget | null {
  const clampedRatio = clampEditorScrollRatio(ratio);
  if (clampedRatio === null) {
    return null;
  }

  return {
    mode,
    target: {
      ratio: clampedRatio,
      nonce
    }
  };
}
