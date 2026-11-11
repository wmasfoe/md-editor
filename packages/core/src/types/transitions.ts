/**
 * @fileoverview 文档状态变迁与事件模型
 *
 * 记录每一次原子状态跃迁的详细信息 (DocumentTransition)，
 * 配合快照共同构成单向数据流通知载荷 (DocumentStateEvent)。
 */

import type { DocumentMutationOrigin } from "./mutations.ts";
import type { DocumentSnapshot } from "./snapshot.ts";

/**
 * 文档状态跃迁详细描述
 * 渲染器与其他联动模块可根据 kind 差异化更新视图，无需全量重算
 */
export type DocumentTransition =
  | {
      readonly kind: "content";
      readonly origin: DocumentMutationOrigin;
      readonly operationId: string;
      readonly sync: "already-applied";
    }
  | {
      readonly kind: "document-replace";
      readonly origin: DocumentMutationOrigin;
    }
  | {
      readonly kind: "mode";
      readonly origin: DocumentMutationOrigin;
      readonly operationId: string;
    }
  | {
      readonly kind: "metadata";
      readonly fields: readonly ["filePath"];
    }
  | {
      readonly kind: "save-settled";
      readonly checkpointId: string;
      readonly sequence: number;
      readonly filePath: string;
      readonly fields: readonly ("savedMarkdown" | "filePath")[];
      readonly rendererDisposition: "noop";
    }
  | {
      readonly kind: "save-verification-required";
      readonly checkpointId: string;
      readonly sequence: number;
      readonly rendererDisposition: "noop";
    };

/**
 * 文档状态机发布的事件对象
 * 包含最新的不可变快照 (snapshot) 与本次跃迁的明细 (transition)
 */
export interface DocumentStateEvent {
  readonly snapshot: DocumentSnapshot;
  readonly transition: DocumentTransition;
}
