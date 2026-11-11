/**
 * @fileoverview 渲染器单向同步端口协议
 *
 * 规范主状态机将 DocumentStateEvent 派发至挂载的渲染器客户端的递送契约，
 * 支持检测版本空洞并触发快照对齐对账 (Reconcile)。
 */

import type { DocumentSnapshot } from "./snapshot.ts";
import type { DocumentStateEvent } from "./transitions.ts";

/**
 * 渲染器接收状态机变更事件的处理结果
 */
export type RendererSyncResult =
  | { readonly status: "applied"; readonly transactionCount: 1 }
  | { readonly status: "acknowledged"; readonly transactionCount: 0 }
  | { readonly status: "duplicate"; readonly transactionCount: 0 }
  | {
      readonly status: "reconciled";
      readonly strategy: "revision-only" | "isolated-transaction" | "document-boundary";
    }
  | {
      readonly status: "reconcile-required";
      readonly expectedStateRevision: number;
      readonly receivedStateRevision: number;
    }
  | {
      readonly status: "stale-generation";
      readonly rendererGeneration: number;
      readonly eventGeneration: number;
    };

/**
 * 渲染器同步端口接口
 */
export interface RendererSyncPort {
  /** 接收来自核心状态机的单向事件并更新视图 */
  sync(event: DocumentStateEvent): RendererSyncResult;
  /** 当发生版本落后或冲突时，以当前快照全量对齐视图 */
  reconcile(snapshot: DocumentSnapshot): RendererSyncResult;
}

/**
 * 渲染器同步投递结果汇总
 */
export type RendererSyncDeliveryResult =
  | {
      readonly status: "synchronized";
      readonly initial: RendererSyncResult;
      readonly reconciliation?: RendererSyncResult;
    }
  | {
      readonly status: "sync-error";
      readonly initial: Extract<RendererSyncResult, { readonly status: "reconcile-required" }>;
      readonly reconciliation: Extract<
        RendererSyncResult,
        { readonly status: "reconcile-required" }
      >;
    };
