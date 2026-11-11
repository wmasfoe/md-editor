/**
 * @fileoverview 模式切换协议与渲染器端口模型
 *
 * 规范所见即所得 (WYSIWYG) 模式与纯文本源码 (Source) 模式之间的两阶段切换协议。
 * 通过 applyMode / rollbackMode 接口确保模式切换过程中视图与核心状态严格一致。
 */

import type { CommandMutationOrigin, DocumentMutationOrigin } from "./mutations.ts";
import type { DocumentSnapshot, EditorMode } from "./snapshot.ts";

/**
 * 模式切换请求
 */
export interface ModeRequest {
  readonly operationId: string;
  readonly mode: EditorMode;
  readonly expectedGeneration: number;
  readonly expectedStateRevision: number;
}

/**
 * 渲染器应用模式切换成功的确认回执
 */
export interface ModeReceipt {
  readonly operationId: string;
  readonly clientId: string;
  readonly documentGeneration: number;
  readonly expectedStateRevision: number;
  readonly previousMode: EditorMode;
  readonly appliedMode: EditorMode;
  readonly viewId: string;
  readonly stateEpochId: string;
}

/**
 * 渲染器处理模式切换端口调用的响应结果
 */
export type ModePortResult =
  | { readonly status: "applied"; readonly receipt: ModeReceipt }
  | { readonly status: "noop" }
  | {
      readonly status: "stale";
      readonly actualGeneration: number;
      readonly actualStateRevision: number;
    }
  | { readonly status: "reconcile-required" }
  | { readonly status: "failed"; readonly errorCode: string };

/**
 * 渲染器模式切换适配器端口
 */
export interface ModeRendererPort {
  /** 向渲染器应用目标模式 */
  applyMode(request: ModeRequest): ModePortResult;
  /** 发生后续错误时向渲染器回滚模式 */
  rollbackMode(receipt: ModeReceipt): void;
}

/**
 * 状态机提交模式变更输入参数
 */
export interface CommitModeInput extends ModeRequest {
  readonly origin: DocumentMutationOrigin;
}

export type ModeSwitchError = "MODE_SWITCH_FAILED";

/**
 * 执行安全模式切换的高级配置项
 */
export interface ModeSwitchOptions {
  readonly operationId?: string;
  readonly renderer: ModeRendererPort;
  readonly origin?: CommandMutationOrigin;
}

export interface ModeSwitchOk {
  readonly ok: true;
  readonly snapshot: DocumentSnapshot;
}

export interface ModeSwitchFailure {
  readonly ok: false;
  readonly error: ModeSwitchError;
  readonly message: string;
  readonly snapshot: DocumentSnapshot;
}

export type ModeSwitchResult = ModeSwitchOk | ModeSwitchFailure;
