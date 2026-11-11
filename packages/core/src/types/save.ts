/**
 * @fileoverview 文档保存检查点与结算协议模型
 *
 * 定义原生保存请求的目标路径 (SaveDestination)、不可变落盘检查点 (DocumentSaveCheckpoint)
 * 以及底层文件系统保存落盘后的结算结果 (SaveOutcome, SettleSaveResult)。
 */

import type { Markdown } from "@md-editor/shared";
import type { MutationBusyResult, MutationRejectedResult } from "./mutations.ts";

/**
 * 保存目标落盘目的地
 * - `current-path`: 写入已存在的当前文件路径
 * - `prompt`: 弹出系统原生另存为对话框，可携带推荐文件名或路径
 */
export type SaveDestination =
  | { readonly kind: "current-path"; readonly path: string }
  | { readonly kind: "prompt"; readonly suggestedPath?: string };

/**
 * 文档落盘检查点 (Save Checkpoint)
 * 记录发起保存瞬间的只读文本快照与时序标记
 */
export interface DocumentSaveCheckpoint {
  /** 检查点唯一 ID */
  readonly id: string;
  /** 单调递增保存请求序号 */
  readonly sequence: number;
  /** 发起保存时的文档代际 */
  readonly documentGeneration: number;
  /** 发起保存时的内容版本号 */
  readonly contentRevision: number;
  /** 统一采用 \n 换行的纯净 Markdown 文本内容 */
  readonly markdownLf: Markdown;
  /** 目标目的地 */
  readonly destination: SaveDestination;
}

/**
 * 保存过程中产生的非致命告警
 */
export interface SaveWarning {
  readonly code: "asset-directory-registration-failed";
  readonly message: string;
}

/**
 * 原生平台底层写入执行结果
 */
export type SaveOutcome =
  | {
      readonly status: "succeeded";
      readonly commit: "committed" | "committed-with-warning";
      readonly filePath: string;
      readonly warnings: readonly SaveWarning[];
    }
  | {
      readonly status: "failed";
      readonly commit: "not-committed";
      readonly phase: "validation" | "dialog" | "temp-write" | "temp-sync" | "rename";
      readonly errorCode: string;
    }
  | {
      readonly status: "cancelled";
      readonly commit: "not-committed";
      readonly phase: "dialog";
      readonly reason: "dialog-cancelled";
    }
  | {
      readonly status: "indeterminate";
      readonly commit: "unknown";
      readonly candidatePath?: string;
      readonly errorCode: string;
      readonly verificationRequired: true;
    }
  | {
      readonly status: "superseded-before-commit";
      readonly commit: "not-committed";
      readonly runtimeSequence: number;
      readonly supersededByRuntimeSequence: number;
    };

/**
 * 文档状态机处理保存落盘后的结算状态
 */
export type SettleSaveResult =
  | { readonly status: "applied"; readonly authoritativeCheckpointId: string }
  | {
      readonly status: "promoted";
      readonly authoritativeCheckpointId: string;
      readonly triggeredByCheckpointId: string;
    }
  | { readonly status: "deferred"; readonly blockedBySequence: number }
  | { readonly status: "superseded"; readonly authoritativeSequence: number }
  | { readonly status: "verification-required"; readonly checkpointId: string }
  | {
      readonly status: "stale-generation" | "duplicate" | "settled-no-state-change";
    }
  | MutationBusyResult
  | MutationRejectedResult;
