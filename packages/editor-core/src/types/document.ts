/**
 * @fileoverview 核心文档状态机接口定义
 *
 * DocumentState 是整个编辑器的核心实体状态机契约，封装了文档的单向数据流、
 * 版本跃迁控制、外部编辑独占锁与原生保存落盘检查点。
 */

import type { Markdown } from "@md-editor/shared";
import type { CommitModeInput } from "./mode.ts";
import type {
  DocumentMutationOrigin,
  DocumentMutationResult,
  RendererMutationOrigin,
  ReplaceDocumentInput,
  SetDocumentPathInput,
} from "./mutations.ts";
import type {
  ExternalEditFinalizeReceipt,
  ExternalEditReleaseReason,
  ExternalEditReservation,
  ExternalEditReservationResult,
  RendererExternalEditReceipt,
} from "./reservations.ts";
import type {
  DocumentSaveCheckpoint,
  SaveDestination,
  SaveOutcome,
  SettleSaveResult,
} from "./save.ts";
import type { DocumentSnapshot, Unsubscribe } from "./snapshot.ts";
import type { DocumentStateEvent } from "./transitions.ts";

/**
 * 核心文档状态机接口
 */
export interface DocumentState {
  /**
   * 订阅状态变更（旧接口，仅提供无参通知）
   * @deprecated 请使用 subscribeSnapshot 或 subscribeTransitions 替代
   */
  subscribe(listener: () => void): Unsubscribe;

  /**
   * 订阅快照更新
   * 当文档发生任何可见状态变化时被调用，适合轻量级 UI 重新获取 getSnapshot()
   */
  subscribeSnapshot(listener: () => void): Unsubscribe;

  /**
   * 订阅精细化状态跃迁事件
   * 回调接收完整的 DocumentStateEvent，适合渲染器或协同模块进行增量事务处理
   */
  subscribeTransitions(listener: (event: DocumentStateEvent) => void): Unsubscribe;

  /**
   * 获取当前不可变文档快照
   */
  getSnapshot(): DocumentSnapshot;

  /**
   * 应用来自渲染器层直接提交的用户输入与文本变更
   *
   * @param markdown 渲染器内部最新 Markdown 文本
   * @param origin 渲染器客户端标识与事务序号
   */
  applyEditorChange(markdown: Markdown, origin: RendererMutationOrigin): DocumentMutationResult;

  /**
   * 申请外部编辑独占预留令牌
   * 在执行 AI 自动续写、批量文本格式化等操作前调用，防止并发冲突
   */
  reserveExternalEdit(request: {
    readonly operationId: string;
    readonly expectedGeneration: number;
    readonly expectedContentRevision: number;
  }): ExternalEditReservationResult;

  /**
   * 提交并完成外部编辑操作
   *
   * @param reservation 先前成功申请的令牌
   * @param rendererReceipt 渲染器应用变更后返回的回执
   */
  finalizeExternalEdit(
    reservation: ExternalEditReservation,
    rendererReceipt: RendererExternalEditReceipt,
  ): ExternalEditFinalizeReceipt;

  /**
   * 放弃或释放外部编辑预留令牌
   *
   * @param reservation 令牌对象
   * @param reason 释放原因（如无变动、用户取消、输入法中断）
   */
  releaseExternalEdit(
    reservation: ExternalEditReservation,
    reason: ExternalEditReleaseReason,
  ): void;

  /**
   * 整篇替换文档内容或重置文档
   * 会递增 documentGeneration 代际编号，作废所有未完成的异步任务
   */
  replaceDocument(
    input: ReplaceDocumentInput,
    origin: DocumentMutationOrigin,
  ): DocumentMutationResult;

  /**
   * 更新文档关联的本地物理文件路径（带乐观锁版本校验）
   */
  setDocumentPath(input: SetDocumentPathInput): DocumentMutationResult;

  /**
   * 提交模式切换变更
   */
  commitMode(input: CommitModeInput): DocumentMutationResult;

  /**
   * 开启保存流程并创建不可变保存检查点
   *
   * @param destination 保存目的地（当前路径或弹出另存为对话框）
   */
  beginSave(destination: SaveDestination): DocumentSaveCheckpoint;

  /**
   * 原生落盘操作完成后结算保存状态
   *
   * @param checkpoint 发起保存时生成的检查点
   * @param outcome 底层文件系统返回的成功或失败信息
   */
  settleSave(checkpoint: DocumentSaveCheckpoint, outcome: SaveOutcome): SettleSaveResult;
}
