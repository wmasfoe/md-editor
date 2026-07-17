import {
  defaultKeymap,
  history,
  historyKeymap,
  isolateHistory,
  redoDepth,
  undoDepth,
} from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import {
  Compartment,
  EditorSelection,
  EditorState,
  Transaction,
  type Extension,
  type StateEffect,
  type TransactionSpec,
} from "@codemirror/state";
import { EditorView, keymap, lineNumbers, type ViewUpdate } from "@codemirror/view";
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
import { normalizeLineEndings, type Markdown } from "@md-editor/shared";
import { createModeExtensions, editorModeField, setEditorModeEffect } from "./mode.ts";
import {
  readRendererTransactionOrigin,
  rendererTransactionOrigin,
  type RendererTransactionOrigin,
} from "./origin.ts";

export interface CodeMirrorRendererOptions {
  readonly parent: HTMLElement;
  readonly initialSnapshot: DocumentSnapshot;
  readonly onEditorChange: (change: {
    readonly markdown: Markdown;
    readonly origin: {
      readonly kind: "renderer";
      readonly clientId: string;
      readonly sequence: number;
    };
  }) => void;
  readonly onQueuedExternalEditReady: (request: ExternalEditRequest) => void;
  readonly onQueuedExternalEditCancelled: (
    result: Extract<ExternalEditResult, { readonly status: "cancelled" }>,
  ) => void;
}

export interface ExternalEditRequest {
  readonly operationId: string;
  readonly markdown: Markdown;
  readonly expectedGeneration: number;
  readonly expectedContentRevision: number;
  readonly selection: "preserve-offset-clamped" | "start";
}

export type ExternalEditResult =
  | {
      readonly status: "applied";
      readonly receipt: RendererExternalEditReceipt;
      readonly transactionCount: 1;
    }
  | { readonly status: "queued-composition"; readonly operationId: string }
  | { readonly status: "noop" }
  | {
      readonly status: "stale";
      readonly actualGeneration: number;
      readonly actualContentRevision: number;
    }
  | {
      readonly status: "cancelled";
      readonly reason: "superseded" | "document-replaced" | "destroyed";
    }
  | { readonly status: "reconcile-required" };

export type LineNumberPortResult =
  { readonly status: "applied" } | { readonly status: "noop" } | { readonly status: "destroyed" };

export interface CodeMirrorRenderer {
  readonly clientId: string;
  sync(event: DocumentStateEvent): RendererSyncResult;
  reconcile(snapshot: DocumentSnapshot): RendererSyncResult;
  applyReservedExternalEdit(request: ExternalEditRequest): ExternalEditResult;
  applyMode(request: ModeRequest): ModePortResult;
  rollbackMode(receipt: ModeReceipt): void;
  setLineNumbers(enabled: boolean): LineNumberPortResult;
  setHostVisibility(hidden: boolean): void;
  focus(): void;
  requestMeasure(): void;
  destroy(): void;
}

export interface RendererViewAdapter {
  readonly state: EditorState;
  readonly isComposing: boolean;
  dispatch(spec: TransactionSpec): void;
  dispatchTransaction(transaction: Transaction): void;
  setState(state: EditorState): void;
  scrollSnapshot(): StateEffect<unknown>;
  getScrollTop(): number;
  setScrollTop(value: number): void;
  hasFocus(): boolean;
  focus(): void;
  requestMeasure(afterMeasure?: () => void): void;
  destroy(): void;
}

export interface RendererViewFactoryInput {
  readonly parent: HTMLElement;
  readonly state: EditorState;
  readonly onCompositionStart: () => void;
  readonly onCompositionEnd: () => void;
}

export type RendererViewFactory = (input: RendererViewFactoryInput) => RendererViewAdapter;

export interface RendererTestingProbeInternal {
  readonly clientId: string;
  readonly viewId: string;
  readonly stateEpochId: string;
  readonly rootExtensionId: string;
  readonly documentGeneration: number;
  readonly stateRevision: number;
  readonly contentRevision: number;
  readonly mode: EditorMode;
  readonly markdown: string;
  readonly selectionAnchor: number;
  readonly selectionHead: number;
  readonly selectionRangeCount: number;
  readonly scrollTop: number;
  readonly focused: boolean;
  readonly undoDepth: number;
  readonly redoDepth: number;
  readonly lineNumbersEnabled: boolean;
  readonly viewCreationCount: number;
  readonly viewDestructionCount: number;
  readonly explicitStateCreationCount: number;
  readonly stateReplacementCount: number;
  readonly documentTransactionCount: number;
  readonly modeTransactionCount: number;
  readonly externalEditTransactionCount: number;
  readonly reconciliationTransactionCount: number;
  readonly lineNumberTransactionCount: number;
  readonly measureRequestCount: number;
  readonly highestPublishedRendererSequence: number;
  readonly lastAcknowledgedRendererSequence: number;
  readonly queuedExternalEditOperationId: string | null;
  readonly pendingExternalEditOperationId: string | null;
  readonly pendingModeOperationId: string | null;
  readonly persistenceStatus: DocumentSnapshot["persistenceStatus"]["kind"];
  readonly lastSyncStatus: RendererSyncResult["status"] | null;
  readonly lastErrorCode: string | null;
  readonly destroyed: boolean;
}

class DomRendererViewAdapter implements RendererViewAdapter {
  readonly #view: EditorView;

  constructor(input: RendererViewFactoryInput) {
    this.#view = new EditorView({ state: input.state, parent: input.parent });
  }

  get state(): EditorState {
    return this.#view.state;
  }

  get isComposing(): boolean {
    return this.#view.compositionStarted;
  }

  dispatch(spec: TransactionSpec): void {
    this.#view.dispatch(spec);
  }

  dispatchTransaction(transaction: Transaction): void {
    this.#view.dispatch(transaction);
  }

  setState(state: EditorState): void {
    this.#view.setState(state);
  }

  scrollSnapshot(): StateEffect<unknown> {
    return this.#view.scrollSnapshot();
  }

  getScrollTop(): number {
    return this.#view.scrollDOM.scrollTop;
  }

  setScrollTop(value: number): void {
    this.#view.scrollDOM.scrollTop = value;
  }

  hasFocus(): boolean {
    return this.#view.hasFocus;
  }

  focus(): void {
    this.#view.focus();
  }

  requestMeasure(afterMeasure?: () => void): void {
    this.#view.requestMeasure();
    if (afterMeasure) {
      const frame = this.#view.dom.ownerDocument.defaultView;
      if (frame) {
        frame.requestAnimationFrame(afterMeasure);
      } else {
        queueMicrotask(afterMeasure);
      }
    }
  }

  destroy(): void {
    this.#view.destroy();
  }
}

const controllerByRenderer = new WeakMap<CodeMirrorRenderer, CodeMirrorRendererController>();
let nextRendererId = 1;

function isNonNegativeSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function clampOffset(offset: number, documentLength: number): number {
  return Math.max(0, Math.min(offset, documentLength));
}

function freezeExternalRequest(request: ExternalEditRequest): ExternalEditRequest {
  return Object.freeze({ ...request });
}

function validateExternalRequest(request: ExternalEditRequest): void {
  if (
    request.operationId.length === 0 ||
    !isNonNegativeSafeInteger(request.expectedGeneration) ||
    !isNonNegativeSafeInteger(request.expectedContentRevision)
  ) {
    throw new Error("External edit requests require an id and non-negative safe revisions.");
  }
}

function validateModeRequest(request: ModeRequest): void {
  if (
    request.operationId.length === 0 ||
    !isNonNegativeSafeInteger(request.expectedGeneration) ||
    !isNonNegativeSafeInteger(request.expectedStateRevision)
  ) {
    throw new Error("Mode requests require an id and non-negative safe revisions.");
  }
}

class CodeMirrorRendererController {
  readonly clientId: string;
  readonly #viewId: string;
  readonly #rootExtensionId: string;
  readonly #options: CodeMirrorRendererOptions;
  readonly #modeCompartment = new Compartment();
  readonly #lineNumberCompartment = new Compartment();
  readonly #rootExtensions: readonly Extension[];
  readonly #view: RendererViewAdapter;

  #stateEpochSequence = 1;
  #stateEpochId: string;
  #documentGeneration: number;
  #stateRevision: number;
  #contentRevision: number;
  #persistenceStatus: DocumentSnapshot["persistenceStatus"]["kind"];
  #lineNumbersEnabled = false;
  #compositionActive = false;
  #queuedExternalEdit: ExternalEditRequest | null = null;
  #pendingExternalEdit: ExternalEditRequest | null = null;
  #pendingModeReceipt: ModeReceipt | null = null;
  #pendingLocalSequences: number[] = [];
  #highestPublishedRendererSequence = 0;
  #lastAcknowledgedRendererSequence = 0;
  #viewDestructionCount = 0;
  #explicitStateCreationCount = 0;
  #stateReplacementCount = 0;
  #documentTransactionCount = 0;
  #modeTransactionCount = 0;
  #externalEditTransactionCount = 0;
  #reconciliationTransactionCount = 0;
  #lineNumberTransactionCount = 0;
  #measureRequestCount = 0;
  #lastSyncStatus: RendererSyncResult["status"] | null = null;
  #lastErrorCode: string | null = null;
  #hiddenViewState: { readonly focused: boolean; readonly scrollTop: number } | null = null;
  #visibilityRestoreSequence = 0;
  #destroyed = false;

  constructor(options: CodeMirrorRendererOptions, viewFactory: RendererViewFactory) {
    const rendererId = nextRendererId++;
    this.clientId = `cm-client-${rendererId}`;
    this.#viewId = `cm-view-${rendererId}`;
    this.#rootExtensionId = `cm-root-${rendererId}`;
    this.#stateEpochId = `cm-state-${rendererId}-${this.#stateEpochSequence}`;
    this.#options = options;

    const initialSnapshot = options.initialSnapshot;
    this.#documentGeneration = initialSnapshot.documentGeneration;
    this.#stateRevision = initialSnapshot.stateRevision;
    this.#contentRevision = initialSnapshot.contentRevision;
    this.#persistenceStatus = initialSnapshot.persistenceStatus.kind;

    this.#rootExtensions = Object.freeze([
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      markdown(),
      editorModeField,
      EditorView.updateListener.of((update) => this.#handleViewUpdate(update)),
      EditorView.domEventObservers({
        compositionstart: () => this.#startComposition(),
        compositionend: () => {
          // CM6 may schedule its final DOM mutation flush from compositionend.
          // Run after that microtask so the local core revision wins stale checks.
          queueMicrotask(() => queueMicrotask(() => this.#finishComposition()));
        },
      }),
    ]);

    const initialState = this.#createState(initialSnapshot);
    this.#view = viewFactory({
      parent: options.parent,
      state: initialState,
      onCompositionStart: () => this.#startComposition(),
      onCompositionEnd: () => this.#finishComposition(),
    });
  }

  get probe(): RendererTestingProbeInternal {
    const selection = this.#view.state.selection;
    return Object.freeze({
      clientId: this.clientId,
      viewId: this.#viewId,
      stateEpochId: this.#stateEpochId,
      rootExtensionId: this.#rootExtensionId,
      documentGeneration: this.#documentGeneration,
      stateRevision: this.#stateRevision,
      contentRevision: this.#contentRevision,
      mode: this.#currentMode(),
      markdown: this.#view.state.doc.toString(),
      selectionAnchor: selection.main.anchor,
      selectionHead: selection.main.head,
      selectionRangeCount: selection.ranges.length,
      scrollTop: this.#view.getScrollTop(),
      focused: this.#view.hasFocus(),
      undoDepth: undoDepth(this.#view.state),
      redoDepth: redoDepth(this.#view.state),
      lineNumbersEnabled: this.#lineNumbersEnabled,
      viewCreationCount: 1,
      viewDestructionCount: this.#viewDestructionCount,
      explicitStateCreationCount: this.#explicitStateCreationCount,
      stateReplacementCount: this.#stateReplacementCount,
      documentTransactionCount: this.#documentTransactionCount,
      modeTransactionCount: this.#modeTransactionCount,
      externalEditTransactionCount: this.#externalEditTransactionCount,
      reconciliationTransactionCount: this.#reconciliationTransactionCount,
      lineNumberTransactionCount: this.#lineNumberTransactionCount,
      measureRequestCount: this.#measureRequestCount,
      highestPublishedRendererSequence: this.#highestPublishedRendererSequence,
      lastAcknowledgedRendererSequence: this.#lastAcknowledgedRendererSequence,
      queuedExternalEditOperationId: this.#queuedExternalEdit?.operationId ?? null,
      pendingExternalEditOperationId: this.#pendingExternalEdit?.operationId ?? null,
      pendingModeOperationId: this.#pendingModeReceipt?.operationId ?? null,
      persistenceStatus: this.#persistenceStatus,
      lastSyncStatus: this.#lastSyncStatus,
      lastErrorCode: this.#lastErrorCode,
      destroyed: this.#destroyed,
    });
  }

  sync(event: DocumentStateEvent): RendererSyncResult {
    const snapshot = event.snapshot;
    const eventMarkdown = normalizeLineEndings(snapshot.markdown);

    if (this.#destroyed) {
      return this.#reconcileRequired(snapshot.stateRevision);
    }

    if (snapshot.documentGeneration < this.#documentGeneration) {
      return this.#recordSyncResult({
        status: "stale-generation",
        rendererGeneration: this.#documentGeneration,
        eventGeneration: snapshot.documentGeneration,
      });
    }

    if (snapshot.documentGeneration > this.#documentGeneration) {
      if (event.transition.kind !== "document-replace") {
        return this.#reconcileRequired(snapshot.stateRevision);
      }
      this.#installDocumentBoundary(snapshot);
      return this.#recordSyncResult({ status: "applied", transactionCount: 1 });
    }

    if (event.transition.kind === "document-replace") {
      if (snapshot.stateRevision <= this.#stateRevision) {
        return this.#recordSyncResult({ status: "duplicate", transactionCount: 0 });
      }
      return this.#reconcileRequired(snapshot.stateRevision);
    }

    if (event.transition.kind === "content" && event.transition.origin.kind === "renderer") {
      const sequence = event.transition.origin.sequence;
      if (event.transition.origin.clientId !== this.clientId) {
        return this.#reconcileRequired(snapshot.stateRevision);
      }
      if (sequence <= this.#lastAcknowledgedRendererSequence) {
        return this.#recordSyncResult({ status: "duplicate", transactionCount: 0 });
      }
      if (
        sequence > this.#highestPublishedRendererSequence ||
        sequence !== this.#pendingLocalSequences[0]
      ) {
        return this.#reconcileRequired(snapshot.stateRevision);
      }
    }

    if (snapshot.stateRevision <= this.#stateRevision) {
      return this.#recordSyncResult({ status: "duplicate", transactionCount: 0 });
    }
    if (snapshot.stateRevision !== this.#stateRevision + 1) {
      return this.#reconcileRequired(snapshot.stateRevision);
    }

    const currentMarkdown = this.#view.state.doc.toString();
    const currentMode = this.#currentMode();

    switch (event.transition.kind) {
      case "content": {
        if (
          eventMarkdown !== currentMarkdown ||
          snapshot.mode !== currentMode ||
          snapshot.contentRevision !== this.#contentRevision + 1
        ) {
          return this.#reconcileRequired(snapshot.stateRevision);
        }

        if (event.transition.origin.kind === "renderer") {
          const sequence = this.#pendingLocalSequences.shift();
          if (sequence === undefined) {
            return this.#reconcileRequired(snapshot.stateRevision);
          }
          this.#lastAcknowledgedRendererSequence = sequence;
        } else if (this.#pendingExternalEdit?.operationId === event.transition.operationId) {
          this.#pendingExternalEdit = null;
        } else {
          return this.#reconcileRequired(snapshot.stateRevision);
        }
        break;
      }
      case "mode": {
        if (
          eventMarkdown !== currentMarkdown ||
          snapshot.contentRevision !== this.#contentRevision ||
          snapshot.mode !== currentMode ||
          this.#pendingModeReceipt?.operationId !== event.transition.operationId ||
          this.#pendingModeReceipt.appliedMode !== snapshot.mode
        ) {
          return this.#reconcileRequired(snapshot.stateRevision);
        }
        this.#pendingModeReceipt = null;
        break;
      }
      case "metadata":
      case "save-settled":
      case "save-verification-required": {
        if (
          eventMarkdown !== currentMarkdown ||
          snapshot.mode !== currentMode ||
          snapshot.contentRevision !== this.#contentRevision
        ) {
          return this.#reconcileRequired(snapshot.stateRevision);
        }
        break;
      }
    }

    this.#acceptSnapshotBookkeeping(snapshot);
    return this.#recordSyncResult({ status: "acknowledged", transactionCount: 0 });
  }

  reconcile(snapshot: DocumentSnapshot): RendererSyncResult {
    if (this.#destroyed) {
      return this.#reconcileRequired(snapshot.stateRevision);
    }
    if (snapshot.documentGeneration < this.#documentGeneration) {
      return this.#recordSyncResult({
        status: "stale-generation",
        rendererGeneration: this.#documentGeneration,
        eventGeneration: snapshot.documentGeneration,
      });
    }
    if (snapshot.documentGeneration > this.#documentGeneration) {
      this.#installDocumentBoundary(snapshot);
      return this.#recordSyncResult({
        status: "reconciled",
        strategy: "document-boundary",
      });
    }
    if (snapshot.stateRevision < this.#stateRevision) {
      return this.#recordSyncResult({ status: "duplicate", transactionCount: 0 });
    }

    const markdownLf = normalizeLineEndings(snapshot.markdown);
    const currentMarkdown = this.#view.state.doc.toString();
    const modeChanged = snapshot.mode !== this.#currentMode();
    if (markdownLf === currentMarkdown && !modeChanged) {
      this.#clearPendingProtocolState();
      this.#acceptSnapshotBookkeeping(snapshot);
      return this.#recordSyncResult({
        status: "reconciled",
        strategy: "revision-only",
      });
    }

    const effects: StateEffect<unknown>[] = [];
    if (modeChanged) {
      effects.push(
        setEditorModeEffect.of(snapshot.mode),
        this.#modeCompartment.reconfigure(createModeExtensions(snapshot.mode)),
      );
    }
    const nextSelection = this.#clampedSelection(markdownLf.length);
    this.#view.dispatch({
      ...(markdownLf === currentMarkdown
        ? {}
        : {
            changes: { from: 0, to: this.#view.state.doc.length, insert: markdownLf },
            selection: nextSelection,
          }),
      effects,
      annotations: [
        Transaction.addToHistory.of(false),
        isolateHistory.of("full"),
        rendererTransactionOrigin.of({ kind: "reconcile" }),
      ],
    });
    this.#clearPendingProtocolState();
    this.#acceptSnapshotBookkeeping(snapshot);
    return this.#recordSyncResult({
      status: "reconciled",
      strategy: "isolated-transaction",
    });
  }

  applyReservedExternalEdit(request: ExternalEditRequest): ExternalEditResult {
    validateExternalRequest(request);
    if (this.#destroyed) {
      return { status: "cancelled", reason: "destroyed" };
    }
    if (
      request.expectedGeneration !== this.#documentGeneration ||
      request.expectedContentRevision !== this.#contentRevision
    ) {
      return {
        status: "stale",
        actualGeneration: this.#documentGeneration,
        actualContentRevision: this.#contentRevision,
      };
    }
    if (
      this.#pendingLocalSequences.length > 0 ||
      this.#pendingExternalEdit !== null ||
      this.#pendingModeReceipt !== null
    ) {
      return { status: "reconcile-required" };
    }

    const frozenRequest = freezeExternalRequest({
      ...request,
      markdown: normalizeLineEndings(request.markdown),
    });
    if (this.#compositionActive || this.#view.isComposing) {
      if (this.#queuedExternalEdit !== null) {
        this.#notifyQueuedCancellation("superseded");
      }
      this.#queuedExternalEdit = frozenRequest;
      return { status: "queued-composition", operationId: request.operationId };
    }
    if (frozenRequest.markdown === this.#view.state.doc.toString()) {
      return { status: "noop" };
    }

    this.#pendingExternalEdit = frozenRequest;
    try {
      const selection =
        frozenRequest.selection === "start"
          ? EditorSelection.single(0)
          : this.#clampedSelection(frozenRequest.markdown.length);
      this.#view.dispatch({
        changes: {
          from: 0,
          to: this.#view.state.doc.length,
          insert: frozenRequest.markdown,
        },
        selection,
        annotations: [
          Transaction.addToHistory.of(true),
          isolateHistory.of("full"),
          rendererTransactionOrigin.of({
            kind: "external-edit",
            operationId: frozenRequest.operationId,
          }),
        ],
      });
    } catch {
      this.#pendingExternalEdit = null;
      this.#lastErrorCode = "EXTERNAL_EDIT_DISPATCH_FAILED";
      return { status: "reconcile-required" };
    }

    const receipt: RendererExternalEditReceipt = Object.freeze({
      operationId: frozenRequest.operationId,
      markdown: this.#view.state.doc.toString(),
      viewId: this.#viewId,
      stateEpochId: this.#stateEpochId,
      transactionSequence: this.#documentTransactionCount,
    });
    return { status: "applied", receipt, transactionCount: 1 };
  }

  applyMode(request: ModeRequest): ModePortResult {
    validateModeRequest(request);
    if (this.#destroyed) {
      return { status: "failed", errorCode: "RENDERER_DESTROYED" };
    }
    if (
      request.expectedGeneration !== this.#documentGeneration ||
      request.expectedStateRevision !== this.#stateRevision
    ) {
      return {
        status: "stale",
        actualGeneration: this.#documentGeneration,
        actualStateRevision: this.#stateRevision,
      };
    }
    if (
      this.#pendingLocalSequences.length > 0 ||
      this.#pendingExternalEdit !== null ||
      this.#pendingModeReceipt !== null
    ) {
      return { status: "reconcile-required" };
    }

    const previousMode = this.#currentMode();
    if (request.mode === previousMode) {
      return { status: "noop" };
    }

    const receipt: ModeReceipt = Object.freeze({
      operationId: request.operationId,
      clientId: this.clientId,
      documentGeneration: this.#documentGeneration,
      expectedStateRevision: request.expectedStateRevision,
      previousMode,
      appliedMode: request.mode,
      viewId: this.#viewId,
      stateEpochId: this.#stateEpochId,
    });
    this.#pendingModeReceipt = receipt;
    try {
      this.#dispatchModeChange(request.mode, {
        kind: "mode",
        operationId: request.operationId,
      });
    } catch {
      this.#pendingModeReceipt = null;
      this.#lastErrorCode = "MODE_DISPATCH_FAILED";
      return { status: "failed", errorCode: "MODE_DISPATCH_FAILED" };
    }
    return { status: "applied", receipt };
  }

  rollbackMode(receipt: ModeReceipt): void {
    if (
      this.#destroyed ||
      this.#pendingModeReceipt !== receipt ||
      receipt.clientId !== this.clientId ||
      receipt.viewId !== this.#viewId ||
      receipt.stateEpochId !== this.#stateEpochId ||
      this.#currentMode() !== receipt.appliedMode
    ) {
      throw new Error("Mode rollback receipt is stale or does not belong to this renderer.");
    }
    this.#dispatchModeChange(receipt.previousMode, {
      kind: "mode-rollback",
      operationId: receipt.operationId,
    });
    this.#pendingModeReceipt = null;
  }

  setLineNumbers(enabled: boolean): LineNumberPortResult {
    if (this.#destroyed) {
      return { status: "destroyed" };
    }
    if (enabled === this.#lineNumbersEnabled) {
      return { status: "noop" };
    }
    this.#view.dispatch({
      effects: this.#lineNumberCompartment.reconfigure(enabled ? lineNumbers() : []),
      annotations: [
        Transaction.addToHistory.of(false),
        rendererTransactionOrigin.of({ kind: "line-numbers" }),
      ],
    });
    this.#lineNumbersEnabled = enabled;
    return { status: "applied" };
  }

  setHostVisibility(hidden: boolean): void {
    if (this.#destroyed) {
      return;
    }
    if (hidden) {
      this.#visibilityRestoreSequence += 1;
      this.#hiddenViewState ??= Object.freeze({
        focused: this.#view.hasFocus(),
        scrollTop: this.#view.getScrollTop(),
      });
      return;
    }

    const previous = this.#hiddenViewState;
    if (previous === null) {
      return;
    }
    this.#hiddenViewState = null;
    const restoreSequence = ++this.#visibilityRestoreSequence;
    if (previous.focused) {
      this.#view.focus();
    }
    // CodeMirror may still adjust its scroll anchor during the requested measure.
    this.#view.setScrollTop(previous.scrollTop);
    this.#requestMeasure(() => {
      if (
        !this.#destroyed &&
        this.#hiddenViewState === null &&
        restoreSequence === this.#visibilityRestoreSequence
      ) {
        this.#view.setScrollTop(previous.scrollTop);
      }
    });
  }

  focus(): void {
    if (!this.#destroyed) {
      this.#view.focus();
    }
  }

  requestMeasure(): void {
    if (!this.#destroyed) {
      this.#requestMeasure();
    }
  }

  destroy(): void {
    if (this.#destroyed) {
      return;
    }
    const notifyQueuedCancellation = this.#queuedExternalEdit !== null;
    this.#queuedExternalEdit = null;
    this.#compositionActive = false;
    this.#hiddenViewState = null;
    this.#visibilityRestoreSequence += 1;
    this.#destroyed = true;
    this.#view.destroy();
    this.#viewDestructionCount += 1;
    this.#pendingExternalEdit = null;
    this.#pendingModeReceipt = null;
    this.#pendingLocalSequences = [];
    if (notifyQueuedCancellation) {
      this.#notifyCancellation("destroyed");
    }
  }

  #requestMeasure(afterMeasure?: () => void): void {
    this.#measureRequestCount += 1;
    this.#view.requestMeasure(afterMeasure);
  }

  #createState(snapshot: DocumentSnapshot): EditorState {
    this.#explicitStateCreationCount += 1;
    return EditorState.create({
      doc: normalizeLineEndings(snapshot.markdown),
      selection: EditorSelection.single(0),
      extensions: [
        ...this.#rootExtensions,
        this.#modeCompartment.of(createModeExtensions(snapshot.mode)),
        this.#lineNumberCompartment.of(this.#lineNumbersEnabled ? lineNumbers() : []),
      ],
    });
  }

  #currentMode(): EditorMode {
    return this.#view.state.field(editorModeField);
  }

  #handleViewUpdate(update: ViewUpdate): void {
    const documentTransactions = update.transactions.filter(
      (transaction) => transaction.docChanged,
    );
    if (documentTransactions.length === 0) {
      for (const transaction of update.transactions) {
        this.#countInternalTransaction(readRendererTransactionOrigin(transaction));
      }
      return;
    }

    this.#documentTransactionCount += documentTransactions.length;
    const localTransactions: Transaction[] = [];
    for (const transaction of update.transactions) {
      const origin = readRendererTransactionOrigin(transaction);
      this.#countInternalTransaction(origin);
      if (transaction.docChanged && origin === undefined) {
        localTransactions.push(transaction);
      }
    }
    if (localTransactions.length === 0) {
      return;
    }
    if (localTransactions.length !== documentTransactions.length) {
      this.#lastErrorCode = "MIXED_LOCAL_AND_INTERNAL_TRANSACTIONS";
      return;
    }

    this.#highestPublishedRendererSequence += 1;
    const sequence = this.#highestPublishedRendererSequence;
    this.#pendingLocalSequences.push(sequence);
    const markdownLf = update.state.doc.toString();
    if (markdownLf.includes("\r")) {
      this.#lastErrorCode = "NON_LF_RENDERER_OUTPUT";
      throw new Error("CodeMirror produced non-LF Markdown.");
    }
    this.#options.onEditorChange({
      markdown: markdownLf,
      origin: Object.freeze({ kind: "renderer", clientId: this.clientId, sequence }),
    });
  }

  #countInternalTransaction(origin: RendererTransactionOrigin | undefined): void {
    switch (origin?.kind) {
      case "external-edit":
        this.#externalEditTransactionCount += 1;
        break;
      case "reconcile":
        this.#reconciliationTransactionCount += 1;
        break;
      case "mode":
      case "mode-rollback":
        this.#modeTransactionCount += 1;
        break;
      case "line-numbers":
        this.#lineNumberTransactionCount += 1;
        break;
    }
  }

  #dispatchModeChange(mode: EditorMode, origin: RendererTransactionOrigin): void {
    const scrollSnapshot = this.#view.scrollSnapshot();
    this.#view.dispatch({
      effects: [
        setEditorModeEffect.of(mode),
        this.#modeCompartment.reconfigure(createModeExtensions(mode)),
        scrollSnapshot,
      ],
      annotations: [Transaction.addToHistory.of(false), rendererTransactionOrigin.of(origin)],
    });
  }

  #clampedSelection(documentLength: number): EditorSelection {
    const current = this.#view.state.selection;
    return EditorSelection.create(
      current.ranges.map((range) =>
        EditorSelection.range(
          clampOffset(range.anchor, documentLength),
          clampOffset(range.head, documentLength),
        ),
      ),
      current.mainIndex,
    );
  }

  #installDocumentBoundary(snapshot: DocumentSnapshot): void {
    const notifyQueuedCancellation = this.#queuedExternalEdit !== null;
    this.#queuedExternalEdit = null;
    this.#compositionActive = false;
    this.#hiddenViewState = null;
    this.#visibilityRestoreSequence += 1;
    this.#clearPendingProtocolState();
    const nextState = this.#createState(snapshot);
    this.#view.setState(nextState);
    this.#view.setScrollTop(0);
    this.#stateReplacementCount += 1;
    this.#stateEpochSequence += 1;
    this.#stateEpochId = `${this.#viewId.replace("view", "state")}-${this.#stateEpochSequence}`;
    this.#acceptSnapshotBookkeeping(snapshot);
    if (notifyQueuedCancellation) {
      this.#notifyCancellation("document-replaced");
    }
  }

  #clearPendingProtocolState(): void {
    this.#pendingExternalEdit = null;
    this.#pendingModeReceipt = null;
    this.#pendingLocalSequences = [];
    this.#lastAcknowledgedRendererSequence = this.#highestPublishedRendererSequence;
  }

  #acceptSnapshotBookkeeping(snapshot: DocumentSnapshot): void {
    this.#documentGeneration = snapshot.documentGeneration;
    this.#stateRevision = snapshot.stateRevision;
    this.#contentRevision = snapshot.contentRevision;
    this.#persistenceStatus = snapshot.persistenceStatus.kind;
  }

  #reconcileRequired(receivedStateRevision: number): RendererSyncResult {
    this.#lastErrorCode = "RECONCILE_REQUIRED";
    return this.#recordSyncResult({
      status: "reconcile-required",
      expectedStateRevision: this.#stateRevision + 1,
      receivedStateRevision,
    });
  }

  #recordSyncResult<T extends RendererSyncResult>(result: T): T {
    this.#lastSyncStatus = result.status;
    if (result.status !== "reconcile-required" && this.#lastErrorCode === "RECONCILE_REQUIRED") {
      this.#lastErrorCode = null;
    }
    return result;
  }

  #notifyQueuedCancellation(
    reason: Extract<ExternalEditResult, { readonly status: "cancelled" }>["reason"],
  ): void {
    if (this.#queuedExternalEdit === null) {
      return;
    }
    this.#queuedExternalEdit = null;
    this.#notifyCancellation(reason);
  }

  #notifyCancellation(
    reason: Extract<ExternalEditResult, { readonly status: "cancelled" }>["reason"],
  ): void {
    try {
      this.#options.onQueuedExternalEditCancelled({ status: "cancelled", reason });
    } catch {
      this.#lastErrorCode = "QUEUED_CANCELLATION_CALLBACK_FAILED";
    }
  }

  #startComposition(): void {
    this.#compositionActive = true;
  }

  #finishComposition(): void {
    this.#compositionActive = false;
    const request = this.#queuedExternalEdit;
    this.#queuedExternalEdit = null;
    if (request === null || this.#destroyed) {
      return;
    }
    try {
      this.#options.onQueuedExternalEditReady(request);
    } catch {
      this.#lastErrorCode = "QUEUED_READY_CALLBACK_FAILED";
    }
  }
}

function createRendererFacade(controller: CodeMirrorRendererController): CodeMirrorRenderer {
  const renderer: CodeMirrorRenderer = Object.freeze({
    clientId: controller.clientId,
    sync: (event: DocumentStateEvent) => controller.sync(event),
    reconcile: (snapshot: DocumentSnapshot) => controller.reconcile(snapshot),
    applyReservedExternalEdit: (request: ExternalEditRequest) =>
      controller.applyReservedExternalEdit(request),
    applyMode: (request: ModeRequest) => controller.applyMode(request),
    rollbackMode: (receipt: ModeReceipt) => controller.rollbackMode(receipt),
    setLineNumbers: (enabled: boolean) => controller.setLineNumbers(enabled),
    setHostVisibility: (hidden: boolean) => controller.setHostVisibility(hidden),
    focus: () => controller.focus(),
    requestMeasure: () => controller.requestMeasure(),
    destroy: () => controller.destroy(),
  });
  controllerByRenderer.set(renderer, controller);
  return renderer;
}

export function createCodeMirrorRenderer(options: CodeMirrorRendererOptions): CodeMirrorRenderer {
  return createCodeMirrorRendererWithFactory(options, (input) => new DomRendererViewAdapter(input));
}

/** @internal Exported only for the package's state-backed protocol test harness. */
export function createCodeMirrorRendererWithFactory(
  options: CodeMirrorRendererOptions,
  viewFactory: RendererViewFactory,
): CodeMirrorRenderer {
  return createRendererFacade(new CodeMirrorRendererController(options, viewFactory));
}

/** @internal Exported only through `@md-editor/renderer-codemirror/testing`. */
export function inspectRendererForTesting(
  renderer: CodeMirrorRenderer,
): RendererTestingProbeInternal {
  const controller = controllerByRenderer.get(renderer);
  if (!controller) {
    throw new Error("Renderer was not created by this package instance.");
  }
  return controller.probe;
}
