/**
 * @fileoverview 外部编辑预留令牌与回执模型
 *
 * 在富文本渲染器 (CodeMirror 6) 中，外部发起的编辑（如 AI 行内续写、格式化命令、粘贴富文本）
 * 需要先在 DocumentState 中申请预留令牌 (ExternalEditReservation)，以独占操作通道，
 * 防止与本地输入法 IME 组合、后台自动保存或并发命令发生时序竞争。
 */

import type { Markdown } from "@md-editor/shared";
import type { MutationBusyResult, MutationRejectedResult } from "./mutations.ts";

export const externalEditReservationBrand: unique symbol = Symbol("ExternalEditReservation");

/**
 * 外部编辑独占预留令牌
 * 携带类型保护品牌 (Brand)，外部不可伪造
 */
export interface ExternalEditReservation {
  readonly [externalEditReservationBrand]: true;
  /** 本次编辑操作唯一标识 */
  readonly operationId: string;
  /** 预留时的文档代际，用于校验代际有效性 */
  readonly documentGeneration: number;
  /** 预留时的内容版本号，用于防止脏写 */
  readonly contentRevision: number;
}

/**
 * 申请预留令牌的执行结果
 */
export type ExternalEditReservationResult =
  | { readonly status: "reserved"; readonly reservation: ExternalEditReservation }
  | {
      readonly status: "stale";
      readonly actualGeneration: number;
      readonly actualContentRevision: number;
    }
  | MutationBusyResult
  | MutationRejectedResult;

/**
 * 渲染器应用外部编辑后的确认回执
 */
export interface RendererExternalEditReceipt {
  readonly operationId: string;
  readonly markdown: Markdown;
  readonly viewId: string;
  readonly stateEpochId: string;
  readonly transactionSequence: number;
}

/**
 * 外部编辑最终提交回执
 */
export interface ExternalEditFinalizeReceipt {
  readonly status: "finalized";
  readonly operationId: string;
  readonly documentGeneration: number;
  readonly previousContentRevision: number;
  readonly contentRevision: number;
  readonly stateRevision: number;
}

/**
 * 释放预留令牌的原因
 * - `renderer-noop`: 渲染器比对后无需任何文本变更
 * - `renderer-failed`: 渲染器应用事务失败
 * - `composition-deferred`: 遇到中文/日文等 IME 输入法正在组合输入，安全推迟
 * - `cancelled`: 用户或调用方主动取消
 */
export type ExternalEditReleaseReason =
  "renderer-noop" | "renderer-failed" | "composition-deferred" | "cancelled";
