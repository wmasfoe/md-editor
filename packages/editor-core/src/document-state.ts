import { normalizeLineEndings, type Markdown } from "@md-editor/shared";

export type EditorMode = "wysiwyg" | "source";
export type Unsubscribe = () => void;

export type PersistenceStatus =
  | {
      readonly kind: "verified";
      readonly checkpointId: string | null;
      readonly sequence: number | null;
    }
  | {
      readonly kind: "verification-required";
      readonly checkpointId: string;
      readonly sequence: number;
      readonly candidatePath?: string;
    };

export interface DocumentSnapshot {
  readonly markdown: Markdown;
  readonly savedMarkdown: Markdown;
  readonly filePath: string | null;
  readonly mode: EditorMode;
  readonly isDirty: boolean;
  readonly documentGeneration: number;
  readonly stateRevision: number;
  readonly contentRevision: number;
  readonly persistenceStatus: PersistenceStatus;
}

export type RendererMutationOrigin = {
  readonly kind: "renderer";
  readonly clientId: string;
  readonly sequence: number;
};

export type CommandMutationOrigin = {
  readonly kind: "command";
  readonly commandId: string;
};

export type DocumentMutationOrigin = RendererMutationOrigin | CommandMutationOrigin;

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

export interface DocumentStateEvent {
  readonly snapshot: DocumentSnapshot;
  readonly transition: DocumentTransition;
}

export interface DocumentListenerErrorContext {
  readonly channel: "transition" | "snapshot";
  readonly event: DocumentStateEvent;
}

export interface DocumentStateInput {
  readonly markdown?: Markdown;
  readonly savedMarkdown?: Markdown;
  readonly filePath?: string | null;
  readonly mode?: EditorMode;
  readonly onListenerError?: (error: unknown, context: DocumentListenerErrorContext) => void;
}

export type MutationBusyResult = {
  readonly status: "busy";
  readonly activeOperationId: string;
};

export type MutationRejectedResult = {
  readonly status: "rejected";
  readonly reason: "listener-reentrancy";
};

export type MutationStaleResult = {
  readonly status: "stale";
  readonly actualGeneration: number;
  readonly actualStateRevision: number;
  readonly actualContentRevision: number;
};

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

const externalEditReservationBrand: unique symbol = Symbol("ExternalEditReservation");

export interface ExternalEditReservation {
  readonly [externalEditReservationBrand]: true;
  readonly operationId: string;
  readonly documentGeneration: number;
  readonly contentRevision: number;
}

export type ExternalEditReservationResult =
  | { readonly status: "reserved"; readonly reservation: ExternalEditReservation }
  | {
      readonly status: "stale";
      readonly actualGeneration: number;
      readonly actualContentRevision: number;
    }
  | MutationBusyResult
  | MutationRejectedResult;

export interface RendererExternalEditReceipt {
  readonly operationId: string;
  readonly markdown: Markdown;
  readonly viewId: string;
  readonly stateEpochId: string;
  readonly transactionSequence: number;
}

export interface ExternalEditFinalizeReceipt {
  readonly status: "finalized";
  readonly operationId: string;
  readonly documentGeneration: number;
  readonly previousContentRevision: number;
  readonly contentRevision: number;
  readonly stateRevision: number;
}

export type ExternalEditReleaseReason =
  "renderer-noop" | "renderer-failed" | "composition-deferred" | "cancelled";

export interface ReplaceDocumentInput {
  readonly markdown: Markdown;
  readonly savedMarkdown?: Markdown;
  readonly filePath?: string | null;
  readonly mode?: EditorMode;
}

export interface SetDocumentPathInput {
  readonly filePath: string | null;
  readonly expectedGeneration: number;
  readonly expectedStateRevision: number;
  readonly origin: DocumentMutationOrigin;
}

export interface ModeRequest {
  readonly operationId: string;
  readonly mode: EditorMode;
  readonly expectedGeneration: number;
  readonly expectedStateRevision: number;
}

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

export interface ModeRendererPort {
  applyMode(request: ModeRequest): ModePortResult;
  rollbackMode(receipt: ModeReceipt): void;
}

export interface CommitModeInput extends ModeRequest {
  readonly origin: DocumentMutationOrigin;
}

export type ModeSwitchError = "MODE_SWITCH_FAILED";

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

export type SaveDestination =
  | { readonly kind: "current-path"; readonly path: string }
  | { readonly kind: "prompt"; readonly suggestedPath?: string };

export interface DocumentSaveCheckpoint {
  readonly id: string;
  readonly sequence: number;
  readonly documentGeneration: number;
  readonly contentRevision: number;
  readonly markdownLf: Markdown;
  readonly destination: SaveDestination;
}

export interface SaveWarning {
  readonly code: "asset-directory-registration-failed";
  readonly message: string;
}

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

export interface RendererSyncPort {
  sync(event: DocumentStateEvent): RendererSyncResult;
  reconcile(snapshot: DocumentSnapshot): RendererSyncResult;
}

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

export interface DocumentState {
  /** @deprecated Use subscribeSnapshot during the S1 migration. */
  subscribe(listener: () => void): Unsubscribe;
  subscribeSnapshot(listener: () => void): Unsubscribe;
  subscribeTransitions(listener: (event: DocumentStateEvent) => void): Unsubscribe;
  getSnapshot(): DocumentSnapshot;
  applyEditorChange(markdown: Markdown, origin: RendererMutationOrigin): DocumentMutationResult;
  reserveExternalEdit(request: {
    readonly operationId: string;
    readonly expectedGeneration: number;
    readonly expectedContentRevision: number;
  }): ExternalEditReservationResult;
  finalizeExternalEdit(
    reservation: ExternalEditReservation,
    rendererReceipt: RendererExternalEditReceipt,
  ): ExternalEditFinalizeReceipt;
  releaseExternalEdit(
    reservation: ExternalEditReservation,
    reason: ExternalEditReleaseReason,
  ): void;
  replaceDocument(
    input: ReplaceDocumentInput,
    origin: DocumentMutationOrigin,
  ): DocumentMutationResult;
  setDocumentPath(input: SetDocumentPathInput): DocumentMutationResult;
  commitMode(input: CommitModeInput): DocumentMutationResult;
  beginSave(destination: SaveDestination): DocumentSaveCheckpoint;
  settleSave(checkpoint: DocumentSaveCheckpoint, outcome: SaveOutcome): SettleSaveResult;
}

interface SaveRecord {
  readonly checkpoint: DocumentSaveCheckpoint;
  settled: boolean;
  candidate?: {
    readonly filePath: string;
  };
}

class DocumentProtocolInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentProtocolInvariantError";
  }
}

let nextDocumentStateInstanceId = 1;
let nextModeOperationSequence = 1;

function freezeOrigin<T extends DocumentMutationOrigin>(origin: T): T {
  return Object.freeze({ ...origin }) as T;
}

function freezePersistenceStatus(status: PersistenceStatus): PersistenceStatus {
  return Object.freeze({ ...status });
}

function createSnapshot(input: Omit<DocumentSnapshot, "isDirty">): DocumentSnapshot {
  return Object.freeze({
    ...input,
    isDirty: input.markdown !== input.savedMarkdown,
    persistenceStatus: freezePersistenceStatus(input.persistenceStatus),
  });
}

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

function freezeDestination(destination: SaveDestination): SaveDestination {
  return Object.freeze({ ...destination });
}

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

  function reportListenerError(error: unknown, context: DocumentListenerErrorContext): void {
    try {
      input.onListenerError?.(error, context);
    } catch {
      // Listener error reporting must never interrupt committed notification delivery.
    }
  }

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

  function blockedMutation(): MutationBusyResult | MutationRejectedResult | null {
    if (notifying) {
      return { status: "rejected", reason: "listener-reentrancy" };
    }
    if (activeReservation !== null) {
      return { status: "busy", activeOperationId: activeReservation.operationId };
    }
    return null;
  }

  function staleMutation(): MutationStaleResult {
    return {
      status: "stale",
      actualGeneration: currentSnapshot.documentGeneration,
      actualStateRevision: currentSnapshot.stateRevision,
      actualContentRevision: currentSnapshot.contentRevision,
    };
  }

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
        status: "finalized" as const,
        operationId: rendererReceipt.operationId,
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
    replaceDocument(next, origin) {
      const blocked = blockedMutation();
      if (blocked) {
        return blocked;
      }
      const markdown = normalizeLineEndings(next.markdown);
      const savedMarkdown = normalizeLineEndings(next.savedMarkdown ?? markdown);
      authoritativeSaveSequence = 0;
      verificationBarrierSequence = null;
      const nextSnapshot = createSnapshot({
        markdown,
        savedMarkdown,
        filePath: next.filePath ?? null,
        mode: next.mode ?? currentSnapshot.mode,
        documentGeneration: currentSnapshot.documentGeneration + 1,
        stateRevision: currentSnapshot.stateRevision + 1,
        contentRevision: 0,
        persistenceStatus: {
          kind: "verified",
          checkpointId: null,
          sequence: null,
        },
      });
      const event = commit(nextSnapshot, { kind: "document-replace", origin });
      return { status: "applied", snapshot: nextSnapshot, event };
    },
    setDocumentPath(next) {
      const blocked = blockedMutation();
      if (blocked) {
        return blocked;
      }
      if (
        next.expectedGeneration !== currentSnapshot.documentGeneration ||
        next.expectedStateRevision !== currentSnapshot.stateRevision
      ) {
        return staleMutation();
      }
      if (next.filePath === currentSnapshot.filePath) {
        return { status: "noop", snapshot: currentSnapshot };
      }
      const nextSnapshot = createSnapshot({
        ...currentSnapshot,
        filePath: next.filePath,
        stateRevision: currentSnapshot.stateRevision + 1,
      });
      const event = commit(nextSnapshot, { kind: "metadata", fields: ["filePath"] });
      return { status: "applied", snapshot: nextSnapshot, event };
    },
    commitMode(next) {
      const blocked = blockedMutation();
      if (blocked) {
        return blocked;
      }
      if (
        next.expectedGeneration !== currentSnapshot.documentGeneration ||
        next.expectedStateRevision !== currentSnapshot.stateRevision
      ) {
        return staleMutation();
      }
      if (next.mode === currentSnapshot.mode) {
        return { status: "noop", snapshot: currentSnapshot };
      }
      const nextSnapshot = createSnapshot({
        ...currentSnapshot,
        mode: next.mode,
        stateRevision: currentSnapshot.stateRevision + 1,
      });
      const event = commit(nextSnapshot, {
        kind: "mode",
        origin: next.origin,
        operationId: next.operationId,
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
      const checkpoint = Object.freeze({
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
