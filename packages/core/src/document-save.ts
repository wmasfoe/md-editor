import type { DocumentState } from "./types/document.ts";
import type { DocumentSnapshot } from "./types/snapshot.ts";
import type { DocumentSaveCheckpoint, SaveOutcome, SettleSaveResult } from "./types/save.ts";

/** The host writes the exact checkpoint and reports what it knows about the commit. */
export type DocumentSavePort = (
  checkpoint: DocumentSaveCheckpoint,
) => SaveOutcome | Promise<SaveOutcome>;

export interface DocumentSaveExecution {
  readonly checkpoint: DocumentSaveCheckpoint;
  readonly previousPath: string | null;
  readonly outcome: SaveOutcome;
  readonly settlement: SettleSaveResult;
}

/** Platform-independent save lifecycle; native ordering remains owned by the injected port. */
export async function executeDocumentSave(
  document: DocumentState,
  save: DocumentSavePort,
  forceDialog = false,
): Promise<DocumentSaveExecution> {
  const current = document.getSnapshot();
  const destination =
    forceDialog || !current.filePath
      ? {
          kind: "prompt" as const,
          ...(current.filePath ? { suggestedPath: current.filePath } : {}),
        }
      : { kind: "current-path" as const, path: current.filePath };
  const checkpoint = document.beginSave(destination);
  let outcome: SaveOutcome;
  try {
    // Invoke before the first await: native adapters must synchronously acquire their FIFO slot.
    outcome = await save(checkpoint);
  } catch (error) {
    // An unclassified transport exception cannot prove that the write did not commit.
    outcome = {
      status: "indeterminate",
      commit: "unknown",
      verificationRequired: true,
      ...(destination.kind === "current-path" ? { candidatePath: destination.path } : {}),
      errorCode: error instanceof Error ? error.message : String(error),
    };
  }
  const settlement = document.settleSave(checkpoint, outcome);
  return Object.freeze({ checkpoint, previousPath: current.filePath, outcome, settlement });
}

export function isDiscardProtectionRequired(snapshot: DocumentSnapshot): boolean {
  return snapshot.isDirty || snapshot.persistenceStatus.kind === "verification-required";
}
