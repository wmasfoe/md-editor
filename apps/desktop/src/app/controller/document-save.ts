/** Desktop save adapter and presentation of the platform-independent result. */
import type { DocumentSavePort, SaveOutcome, SettleSaveResult } from "@md-editor/core";
import { FileSaveInvariantError, type RuntimeFileService } from "@md-editor/file-system";
import { t } from "@md-editor/i18n";

export function createDesktopSavePort(
  fileService: Pick<RuntimeFileService, "enqueueSaveJob">,
): DocumentSavePort {
  return (checkpoint) => {
    try {
      return fileService.enqueueSaveJob({
        jobId: checkpoint.id,
        checkpointSequence: checkpoint.sequence,
        documentGeneration: checkpoint.documentGeneration,
        markdownLf: checkpoint.markdownLf,
        destination: checkpoint.destination,
      });
    } catch (error) {
      // These scheduler checks run before a FIFO slot is acquired or any native write begins.
      // Unknown adapter errors still belong to core's conservative indeterminate fallback.
      if (!(error instanceof FileSaveInvariantError)) throw error;
      return {
        status: "failed",
        commit: "not-committed",
        phase: "validation",
        errorCode: error.code,
      };
    }
  };
}

/**
 * 将保存结果转化为国际化 Toast 提示文案。
 *
 * @param outcome 底层落盘裁决
 * @param settlement 状态机结算结果
 * @returns 提示文案，若无需提示则返回 null
 */
export function getSaveFeedback(outcome: SaveOutcome, settlement: SettleSaveResult): string | null {
  if (outcome.status === "cancelled" || outcome.status === "superseded-before-commit") {
    return null;
  }
  if (outcome.status === "indeterminate") {
    return t("toasts.saveUncertain");
  }
  if (outcome.status === "failed") {
    return t("toasts.saveFailed", { error: outcome.errorCode });
  }
  if (settlement.status !== "applied" && settlement.status !== "promoted") {
    return null;
  }

  const warning = outcome.warnings.map((entry) => entry.message).join("；");
  return warning ? t("toasts.saveWarning", { warning }) : null;
}
