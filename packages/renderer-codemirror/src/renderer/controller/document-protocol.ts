/** Document synchronization, external edits and their transaction publication protocol. */
import type { ViewUpdate } from "@codemirror/view";
import { isolateHistory } from "@codemirror/commands";

import {
  type Compartment,
  EditorSelection,
  type EditorState,
  Transaction,
  type StateEffect,
} from "@codemirror/state";
import type {
  DocumentSnapshot,
  DocumentStateEvent,
  EditorMode,
  ModePortResult,
  ModeReceipt,
  ModeRequest,
  RendererExternalEditReceipt,
  RendererSyncResult,
} from "@md-editor/editor-core";
import { normalizeLineEndings } from "@md-editor/shared";

import { createModeExtensions, setEditorModeEffect } from "../../mode.ts";
import {
  readRendererTransactionOrigin,
  rendererTransactionOrigin,
  type RendererTransactionOrigin,
} from "../../origin.ts";

import { typewriterModeField } from "../../wysiwyg/input/typewriter-mode.ts";

import { authorizeWysiwygProtectedChange } from "../../wysiwyg/state/change-authorization.ts";
import { focusModeField } from "../../wysiwyg/view/focus-mode.ts";

import type { TransactionLedger } from "./transaction-ledger.ts";
import {
  freezeExternalRequest,
  validateExternalRequest,
  validateModeRequest,
} from "./validation.ts";
import type {
  CodeMirrorRendererOptions,
  ExternalEditRequest,
  ExternalEditResult,
  RendererViewAdapter,
  ViewAxisState,
} from "../types.ts";

/** Live accessors preserve controller ownership and synchronous callback ordering. */
export interface DocumentProtocolContext {
  readonly options: Pick<
    CodeMirrorRendererOptions,
    "onCursorLineChange" | "onEditorChange" | "onQueuedExternalEditReady"
  >;
  readonly clientId: string;
  readonly acceptSnapshotBookkeeping: (snapshot: DocumentSnapshot) => void;
  readonly clampedSelection: (length: number) => EditorSelection;
  readonly clearPendingProtocolState: () => void;
  compositionActive: boolean;
  readonly contentRevision: number;
  readonly createState: (
    snapshot: DocumentSnapshot,
    alignment: ViewAxisState,
    selection?: EditorSelection,
  ) => EditorState;
  readonly currentMode: () => EditorMode;
  readonly destroyed: boolean;
  readonly documentGeneration: number;
  hiddenViewState: { readonly focused: boolean; readonly scrollTop: number } | null;
  highestPublishedRendererSequence: number;
  lastAcknowledgedRendererSequence: number;
  lastErrorCode: string | null;
  readonly ledger: TransactionLedger;
  readonly modeCompartment: Compartment;
  readonly modeCursorPosByMode: Map<EditorMode, number>;
  readonly modeScrollTopsByMode: Map<EditorMode, number>;
  readonly notifyCancellation: (
    reason: Extract<ExternalEditResult, { status: "cancelled" }>["reason"],
  ) => void;
  readonly notifyQueuedCancellation: (
    reason: Extract<ExternalEditResult, { status: "cancelled" }>["reason"],
  ) => void;
  pendingExternalEdit: ExternalEditRequest | null;
  readonly pendingLocalSequences: number[];
  pendingModeReceipt: ModeReceipt | null;
  readonly performModeChange: (mode: EditorMode, origin: RendererTransactionOrigin) => void;
  queuedExternalEdit: ExternalEditRequest | null;
  readonly reconcileRequired: (revision: number) => RendererSyncResult;
  reconcileScrollRestoreSequence: number;
  readonly recordSyncResult: <T extends RendererSyncResult>(result: T) => T;
  readonly requestMeasure: (afterMeasure?: () => void) => void;
  stateEpochId: string;
  stateEpochSequence: number;
  stateReplacementCount: number;
  readonly stateRevision: number;
  readonly view: RendererViewAdapter;
  readonly viewId: string;
  visibilityRestoreSequence: number;
}

export function sync(
  context: DocumentProtocolContext,
  event: DocumentStateEvent,
): RendererSyncResult {
  const snapshot = event.snapshot;
  const eventMarkdown = normalizeLineEndings(snapshot.markdown);

  if (context.destroyed) {
    return context.reconcileRequired(snapshot.stateRevision);
  }

  if (snapshot.documentGeneration < context.documentGeneration) {
    return context.recordSyncResult({
      status: "stale-generation",
      rendererGeneration: context.documentGeneration,
      eventGeneration: snapshot.documentGeneration,
    });
  }

  if (snapshot.documentGeneration > context.documentGeneration) {
    if (event.transition.kind !== "document-replace") {
      return context.reconcileRequired(snapshot.stateRevision);
    }
    installDocumentBoundary(context, snapshot);
    return context.recordSyncResult({ status: "applied", transactionCount: 1 });
  }

  if (event.transition.kind === "document-replace") {
    if (snapshot.stateRevision <= context.stateRevision) {
      return context.recordSyncResult({ status: "duplicate", transactionCount: 0 });
    }
    return context.reconcileRequired(snapshot.stateRevision);
  }

  if (event.transition.kind === "content" && event.transition.origin.kind === "renderer") {
    const sequence = event.transition.origin.sequence;
    if (event.transition.origin.clientId !== context.clientId) {
      return context.reconcileRequired(snapshot.stateRevision);
    }
    if (sequence <= context.lastAcknowledgedRendererSequence) {
      return context.recordSyncResult({ status: "duplicate", transactionCount: 0 });
    }
    if (
      sequence > context.highestPublishedRendererSequence ||
      sequence !== context.pendingLocalSequences[0]
    ) {
      return context.reconcileRequired(snapshot.stateRevision);
    }
  }

  if (snapshot.stateRevision <= context.stateRevision) {
    return context.recordSyncResult({ status: "duplicate", transactionCount: 0 });
  }
  if (snapshot.stateRevision !== context.stateRevision + 1) {
    return context.reconcileRequired(snapshot.stateRevision);
  }

  const currentMarkdown = context.view.state.doc.toString();
  const currentMode = context.currentMode();

  switch (event.transition.kind) {
    case "content": {
      if (
        eventMarkdown !== currentMarkdown ||
        snapshot.mode !== currentMode ||
        snapshot.contentRevision !== context.contentRevision + 1
      ) {
        return context.reconcileRequired(snapshot.stateRevision);
      }

      if (event.transition.origin.kind === "renderer") {
        const sequence = context.pendingLocalSequences.shift();
        if (sequence === undefined) {
          return context.reconcileRequired(snapshot.stateRevision);
        }
        context.lastAcknowledgedRendererSequence = sequence;
      } else if (context.pendingExternalEdit?.operationId === event.transition.operationId) {
        context.pendingExternalEdit = null;
      } else {
        return context.reconcileRequired(snapshot.stateRevision);
      }
      break;
    }
    case "mode": {
      if (
        eventMarkdown !== currentMarkdown ||
        snapshot.contentRevision !== context.contentRevision ||
        snapshot.mode !== currentMode ||
        context.pendingModeReceipt?.operationId !== event.transition.operationId ||
        context.pendingModeReceipt.appliedMode !== snapshot.mode
      ) {
        return context.reconcileRequired(snapshot.stateRevision);
      }
      context.pendingModeReceipt = null;
      break;
    }
    case "metadata":
    case "save-settled":
    case "save-verification-required": {
      if (
        eventMarkdown !== currentMarkdown ||
        snapshot.mode !== currentMode ||
        snapshot.contentRevision !== context.contentRevision
      ) {
        return context.reconcileRequired(snapshot.stateRevision);
      }
      break;
    }
  }

  context.acceptSnapshotBookkeeping(snapshot);
  return context.recordSyncResult({ status: "acknowledged", transactionCount: 0 });
}

export function reconcile(
  context: DocumentProtocolContext,
  snapshot: DocumentSnapshot,
): RendererSyncResult {
  if (context.destroyed) {
    return context.reconcileRequired(snapshot.stateRevision);
  }
  if (snapshot.documentGeneration < context.documentGeneration) {
    return context.recordSyncResult({
      status: "stale-generation",
      rendererGeneration: context.documentGeneration,
      eventGeneration: snapshot.documentGeneration,
    });
  }
  if (snapshot.documentGeneration > context.documentGeneration) {
    installDocumentBoundary(context, snapshot);
    return context.recordSyncResult({
      status: "reconciled",
      strategy: "document-boundary",
    });
  }
  if (snapshot.stateRevision < context.stateRevision) {
    return context.recordSyncResult({ status: "duplicate", transactionCount: 0 });
  }

  const markdownLf = normalizeLineEndings(snapshot.markdown);
  const currentMarkdown = context.view.state.doc.toString();
  const modeChanged = snapshot.mode !== context.currentMode();
  if (markdownLf === currentMarkdown && !modeChanged) {
    context.clearPendingProtocolState();
    context.acceptSnapshotBookkeeping(snapshot);
    return context.recordSyncResult({
      status: "reconciled",
      strategy: "revision-only",
    });
  }

  const effects: StateEffect<unknown>[] = [];
  if (modeChanged) {
    effects.push(
      setEditorModeEffect.of(snapshot.mode),
      context.modeCompartment.reconfigure(createModeExtensions(snapshot.mode)),
    );
  }
  const nextSelection = context.clampedSelection(markdownLf.length);
  // S7：**全量替换文档时必须保留视口位置**。
  //
  // 宿主与应用自身在会话中会重新装载当前文档（保存往返、外部改动、设置变更后的快照同步
  // 都走本路径）。只要重发内容与编辑器当前内容存在**任何微小差异**（换行/尾空白归一即足够），
  // 下面就是一次全量替换 —— 若不恢复滚动，正在阅读的用户会被**弹回顶部**。
  // 属主复现（E34，夹具为其逐字文档）：滚动到 2560 → 装载后 0；修复后保持原位。
  const preservedScrollTop = markdownLf === currentMarkdown ? null : context.view.getScrollTop();
  context.view.dispatch({
    ...(markdownLf === currentMarkdown
      ? {}
      : {
          changes: { from: 0, to: context.view.state.doc.length, insert: markdownLf },
          selection: nextSelection,
        }),
    effects,
    annotations: [
      Transaction.addToHistory.of(false),
      isolateHistory.of("full"),
      authorizeWysiwygProtectedChange.of(true),
      rendererTransactionOrigin.of({ kind: "reconcile" }),
    ],
  });
  if (preservedScrollTop !== null) {
    // CodeMirror 可能在随后的 measure 中调整滚动锚点（与 setHostVisibility 同款处置）：
    // 先在本次写入恢复一次，再在 measure 回调里复核一次。
    context.view.setScrollTop(preservedScrollTop);
    const restoreSequence = ++context.reconcileScrollRestoreSequence;
    context.requestMeasure(() => {
      if (!context.destroyed && context.reconcileScrollRestoreSequence === restoreSequence) {
        context.view.setScrollTop(preservedScrollTop);
      }
    });
  }
  context.clearPendingProtocolState();
  context.acceptSnapshotBookkeeping(snapshot);
  return context.recordSyncResult({
    status: "reconciled",
    strategy: "isolated-transaction",
  });
}

export function applyReservedExternalEdit(
  context: DocumentProtocolContext,
  request: ExternalEditRequest,
): ExternalEditResult {
  validateExternalRequest(request);
  if (context.destroyed) {
    return { status: "cancelled", reason: "destroyed" };
  }
  if (
    request.expectedGeneration !== context.documentGeneration ||
    request.expectedContentRevision !== context.contentRevision
  ) {
    return {
      status: "stale",
      actualGeneration: context.documentGeneration,
      actualContentRevision: context.contentRevision,
    };
  }
  if (
    context.pendingLocalSequences.length > 0 ||
    context.pendingExternalEdit !== null ||
    context.pendingModeReceipt !== null
  ) {
    return { status: "reconcile-required" };
  }

  const frozenRequest = freezeExternalRequest({
    ...request,
    markdown: normalizeLineEndings(request.markdown),
  });
  if (context.compositionActive || context.view.isComposing) {
    if (context.queuedExternalEdit !== null) {
      context.notifyQueuedCancellation("superseded");
    }
    context.queuedExternalEdit = frozenRequest;
    return { status: "queued-composition", operationId: request.operationId };
  }
  if (frozenRequest.markdown === context.view.state.doc.toString()) {
    return { status: "noop" };
  }

  context.pendingExternalEdit = frozenRequest;
  try {
    const selection =
      frozenRequest.selection === "start"
        ? EditorSelection.single(0)
        : context.clampedSelection(frozenRequest.markdown.length);
    context.view.dispatch({
      changes: {
        from: 0,
        to: context.view.state.doc.length,
        insert: frozenRequest.markdown,
      },
      selection,
      annotations: [
        Transaction.addToHistory.of(true),
        isolateHistory.of("full"),
        authorizeWysiwygProtectedChange.of(true),
        rendererTransactionOrigin.of({
          kind: "external-edit",
          operationId: frozenRequest.operationId,
        }),
      ],
    });
  } catch {
    context.pendingExternalEdit = null;
    context.lastErrorCode = "EXTERNAL_EDIT_DISPATCH_FAILED";
    return { status: "reconcile-required" };
  }

  const receipt: RendererExternalEditReceipt = Object.freeze({
    operationId: frozenRequest.operationId,
    markdown: context.view.state.doc.toString(),
    viewId: context.viewId,
    stateEpochId: context.stateEpochId,
    transactionSequence: context.ledger.documentTransactionCount,
  });
  return { status: "applied", receipt, transactionCount: 1 };
}

export function applyMode(context: DocumentProtocolContext, request: ModeRequest): ModePortResult {
  validateModeRequest(request);
  if (context.destroyed) {
    return { status: "failed", errorCode: "RENDERER_DESTROYED" };
  }
  if (
    request.expectedGeneration !== context.documentGeneration ||
    request.expectedStateRevision !== context.stateRevision
  ) {
    return {
      status: "stale",
      actualGeneration: context.documentGeneration,
      actualStateRevision: context.stateRevision,
    };
  }
  if (
    context.pendingLocalSequences.length > 0 ||
    context.pendingExternalEdit !== null ||
    context.pendingModeReceipt !== null
  ) {
    return { status: "reconcile-required" };
  }

  const previousMode = context.currentMode();
  if (request.mode === previousMode) {
    return { status: "noop" };
  }

  const receipt: ModeReceipt = Object.freeze({
    operationId: request.operationId,
    clientId: context.clientId,
    documentGeneration: context.documentGeneration,
    expectedStateRevision: request.expectedStateRevision,
    previousMode,
    appliedMode: request.mode,
    viewId: context.viewId,
    stateEpochId: context.stateEpochId,
  });
  context.pendingModeReceipt = receipt;
  try {
    context.performModeChange(request.mode, {
      kind: "mode",
      operationId: request.operationId,
    });
  } catch (error) {
    console.error("[applyMode dispatch failed]", error);
    context.pendingModeReceipt = null;
    context.lastErrorCode = "MODE_DISPATCH_FAILED";
    return { status: "failed", errorCode: "MODE_DISPATCH_FAILED" };
  }
  return { status: "applied", receipt };
}

export function rollbackMode(context: DocumentProtocolContext, receipt: ModeReceipt): void {
  if (
    context.destroyed ||
    context.pendingModeReceipt !== receipt ||
    receipt.clientId !== context.clientId ||
    receipt.viewId !== context.viewId ||
    receipt.stateEpochId !== context.stateEpochId ||
    context.currentMode() !== receipt.appliedMode
  ) {
    throw new Error("Mode rollback receipt is stale or does not belong to this renderer.");
  }
  context.performModeChange(receipt.previousMode, {
    kind: "mode-rollback",
    operationId: receipt.operationId,
  });
  context.pendingModeReceipt = null;
}

export function installDocumentBoundary(
  context: DocumentProtocolContext,
  snapshot: DocumentSnapshot,
): void {
  const notifyQueuedCancellation = context.queuedExternalEdit !== null;
  context.queuedExternalEdit = null;
  context.compositionActive = false;
  context.hiddenViewState = null;
  context.visibilityRestoreSequence += 1;
  context.modeScrollTopsByMode.clear();
  context.modeCursorPosByMode.clear();
  context.clearPendingProtocolState();
  // S7：**区分「换文档」与「同一文档重装载」**。
  // 换文档回顶部是对的；但同一文档的重装载（保存往返、外部改动、设置变更后的快照重发）
  // 若无条件归零，就会把正在阅读的用户**弹回顶部** —— 属主复现（E34，夹具为其逐字文档）。
  //
  // 身份判据**只认宿主声明**（`snapshot.replaceIntent`），渲染层不做任何推断
  //（architect 终审驱动项 ①）：从路径/内容前缀反推会重复宿主的领域知识
  //（宿主本就拥有 `documentGeneration` 与重装载意图），并悄悄成为视口语义的隐性事实源。
  // 未声明时按 `"different"` 归零（fail-safe：宁归零，不保留错位阅读位置）——见 R17/R17e/R17f。
  const previousScrollTop = context.view.getScrollTop();
  const sameDocument = snapshot.replaceIntent === "same";
  // 同一文档重装载：**连光标一起保留**。否则视口保留了、光标却被复位到 0 ⇒ 光标落在视口之外，
  // 下一次按键会把视口拽回顶部，等于没修（code-reviewer 复审 MEDIUM-3）。
  // 换文档仍归零（R17 原契约）；same 时用 `#clampedSelection` 按新文档长度夹取
  //（与 reconcile / external-edit 两条兄弟路径同一约定，可保留区间与多光标 —— architect R3）。
  // 视图轴（专注/打字机）与文档轴正交：跨边界继承，不随文档重置（S1(b)/MED-4 根因修复）。
  const viewAxisAlignment: ViewAxisState = {
    focus: context.view.state.field(focusModeField, false) === true,
    typewriter: context.view.state.field(typewriterModeField, false) === true,
  };
  const nextState = context.createState(
    snapshot,
    viewAxisAlignment,
    sameDocument
      ? // 用**归一后**长度夹取（与 `#createState` 的 `normalizeLineEndings` 及 reconcile 兄弟路径
        // 的 `markdownLf.length` 一致；今天等价，但不留「归一前/后长度混用」的潜在坑 —— architect R3/code-reviewer 残留 3）
        context.clampedSelection(normalizeLineEndings(snapshot.markdown).length)
      : undefined,
  );
  context.view.setState(nextState);
  context.view.clearDomSelection();
  if (sameDocument) {
    // 与 setHostVisibility 同款：先写一次，再在 measure 回调复核（CM 可能调整滚动锚点）
    const restoreSequence = ++context.reconcileScrollRestoreSequence;
    context.view.setScrollTop(previousScrollTop);
    context.requestMeasure(() => {
      if (!context.destroyed && context.reconcileScrollRestoreSequence === restoreSequence) {
        context.view.setScrollTop(previousScrollTop);
      }
    });
  } else {
    context.view.setScrollTop(0);
  }
  context.stateReplacementCount += 1;
  context.stateEpochSequence += 1;
  context.stateEpochId = `${context.viewId.replace("view", "state")}-${context.stateEpochSequence}`;
  context.acceptSnapshotBookkeeping(snapshot);
  if (notifyQueuedCancellation) {
    context.notifyCancellation("document-replaced");
  }
}

/** Transaction publication shares the protocol counters, with a narrower update-only contract. */
export interface ViewUpdateContext extends Pick<
  DocumentProtocolContext,
  | "clientId"
  | "ledger"
  | "lastErrorCode"
  | "highestPublishedRendererSequence"
  | "pendingLocalSequences"
> {
  readonly options: Pick<CodeMirrorRendererOptions, "onCursorLineChange" | "onEditorChange">;
}
export function handleViewUpdate(context: ViewUpdateContext, update: ViewUpdate): void {
  if (update.selectionSet || update.docChanged) {
    const head = update.state.selection.main.head;
    const line = update.state.doc.lineAt(head).number;
    context.options.onCursorLineChange?.(line);
  }

  const documentTransactions = update.transactions.filter((transaction) => transaction.docChanged);
  if (documentTransactions.length === 0) {
    for (const transaction of update.transactions) {
      context.ledger.countOrigin(readRendererTransactionOrigin(transaction));
    }
    return;
  }

  context.ledger.countDocumentTransactions(documentTransactions.length);
  const localTransactions: Transaction[] = [];
  for (const transaction of update.transactions) {
    const origin = readRendererTransactionOrigin(transaction);
    context.ledger.countOrigin(origin);
    if (transaction.docChanged && origin === undefined) {
      localTransactions.push(transaction);
    }
  }
  if (localTransactions.length === 0) {
    return;
  }
  if (localTransactions.length !== documentTransactions.length) {
    context.lastErrorCode = "MIXED_LOCAL_AND_INTERNAL_TRANSACTIONS";
    return;
  }

  context.highestPublishedRendererSequence += 1;
  const sequence = context.highestPublishedRendererSequence;
  context.pendingLocalSequences.push(sequence);
  const markdownLf = update.state.doc.toString();
  if (markdownLf.includes("\r")) {
    context.lastErrorCode = "NON_LF_RENDERER_OUTPUT";
    throw new Error("CodeMirror produced non-LF Markdown.");
  }
  context.options.onEditorChange({
    markdown: markdownLf,
    origin: Object.freeze({ kind: "renderer", clientId: context.clientId, sequence }),
  });
}
