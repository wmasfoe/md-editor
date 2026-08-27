import type {
  DocumentSaveCheckpoint,
  DocumentSnapshot,
  DocumentState,
  SaveOutcome,
  SettleSaveResult,
} from "@md-editor/editor-core";
import type { RuntimeFileService } from "@md-editor/file-system";

export interface DocumentSaveExecution {
  readonly checkpoint: DocumentSaveCheckpoint;
  readonly previousPath: string | null;
  readonly outcome: SaveOutcome;
  readonly settlement: SettleSaveResult;
}

export async function executeDocumentSave(
  document: DocumentState,
  fileService: Pick<RuntimeFileService, "enqueueSaveJob">,
  forceDialog: boolean,
): Promise<DocumentSaveExecution> {
  const current = document.getSnapshot();
  const destination =
    forceDialog || !current.filePath
      ? ({
          kind: "prompt" as const,
          ...(current.filePath ? { suggestedPath: current.filePath } : {}),
        } as const)
      : ({ kind: "current-path" as const, path: current.filePath } as const);
  const checkpoint = document.beginSave(destination);

  // enqueueSaveJob reserves FIFO position and runtime sequence synchronously.
  // Keep this call adjacent to beginSave and before the first await.
  let outcomePromise: Promise<SaveOutcome>;
  try {
    outcomePromise = fileService.enqueueSaveJob({
      jobId: checkpoint.id,
      checkpointSequence: checkpoint.sequence,
      documentGeneration: checkpoint.documentGeneration,
      markdownLf: checkpoint.markdownLf,
      destination: checkpoint.destination,
    });
  } catch (error) {
    outcomePromise = Promise.resolve({
      status: "failed",
      commit: "not-committed",
      phase: "validation",
      errorCode: error instanceof Error ? error.message : "save-enqueue-failed",
    });
  }

  const outcome = await outcomePromise;
  const settlement = document.settleSave(checkpoint, outcome);
  return Object.freeze({ checkpoint, previousPath: current.filePath, outcome, settlement });
}

export function isDiscardProtectionRequired(snapshot: DocumentSnapshot): boolean {
  return snapshot.isDirty || snapshot.persistenceStatus.kind === "verification-required";
}

export function getSaveFeedback(outcome: SaveOutcome, settlement: SettleSaveResult): string | null {
  if (outcome.status === "cancelled" || outcome.status === "superseded-before-commit") {
    return null;
  }
  if (outcome.status === "indeterminate") {
    return "无法确认保存是否完成。请验证磁盘文件后再次保存。";
  }
  if (outcome.status === "failed") {
    return `保存失败：${outcome.errorCode}`;
  }
  if (settlement.status !== "applied" && settlement.status !== "promoted") {
    return null;
  }

  const warning = outcome.warnings.map((entry) => entry.message).join("；");
  return warning ? `已保存。附加操作警告：${warning}` : "已保存。";
}
