/**
 * @fileoverview 变更来源与变更结果模型
 *
 * 定义所有导致文档状态发生跃迁的操作来源（渲染器编辑、外部命令等）
 * 以及乐观并发锁判定结果（成功、繁忙、陈旧冲突、重入拒绝）。
 */

import type { DocumentSnapshot, EditorMode } from "./snapshot.ts";
import type { DocumentStateEvent } from "./transitions.ts";
import type { Markdown } from "@md-editor/shared";

/**
 * 来源于 CodeMirror 渲染器视图内部的用户直接输入或编辑操作
 */
export type RendererMutationOrigin = {
  readonly kind: "renderer";
  /** 发生编辑的渲染器客户端标识 */
  readonly clientId: string;
  /** 渲染器内部事务序号 */
  readonly sequence: number;
};

/**
 * 来源于外部命令系统（如命令面板、工具栏按钮、快捷键格式化或 AI 补全）的变更
 */
export type CommandMutationOrigin = {
  readonly kind: "command";
  /** 触发的命令唯一标识 (例如 "format.bold", "file.save") */
  readonly commandId: string;
};

/**
 * 文档状态跃迁的来源联合类型
 */
export type DocumentMutationOrigin = RendererMutationOrigin | CommandMutationOrigin;

/**
 * 状态机正处于繁忙状态（例如正在执行独占式外部编辑预留令牌）
 */
export type MutationBusyResult = {
  readonly status: "busy";
  /** 当前独占锁的活跃操作 ID */
  readonly activeOperationId: string;
};

/**
 * 状态机发生重入拒绝（禁止在事件监听器回调中同步触发二次写入）
 */
export type MutationRejectedResult = {
  readonly status: "rejected";
  readonly reason: "listener-reentrancy";
};

/**
 * 乐观锁版本过期：调用方传入的预期代际或版本号与当前状态机不匹配
 */
export type MutationStaleResult = {
  readonly status: "stale";
  readonly actualGeneration: number;
  readonly actualStateRevision: number;
  readonly actualContentRevision: number;
};

/**
 * 变更操作执行结果联合类型
 */
export type DocumentMutationResult =
  | {
      readonly status: "applied";
      readonly snapshot: DocumentSnapshot;
      readonly event: DocumentStateEvent;
    }
  | { readonly status: "noop"; readonly snapshot: DocumentSnapshot }
  | MutationBusyResult
  | MutationRejectedResult
  | MutationStaleResult;

/**
 * 整篇替换文档输入参数
 */
export interface ReplaceDocumentInput {
  readonly markdown: Markdown;
  readonly savedMarkdown?: Markdown;
  readonly filePath?: string | null;
  readonly mode?: EditorMode;
}

/**
 * 更新文档物理路径输入参数（含并发校验）
 */
export interface SetDocumentPathInput {
  readonly filePath: string | null;
  readonly expectedGeneration: number;
  readonly expectedStateRevision: number;
  readonly origin: DocumentMutationOrigin;
}
