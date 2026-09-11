/**
 * @fileoverview 核心文档状态机实现 (DocumentState)
 *
 * 本模块是编辑器的权威状态协调中心（Single Source of Truth）。
 * 承担职责：
 * 1. 维护不可变文档快照 (DocumentSnapshot) 与只读单向数据流。
 * 2. 协调本地用户输入、外部命令、AI 自动补全及富文本模式切换的乐观并发锁。
 * 3. 维护外部编辑独占预留令牌 (ExternalEditReservation)，保障编辑事务原子性。
 * 4. 创建落盘保存检查点 (DocumentSaveCheckpoint) 并与原生文件系统安全结算。
 * 5. 防范重入漏洞 (Reentrancy Guard) 与隔离订阅者异常。
 */

import { normalizeLineEndings, type Markdown } from "@md-editor/shared";
import {
  externalEditReservationBrand,
  type DocumentListenerErrorContext,
  type DocumentMutationOrigin,
  type DocumentMutationResult,
  type DocumentSaveCheckpoint,
  type DocumentSnapshot,
  type DocumentState,
  type DocumentStateEvent,
  type DocumentStateInput,
  type DocumentTransition,
  type EditorMode,
  type ExternalEditReservation,
  type ModeRequest,
  type ModeSwitchOptions,
  type ModeSwitchResult,
  type MutationBusyResult,
  type MutationRejectedResult,
  type MutationStaleResult,
  type PersistenceStatus,
  type RendererMutationOrigin,
  type RendererSyncDeliveryResult,
  type RendererSyncPort,
  type SaveDestination,
  type SettleSaveResult,
} from "./types/index.ts";

// 重新导出所有核心类型，保持对外部调用者的 100% 向后兼容
export * from "./types/index.ts";

/**
 * 协议不变性违规异常
 * 当检测到底层状态机违反时序因果序、重复消费令牌或无效状态转移时抛出
 */
class DocumentProtocolInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentProtocolInvariantError";
  }
}

let nextDocumentStateInstanceId = 1;
let nextModeOperationSequence = 1;

/**
 * 深度冻结变更来源对象，确保不可变性
 */
function freezeOrigin<T extends DocumentMutationOrigin>(origin: T): T {
  return Object.freeze({ ...origin }) as T;
}

/**
 * 冻结持久化状态对象
 */
function freezePersistenceStatus(status: PersistenceStatus): PersistenceStatus {
  return Object.freeze({ ...status });
}

/**
 * 创建不可变快照对象并自动计算 isDirty 脏标记
 */
function createSnapshot(input: Omit<DocumentSnapshot, "isDirty">): DocumentSnapshot {
  return Object.freeze({
    ...input,
    isDirty: input.markdown !== input.savedMarkdown,
    persistenceStatus: freezePersistenceStatus(input.persistenceStatus),
  });
}

/**
 * 深度冻结状态跃迁事件描述
 */
function freezeTransition(transition: DocumentTransition): DocumentTransition {
  if (transition.kind === "content" || transition.kind === "mode") {
    return Object.freeze({ ...transition, origin: freezeOrigin(transition.origin) });
  }
  if (transition.kind === "document-replace") {
    return Object.freeze({ ...transition, origin: freezeOrigin(transition.origin) });
  }
  if (transition.kind === "metadata") {
    return Object.freeze({
      ...transition,
      fields: Object.freeze([...transition.fields]),
    }) as DocumentTransition;
  }
  if (transition.kind === "save-settled") {
    return Object.freeze({ ...transition, fields: Object.freeze([...transition.fields]) });
  }
  return Object.freeze({ ...transition });
}

/**
 * 冻结目标落盘位置对象
 */
function freezeDestination(destination: SaveDestination): SaveDestination {
  return Object.freeze({ ...destination });
}

/**
 * 根据渲染器客户端来源构造唯一操作 ID
 */
function mutationOriginOperationId(origin: RendererMutationOrigin): string {
  if (
    origin.clientId.length === 0 ||
    !Number.isSafeInteger(origin.sequence) ||
    origin.sequence <= 0
  ) {
    throw new DocumentProtocolInvariantError(
      "Renderer origins require a client id and positive sequence.",
    );
  }
  return `cm:${origin.clientId}:${origin.sequence}`;
}

/**
 * 保存请求在核心状态机内部的跟踪记录
 */
interface SaveRecord {
  readonly checkpoint: DocumentSaveCheckpoint;
  settled: boolean;
  candidate?: {
    readonly filePath: string;
  };
}

/**
 * 创建新的文档状态机实例
 *
 * @param input 初始 Markdown 内容、文件路径与异常回调
 * @returns 符合 DocumentState 契约的单向数据流协调器
 */
export function createDocumentState(input: DocumentStateInput = {}): DocumentState {
  const instanceId = nextDocumentStateInstanceId++;
  const transitionListeners = new Set<(event: DocumentStateEvent) => void>();
  const snapshotListeners = new Set<() => void>();
  const saveRecords = new Map<string, SaveRecord>();
  let saveSequence = 0;
  let authoritativeSaveSequence = 0;
  let verificationBarrierSequence: number | null = null;
  let activeReservation: ExternalEditReservation | null = null;
  let notifying = false;

  const initialMarkdown = normalizeLineEndings(input.markdown ?? "");
  const initialSavedMarkdown = normalizeLineEndings(input.savedMarkdown ?? initialMarkdown);
  let currentSnapshot = createSnapshot({
    markdown: initialMarkdown,
    savedMarkdown: initialSavedMarkdown,
    filePath: input.filePath ?? null,
    mode: input.mode ?? "wysiwyg",
    documentGeneration: 1,
    stateRevision: 0,
    contentRevision: 0,
    persistenceStatus: {
      kind: "verified",
      checkpointId: null,
      sequence: null,
    },
  });

  /**
   * 安全隔离并上报订阅者内部抛出的错误
   */
  function reportListenerError(error: unknown, context: DocumentListenerErrorContext): void {
    try {
      input.onListenerError?.(error, context);
    } catch {
      // 监听器错误上报失败不可打断已提交事务的主事件派发通道
    }
  }

  /**
   * 广播快照变动通知
   */
  function notifySnapshotListeners(event: DocumentStateEvent): void {
    for (const listener of Array.from(snapshotListeners)) {
      if (!snapshotListeners.has(listener)) {
        continue;
      }
      try {
        listener();
      } catch (error) {
        reportListenerError(error, { channel: "snapshot", event });
      }
    }
  }

  /**
   * 提交新快照并分发事件
   *
   * 采用 notifying 标志提供重入守卫：
   * 禁止任何监听器在同步通知阶段再次触发文档变更，避免循环死锁
   */
  function commit(
    nextSnapshot: DocumentSnapshot,
    transition: DocumentTransition,
  ): DocumentStateEvent {
    currentSnapshot = nextSnapshot;
    const event = Object.freeze({
      snapshot: nextSnapshot,
      transition: freezeTransition(transition),
    });

    notifying = true;
    try {
      for (const listener of Array.from(transitionListeners)) {
        if (!transitionListeners.has(listener)) {
          continue;
        }
        try {
          listener(event);
        } catch (error) {
          reportListenerError(error, { channel: "transition", event });
        }
      }
      notifySnapshotListeners(event);
    } finally {
      notifying = false;
    }
    return event;
  }

  /**
   * 检查当前状态机是否阻断新的变更
   */
  function blockedMutation(): MutationBusyResult | MutationRejectedResult | null {
    if (notifying) {
      return { status: "rejected", reason: "listener-reentrancy" };
    }
    if (activeReservation !== null) {
      return { status: "busy", activeOperationId: activeReservation.operationId };
    }
    return null;
  }

  /**
   * 构造版本过期冲突响应
   */
  function staleMutation(): MutationStaleResult {
    return {
      status: "stale",
      actualGeneration: currentSnapshot.documentGeneration,
      actualStateRevision: currentSnapshot.stateRevision,
      actualContentRevision: currentSnapshot.contentRevision,
    };
  }

  /**
   * 应用文本内容变动
   */
  function applyContent(
    markdown: Markdown,
    origin: DocumentMutationOrigin,
    operationId: string,
  ): DocumentMutationResult {
    const blocked = blockedMutation();
    if (blocked) {
      return blocked;
    }
    const markdownLf = normalizeLineEndings(markdown);
    if (markdownLf === currentSnapshot.markdown) {
      return { status: "noop", snapshot: currentSnapshot };
    }
    const nextSnapshot = createSnapshot({
      ...currentSnapshot,
      markdown: markdownLf,
      contentRevision: currentSnapshot.contentRevision + 1,
      stateRevision: currentSnapshot.stateRevision + 1,
    });
    const event = commit(nextSnapshot, {
      kind: "content",
      origin,
      operationId,
      sync: "already-applied",
    });
    return { status: "applied", snapshot: nextSnapshot, event };
  }

  /**
   * 将已落盘的候选保存记录提升为权威快照
   */
  function applyAuthoritativeCandidate(
    record: SaveRecord,
    triggeredByCheckpointId?: string,
  ): SettleSaveResult {
    const candidate = record.candidate;
    if (!candidate) {
      throw new DocumentProtocolInvariantError(
        "A save candidate must be committed before promotion.",
      );
    }

    const checkpoint = record.checkpoint;
    authoritativeSaveSequence = checkpoint.sequence;
    const clearsBarrier =
      verificationBarrierSequence !== null && checkpoint.sequence > verificationBarrierSequence;
    if (clearsBarrier) {
      verificationBarrierSequence = null;
    }

    const fields: ("savedMarkdown" | "filePath")[] = [];
    if (currentSnapshot.savedMarkdown !== checkpoint.markdownLf) {
      fields.push("savedMarkdown");
    }
    if (currentSnapshot.filePath !== candidate.filePath) {
      fields.push("filePath");
    }
    const stateChanged = fields.length > 0 || clearsBarrier;

    if (!stateChanged && currentSnapshot.persistenceStatus.kind === "verified") {
      return { status: "settled-no-state-change" };
    }

    const nextSnapshot = createSnapshot({
      ...currentSnapshot,
      savedMarkdown: checkpoint.markdownLf,
      filePath: candidate.filePath,
      stateRevision: currentSnapshot.stateRevision + 1,
      persistenceStatus: {
        kind: "verified",
        checkpointId: checkpoint.id,
        sequence: checkpoint.sequence,
      },
    });
    commit(nextSnapshot, {
      kind: "save-settled",
      checkpointId: checkpoint.id,
      sequence: checkpoint.sequence,
      filePath: candidate.filePath,
      fields: Object.freeze(fields),
      rendererDisposition: "noop",
    });

    if (triggeredByCheckpointId) {
      return {
        status: "promoted",
        authoritativeCheckpointId: checkpoint.id,
        triggeredByCheckpointId,
      };
    }
    return { status: "applied", authoritativeCheckpointId: checkpoint.id };
  }

  /**
   * 查询指定序号之后是否仍有未结算的保存请求
   */
  function highestPendingSequenceAfter(sequence: number): number | null {
    let highest: number | null = null;
    for (const record of saveRecords.values()) {
      if (
        !record.settled &&
        record.checkpoint.documentGeneration === currentSnapshot.documentGeneration &&
        record.checkpoint.sequence > sequence
      ) {
        highest =
          highest === null
            ? record.checkpoint.sequence
            : Math.max(highest, record.checkpoint.sequence);
      }
    }
    return highest;
  }

  /**
   * 获取当前可被提升为权威版本的最高已落盘保存记录
   */
  function highestPromotableCandidate(): SaveRecord | null {
    let selected: SaveRecord | null = null;
    for (const record of saveRecords.values()) {
      const sequence = record.checkpoint.sequence;
      if (
        record.candidate &&
        record.checkpoint.documentGeneration === currentSnapshot.documentGeneration &&
        sequence > authoritativeSaveSequence &&
        (verificationBarrierSequence === null || sequence > verificationBarrierSequence) &&
        (selected === null || sequence > selected.checkpoint.sequence)
      ) {
        selected = record;
      }
    }
    if (selected && highestPendingSequenceAfter(selected.checkpoint.sequence) !== null) {
      return null;
    }
    return selected;
  }

  const state: DocumentState = {
    subscribe(listener) {
      return state.subscribeSnapshot(listener);
    },
    subscribeSnapshot(listener) {
      snapshotListeners.add(listener);
      return () => snapshotListeners.delete(listener);
    },
    subscribeTransitions(listener) {
      transitionListeners.add(listener);
      return () => transitionListeners.delete(listener);
    },
    getSnapshot() {
      return currentSnapshot;
    },
    applyEditorChange(markdown, origin) {
      return applyContent(markdown, origin, mutationOriginOperationId(origin));
    },
    reserveExternalEdit(request) {
      if (notifying) {
        return { status: "rejected", reason: "listener-reentrancy" };
      }
      if (activeReservation !== null) {
        return { status: "busy", activeOperationId: activeReservation.operationId };
      }
      if (
        request.expectedGeneration !== currentSnapshot.documentGeneration ||
        request.expectedContentRevision !== currentSnapshot.contentRevision
      ) {
        return {
          status: "stale",
          actualGeneration: currentSnapshot.documentGeneration,
          actualContentRevision: currentSnapshot.contentRevision,
        };
      }
      const reservation = Object.freeze({
        [externalEditReservationBrand]: true as const,
        operationId: request.operationId,
        documentGeneration: currentSnapshot.documentGeneration,
        contentRevision: currentSnapshot.contentRevision,
      });
      activeReservation = reservation;
      return { status: "reserved", reservation };
    },
    finalizeExternalEdit(reservation, rendererReceipt) {
      if (activeReservation !== reservation) {
        throw new DocumentProtocolInvariantError(
          "External edit reservation is invalid or already consumed.",
        );
      }
      if (rendererReceipt.operationId !== reservation.operationId) {
        throw new DocumentProtocolInvariantError(
          "External edit operation id changed before finalize.",
        );
      }
      if (reservation.documentGeneration !== currentSnapshot.documentGeneration) {
        throw new DocumentProtocolInvariantError(
          "Document generation changed during a reserved external edit.",
        );
      }
      const markdownLf = normalizeLineEndings(rendererReceipt.markdown);
      if (markdownLf === currentSnapshot.markdown) {
        throw new DocumentProtocolInvariantError(
          "A renderer no-op must release instead of finalize.",
        );
      }

      const previousContentRevision = currentSnapshot.contentRevision;
      activeReservation = null;
      const nextSnapshot = createSnapshot({
        ...currentSnapshot,
        markdown: markdownLf,
        contentRevision: previousContentRevision + 1,
        stateRevision: currentSnapshot.stateRevision + 1,
      });
      commit(nextSnapshot, {
        kind: "content",
        origin: {
          kind: "command",
          commandId: "external-edit",
        },
        operationId: rendererReceipt.operationId,
        sync: "already-applied",
      });

      return Object.freeze({
        status: "finalized",
        operationId: reservation.operationId,
        documentGeneration: nextSnapshot.documentGeneration,
        previousContentRevision,
        contentRevision: nextSnapshot.contentRevision,
        stateRevision: nextSnapshot.stateRevision,
      });
    },
    releaseExternalEdit(reservation, _reason) {
      if (activeReservation !== reservation) {
        throw new DocumentProtocolInvariantError(
          "External edit reservation is invalid or already consumed.",
        );
      }
      activeReservation = null;
    },
    replaceDocument(replaceInput, origin) {
      const blocked = blockedMutation();
      if (blocked) {
        return blocked;
      }
      const markdownLf = normalizeLineEndings(replaceInput.markdown);
      const savedMarkdownLf = normalizeLineEndings(replaceInput.savedMarkdown ?? markdownLf);
      authoritativeSaveSequence = 0;
      verificationBarrierSequence = null;
      const nextSnapshot = createSnapshot({
        markdown: markdownLf,
        savedMarkdown: savedMarkdownLf,
        filePath: replaceInput.filePath ?? null,
        mode: replaceInput.mode ?? currentSnapshot.mode,
        documentGeneration: currentSnapshot.documentGeneration + 1,
        stateRevision: currentSnapshot.stateRevision + 1,
        contentRevision: 0,
        persistenceStatus: {
          kind: "verified",
          checkpointId: null,
          sequence: null,
        },
      });
      const event = commit(nextSnapshot, {
        kind: "document-replace",
        origin,
      });
      return { status: "applied", snapshot: nextSnapshot, event };
    },
    setDocumentPath(pathInput) {
      const blocked = blockedMutation();
      if (blocked) {
        return blocked;
      }
      if (
        pathInput.expectedGeneration !== currentSnapshot.documentGeneration ||
        pathInput.expectedStateRevision !== currentSnapshot.stateRevision
      ) {
        return staleMutation();
      }
      if (pathInput.filePath === currentSnapshot.filePath) {
        return { status: "noop", snapshot: currentSnapshot };
      }
      const nextSnapshot = createSnapshot({
        ...currentSnapshot,
        filePath: pathInput.filePath,
        stateRevision: currentSnapshot.stateRevision + 1,
      });
      const event = commit(nextSnapshot, {
        kind: "metadata",
        fields: ["filePath"],
      });
      return { status: "applied", snapshot: nextSnapshot, event };
    },
    commitMode(modeInput) {
      const blocked = blockedMutation();
      if (blocked) {
        return blocked;
      }
      if (
        modeInput.expectedGeneration !== currentSnapshot.documentGeneration ||
        modeInput.expectedStateRevision !== currentSnapshot.stateRevision
      ) {
        return staleMutation();
      }
      if (modeInput.mode === currentSnapshot.mode) {
        return { status: "noop", snapshot: currentSnapshot };
      }
      const nextSnapshot = createSnapshot({
        ...currentSnapshot,
        mode: modeInput.mode,
        stateRevision: currentSnapshot.stateRevision + 1,
      });
      const event = commit(nextSnapshot, {
        kind: "mode",
        origin: modeInput.origin,
        operationId: modeInput.operationId,
      });
      return { status: "applied", snapshot: nextSnapshot, event };
    },
    beginSave(destination) {
      if (notifying || activeReservation !== null) {
        throw new DocumentProtocolInvariantError(
          "Save checkpoints cannot start during notification or a reserved external edit.",
        );
      }
      saveSequence += 1;
      const checkpoint: DocumentSaveCheckpoint = Object.freeze({
        id: `document:${instanceId}:save:${saveSequence}`,
        sequence: saveSequence,
        documentGeneration: currentSnapshot.documentGeneration,
        contentRevision: currentSnapshot.contentRevision,
        markdownLf: currentSnapshot.markdown,
        destination: freezeDestination(destination),
      });
      saveRecords.set(checkpoint.id, { checkpoint, settled: false });
      return checkpoint;
    },
    settleSave(checkpoint, outcome) {
      const blocked = blockedMutation();
      if (blocked) {
        return blocked;
      }
      const record = saveRecords.get(checkpoint.id);
      if (!record || record.checkpoint !== checkpoint) {
        throw new DocumentProtocolInvariantError(
          "Save checkpoint does not belong to this document state.",
        );
      }
      if (record.settled) {
        return { status: "duplicate" };
      }
      record.settled = true;

      if (checkpoint.documentGeneration !== currentSnapshot.documentGeneration) {
        return { status: "stale-generation" };
      }

      if (outcome.status === "indeterminate") {
        if (
          checkpoint.sequence <= authoritativeSaveSequence ||
          (verificationBarrierSequence !== null &&
            checkpoint.sequence <= verificationBarrierSequence)
        ) {
          return {
            status: "superseded",
            authoritativeSequence: Math.max(
              authoritativeSaveSequence,
              verificationBarrierSequence ?? 0,
            ),
          };
        }
        verificationBarrierSequence = checkpoint.sequence;
        const persistenceStatus: PersistenceStatus = {
          kind: "verification-required",
          checkpointId: checkpoint.id,
          sequence: checkpoint.sequence,
          ...(outcome.candidatePath === undefined ? {} : { candidatePath: outcome.candidatePath }),
        };
        const nextSnapshot = createSnapshot({
          ...currentSnapshot,
          stateRevision: currentSnapshot.stateRevision + 1,
          persistenceStatus,
        });
        commit(nextSnapshot, {
          kind: "save-verification-required",
          checkpointId: checkpoint.id,
          sequence: checkpoint.sequence,
          rendererDisposition: "noop",
        });
        return { status: "verification-required", checkpointId: checkpoint.id };
      }

      if (outcome.status === "succeeded") {
        record.candidate = { filePath: outcome.filePath };
        if (
          checkpoint.sequence <= authoritativeSaveSequence ||
          (verificationBarrierSequence !== null &&
            checkpoint.sequence <= verificationBarrierSequence)
        ) {
          return {
            status: "superseded",
            authoritativeSequence: Math.max(
              authoritativeSaveSequence,
              verificationBarrierSequence ?? 0,
            ),
          };
        }
        const blockingSequence = highestPendingSequenceAfter(checkpoint.sequence);
        if (blockingSequence !== null) {
          return { status: "deferred", blockedBySequence: blockingSequence };
        }
        return applyAuthoritativeCandidate(record);
      }

      const promotable = highestPromotableCandidate();
      if (promotable) {
        return applyAuthoritativeCandidate(promotable, checkpoint.id);
      }
      return { status: "settled-no-state-change" };
    },
  };

  return state;
}

/**
 * 执行安全的编辑器模式切换
 *
 * 采用两阶段切换协议（准备校验 -> 渲染器执行 -> 核心状态提交 -> 失败自动回滚），
 * 确保视图与内核状态强一致。
 */
export function switchEditorModeSafely(
  document: DocumentState,
  nextMode: EditorMode,
  options: ModeSwitchOptions,
): ModeSwitchResult {
  const previous = document.getSnapshot();
  if (previous.mode === nextMode) {
    return { ok: true, snapshot: previous };
  }

  const operationId = options.operationId ?? `mode:command:${nextModeOperationSequence++}`;
  const request: ModeRequest = {
    operationId,
    mode: nextMode,
    expectedGeneration: previous.documentGeneration,
    expectedStateRevision: previous.stateRevision,
  };
  const rendererResult = options.renderer.applyMode(request);
  if (rendererResult.status === "noop") {
    const commitResult = document.commitMode({
      ...request,
      origin: options.origin ?? { kind: "command", commandId: "view.toggleSource" },
    });
    if (commitResult.status === "applied" || commitResult.status === "noop") {
      return { ok: true, snapshot: commitResult.snapshot };
    }
    return {
      ok: false,
      error: "MODE_SWITCH_FAILED",
      message: `Core mode compare-and-swap failed: ${commitResult.status}`,
      snapshot: document.getSnapshot(),
    };
  }
  if (rendererResult.status !== "applied") {
    return {
      ok: false,
      error: "MODE_SWITCH_FAILED",
      message: `Renderer mode change failed: ${rendererResult.status}`,
      snapshot: document.getSnapshot(),
    };
  }
  const receipt = rendererResult.receipt;
  if (
    receipt.operationId !== operationId ||
    receipt.documentGeneration !== previous.documentGeneration ||
    receipt.expectedStateRevision !== previous.stateRevision ||
    receipt.previousMode !== previous.mode ||
    receipt.appliedMode !== nextMode
  ) {
    options.renderer.rollbackMode(receipt);
    return {
      ok: false,
      error: "MODE_SWITCH_FAILED",
      message: "Renderer returned an invalid mode receipt.",
      snapshot: document.getSnapshot(),
    };
  }

  const commitResult = document.commitMode({
    ...request,
    origin: options.origin ?? { kind: "command", commandId: "view.toggleSource" },
  });
  if (commitResult.status === "applied" || commitResult.status === "noop") {
    return { ok: true, snapshot: commitResult.snapshot };
  }

  options.renderer.rollbackMode(receipt);
  return {
    ok: false,
    error: "MODE_SWITCH_FAILED",
    message: `Core mode compare-and-swap failed: ${commitResult.status}`,
    snapshot: document.getSnapshot(),
  };
}

/**
 * 协调派发状态机变更事件至挂载的渲染器客户端
 * 若检测到事件乱序或代际冲突，自动触发 reconcile 快照对齐
 */
export function synchronizeRendererEvent(
  document: DocumentState,
  renderer: RendererSyncPort,
  event: DocumentStateEvent,
): RendererSyncDeliveryResult {
  const initial = renderer.sync(event);
  if (initial.status !== "reconcile-required") {
    return { status: "synchronized", initial };
  }

  const reconciliation = renderer.reconcile(document.getSnapshot());
  if (reconciliation.status === "reconcile-required") {
    return { status: "sync-error", initial, reconciliation };
  }
  return { status: "synchronized", initial, reconciliation };
}
