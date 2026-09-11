/**
 * @file document-save.ts
 * @module apps/desktop/app/controller/document-save
 * @description
 * 桌面端文档落盘保存流程适配器。
 *
 * 紧密衔接 `@md-editor/editor-core` 的状态机检查点机制与 `@md-editor/file-system` 的 FIFO 排队调度器：
 * 1. 同步生成不可逆检查点（`beginSave`）；
 * 2. 立即将任务推入调度器排队（`enqueueSaveJob`），锁定序号与队列顺位；
 * 3. 异步等待保存裁决结果并回调结算状态机（`settleSave`）；
 * 4. 转换结构化保存结果为人类可读的 Toast 提示。
 */

import type {
  DocumentSaveCheckpoint,
  DocumentSnapshot,
  DocumentState,
  SaveOutcome,
  SettleSaveResult,
} from "@md-editor/editor-core";
import type { RuntimeFileService } from "@md-editor/file-system";
import { t } from "@md-editor/i18n";

/**
 * 单次文档保存流水线的完整执行上下文与裁决结果。
 */
export interface DocumentSaveExecution {
  /** 本次保存生成的锁定检查点 */
  readonly checkpoint: DocumentSaveCheckpoint;
  /** 保存前的文件路径（用于判断是否为另存为并触发目录树刷新） */
  readonly previousPath: string | null;
  /** 文件系统调度器返回的底层落盘结果 */
  readonly outcome: SaveOutcome;
  /** 文档核心状态机对结果的处理结算状态（applied / promoted / rejected / stale） */
  readonly settlement: SettleSaveResult;
}

/**
 * 驱动单个文档执行完整的落盘生命周期。
 *
 * @param document 编辑器文档状态机实例
 * @param fileService 提供 enqueueSaveJob 的文件服务
 * @param forceDialog 是否强制弹出“另存为”对话框
 * @returns 冻结的保存执行结果上下文
 */
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

  // enqueueSaveJob 同步锁定 FIFO 队列顺位与运行时序号。
  // 必须紧跟在 beginSave 之后调用，严禁在两者之间插入任何 await。
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

/**
 * 判断当前文档快照是否需要防丢拦截保护（脏修改未保存或未决状态）。
 *
 * @param snapshot 文档快照
 */
export function isDiscardProtectionRequired(snapshot: DocumentSnapshot): boolean {
  return snapshot.isDirty || snapshot.persistenceStatus.kind === "verification-required";
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
  return warning ? t("toasts.saveWarning", { warning }) : t("toasts.saved");
}
