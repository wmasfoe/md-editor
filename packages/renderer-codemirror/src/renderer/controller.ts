/**
 * @file controller.ts
 * @description CodeMirror 渲染器控制器：持有协议状态、编排视图与投影扩展，并驱动端口语义。
 *
 * 本模块只保留"状态持有 + 编排"残余；可独立成簇的行为已抽为接收显式上下文的协作器：
 * - 模式切换视口/光标记忆 → `controller/mode-viewport.ts`
 * - 语法插件注册/替换 → `controller/plugin-management.ts`
 * - 选区钳制 → `controller/selection.ts`
 * - 文档协议与本地事务发布 → `controller/document-protocol.ts`
 * - 根扩展装配 → `controller/root-extensions.ts`
 *
 * 对外门面（`CodeMirrorRenderer`）由 `renderer/index.ts` 在控制器之后装配，避免 TDZ。
 */

import {
  Compartment,
  EditorSelection,
  EditorState,
  Transaction,
  type Extension,
  type StateEffect,
} from "@codemirror/state";
import type { EditorView, ViewUpdate } from "@codemirror/view";
import type {
  DocumentSnapshot,
  DocumentStateEvent,
  EditorMode,
  ModePortResult,
  ModeReceipt,
  ModeRequest,
  RendererSyncResult,
} from "@md-editor/editor-core";
import { normalizeLineEndings } from "@md-editor/shared";
import { WysiwygDiagnostics } from "../diagnostics.ts";
import { createModeExtensions, editorModeField } from "../mode.ts";
import { rendererTransactionOrigin, type RendererTransactionOrigin } from "../origin.ts";
import type { MarkdownSyntaxPlugin } from "../plugins/syntax-plugin.ts";
import { SyntaxPluginRegistry } from "../plugins/syntax-registry.ts";
import {
  deleteBlock,
  duplicateBlock,
  moveBlockDown,
  moveBlockUp,
} from "../wysiwyg/blocks/block-move.ts";
import { typewriterModeInitialFacet } from "../wysiwyg/input/typewriter-mode.ts";
import {
  initialCodeBlockLineNumbersFacet,
  setCodeBlockLineNumbersEffect,
} from "../wysiwyg/projections/code-block-projection.ts";
import {
  initialInlineStyleMarkersFacet,
  setInlineStyleMarkersEffect,
} from "../wysiwyg/projections/inline-heading.ts";
import { focusModeInitialFacet } from "../wysiwyg/view/focus-mode.ts";
import {
  acceptAiSuggestion,
  aiSuggestionField,
  aiSuggestionLabelsFacet,
  dismissAiSuggestion,
  setAiSuggestionEffect,
  type AiSuggestionInput,
  type AiSuggestionLabels,
  type AiSuggestionValue,
} from "../wysiwyg/view/suggestion.ts";
import {
  dispatchModeChangeWithMemory,
  type ModeViewportContext,
} from "./controller/mode-viewport.ts";
import {
  registerSyntaxPlugins,
  replaceSyntaxPlugins,
  type SyntaxPluginContext,
} from "./controller/plugin-management.ts";
import { clampSelection } from "./controller/selection.ts";
import { TransactionLedger } from "./controller/transaction-ledger.ts";
import {
  flushPendingViewEdits,
  readSelectionSnapshot,
  readViewModeState,
  scrollViewToLine,
  setViewSelection,
  toggleViewFocusMode,
  toggleViewTypewriterMode,
} from "./controller/view-operations.ts";
import type {
  CodeBlockLineNumberPortResult,
  InlineStyleMarkerPortResult,
  MarkdownLintPortResult,
  CodeMirrorRendererControllerOptions,
  CodeMirrorRendererOptions,
  ExternalEditRequest,
  ExternalEditResult,
  RendererViewAdapter,
  RendererViewFactory,
  RendererTestingProbeInternal,
  ViewAxisState,
} from "./types.ts";
import {
  handleViewUpdate,
  sync,
  reconcile,
  applyReservedExternalEdit,
  applyMode,
  rollbackMode,
  type DocumentProtocolContext,
} from "./controller/document-protocol.ts";
import { createRootExtensions } from "./controller/root-extensions.ts";

import { createRendererProbe } from "./controller/probe.ts";
import { setHostVisibility } from "./controller/host-visibility.ts";

import { startComposition, finishComposition } from "./controller/composition.ts";
import {
  executeDocumentLint,
  collectPreservedNonMarkdownDiagnostics,
  createRealtimeMarkdownLintExtension,
  runMarkdownLint,
  runMarkdownLintCommand,
  fixAllMarkdownLintIssues,
  clearMarkdownLintCommand,
  type DocumentLinterOptions,
  type MarkdownLintRunResult,
  type MarkdownLintFixAllResult,
} from "../lint/index.ts";
import { setDiagnostics, type Diagnostic } from "@codemirror/lint";

let nextRendererId = 1;

export class CodeMirrorRendererController {
  readonly clientId: string;
  readonly #viewId: string;
  readonly #rootExtensionId: string;
  readonly #options: CodeMirrorRendererOptions;
  readonly #controllerOptions: CodeMirrorRendererControllerOptions;
  readonly #modeCompartment = new Compartment();
  readonly #markdownLanguageCompartment = new Compartment();
  readonly #syntaxRegistryCompartment = new Compartment();
  readonly #aiSuggestionLabelsCompartment = new Compartment();
  readonly #markdownLintCompartment = new Compartment();
  readonly #syntaxRegistry: SyntaxPluginRegistry;
  readonly #rootExtensions: readonly Extension[];
  readonly #view: RendererViewAdapter;
  readonly #wysiwygDiagnostics = new WysiwygDiagnostics();

  #stateEpochSequence = 1;
  #stateEpochId: string;
  #documentGeneration: number;
  #stateRevision: number;
  #contentRevision: number;
  #persistenceStatus: DocumentSnapshot["persistenceStatus"]["kind"];
  #codeBlockLineNumbers = false;
  #inlineStyleMarkers = false;
  #markdownLintEnabled = false;
  #aiSuggestionLabels: AiSuggestionLabels | undefined;
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
  readonly #ledger = new TransactionLedger();
  #lastSyncStatus: RendererSyncResult["status"] | null = null;
  #lastErrorCode: string | null = null;
  #hiddenViewState: { readonly focused: boolean; readonly scrollTop: number } | null = null;
  #visibilityRestoreSequence = 0;
  #modeScrollRestoreSequence = 0;
  /** S7：快照重装载后的滚动恢复序列（防过期回调覆盖用户滚动） */
  #reconcileScrollRestoreSequence = 0;
  readonly #modeScrollTopsByMode = new Map<EditorMode, number>();
  readonly #modeCursorPosByMode = new Map<EditorMode, number>();
  #destroyed = false;

  constructor(
    options: CodeMirrorRendererOptions,
    viewFactory: RendererViewFactory,
    controllerOptions: CodeMirrorRendererControllerOptions,
  ) {
    const rendererId = nextRendererId++;
    this.clientId = `cm-client-${rendererId}`;
    this.#viewId = `cm-view-${rendererId}`;
    this.#rootExtensionId = `cm-root-${rendererId}`;
    this.#stateEpochId = `cm-state-${rendererId}-${this.#stateEpochSequence}`;
    this.#options = options;
    this.#controllerOptions = controllerOptions;
    this.#aiSuggestionLabels = options.aiSuggestionLabels;

    const initialSnapshot = options.initialSnapshot;
    this.#documentGeneration = initialSnapshot.documentGeneration;
    this.#stateRevision = initialSnapshot.stateRevision;
    this.#contentRevision = initialSnapshot.contentRevision;
    this.#persistenceStatus = initialSnapshot.persistenceStatus.kind;
    this.#markdownLintEnabled = options.enableMarkdownLint ?? false;

    const initialPlugins = options.plugins ?? options.syntaxPlugins ?? [];
    this.#syntaxRegistry = new SyntaxPluginRegistry(initialPlugins);
    this.#rootExtensions = createRootExtensions({
      aiSuggestionLabels: this.#aiSuggestionLabels,
      aiSuggestionLabelsCompartment: this.#aiSuggestionLabelsCompartment,
      finishComposition: () => this.#finishComposition(),
      handleViewUpdate: (update) => this.#handleViewUpdate(update),
      markdownLanguageCompartment: this.#markdownLanguageCompartment,
      options: options,
      startComposition: () => this.#startComposition(),
      syntaxRegistry: this.#syntaxRegistry,
      syntaxRegistryCompartment: this.#syntaxRegistryCompartment,
      useNativeCodeLanguages: controllerOptions.useNativeCodeLanguages,
      wysiwygDiagnostics: this.#wysiwygDiagnostics,
    });

    // 会话初始：尚无「上一次视图轴状态」⇒ 两开关均关（宿主持久化偏好不属本批范围）
    const initialState = this.#createState(initialSnapshot, { focus: false, typewriter: false });
    this.#view = viewFactory({
      parent: options.parent,
      state: initialState,
      onCompositionStart: () => this.#startComposition(),
      onCompositionEnd: () => this.#finishComposition(),
    });
  }

  /**
   * 组合输入（IME）是否进行中。`#compositionActive` 是本渲染器的投影守卫标记，
   * `#view.isComposing` 是 CodeMirror 视图/DOM 层事实，两者取或即"用户正在拼字"。
   * 宿主（移动端壳子）用它决定是否推迟视口重排与桥接上报：iOS WebKit 在组合期
   * 重排/让原生 UI 重建时会把 pre-edit（拼音）当作普通文本提前提交。
   */
  get isComposing(): boolean {
    return this.#compositionActive || this.#view.isComposing;
  }

  get probe(): RendererTestingProbeInternal {
    return createRendererProbe(this.#view, this.#wysiwygDiagnostics, this.#ledger, {
      clientId: this.clientId,
      viewId: this.#viewId,
      stateEpochId: this.#stateEpochId,
      rootExtensionId: this.#rootExtensionId,
      documentGeneration: this.#documentGeneration,
      stateRevision: this.#stateRevision,
      contentRevision: this.#contentRevision,
      codeBlockLineNumbers: this.#codeBlockLineNumbers,
      inlineStyleMarkers: this.#inlineStyleMarkers,
      viewDestructionCount: this.#viewDestructionCount,
      explicitStateCreationCount: this.#explicitStateCreationCount,
      stateReplacementCount: this.#stateReplacementCount,
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
    return sync(this.#documentProtocolContext(), event);
  }
  reconcile(snapshot: DocumentSnapshot): RendererSyncResult {
    return reconcile(this.#documentProtocolContext(), snapshot);
  }
  applyReservedExternalEdit(request: ExternalEditRequest): ExternalEditResult {
    return applyReservedExternalEdit(this.#documentProtocolContext(), request);
  }
  applyMode(request: ModeRequest): ModePortResult {
    return applyMode(this.#documentProtocolContext(), request);
  }
  rollbackMode(receipt: ModeReceipt): void {
    rollbackMode(this.#documentProtocolContext(), receipt);
  }
  setInlineStyleMarkers(enabled: boolean): InlineStyleMarkerPortResult {
    if (this.#destroyed) {
      return { status: "destroyed" };
    }
    if (enabled === this.#inlineStyleMarkers) {
      return { status: "noop" };
    }
    this.#view.dispatch({
      effects: setInlineStyleMarkersEffect.of(enabled),
      annotations: [
        Transaction.addToHistory.of(false),
        rendererTransactionOrigin.of({ kind: "inline-style-markers" }),
      ],
    });
    this.#inlineStyleMarkers = enabled;
    return { status: "applied" };
  }

  setMarkdownLint(enabled: boolean): MarkdownLintPortResult {
    if (this.#destroyed) {
      return { status: "destroyed" };
    }
    if (enabled === this.#markdownLintEnabled) {
      return { status: "noop" };
    }
    this.#markdownLintEnabled = enabled;
    const reconfigureEffect = this.#markdownLintCompartment.reconfigure(
      createRealtimeMarkdownLintExtension(enabled),
    );
    const clearEffects: readonly StateEffect<unknown>[] = enabled
      ? []
      : (setDiagnostics(this.#view.state, collectPreservedNonMarkdownDiagnostics(this.#view.state))
          .effects as readonly StateEffect<unknown>[]);

    this.#view.dispatch({
      effects: [reconfigureEffect, ...clearEffects],
      annotations: [
        Transaction.addToHistory.of(false),
        rendererTransactionOrigin.of({ kind: "markdown-lint" }),
      ],
    });
    return { status: "applied" };
  }

  recomputeMarkdownLint(): MarkdownLintPortResult {
    if (this.#destroyed) {
      return { status: "destroyed" };
    }
    if (!this.#markdownLintEnabled) {
      return { status: "noop" };
    }
    const preserved = collectPreservedNonMarkdownDiagnostics(this.#view.state);
    const mdDiagnostics = runMarkdownLint(this.#view.state);
    const effects: readonly StateEffect<unknown>[] = (setDiagnostics(this.#view.state, [
      ...preserved,
      ...mdDiagnostics,
    ]).effects ?? []) as readonly StateEffect<unknown>[];

    this.#view.dispatch({
      effects: [...effects],
      annotations: [
        Transaction.addToHistory.of(false),
        rendererTransactionOrigin.of({ kind: "markdown-lint" }),
      ],
    });
    return { status: "applied" };
  }

  setCodeBlockLineNumbers(enabled: boolean): CodeBlockLineNumberPortResult {
    if (this.#destroyed) {
      return { status: "destroyed" };
    }
    if (enabled === this.#codeBlockLineNumbers) {
      return { status: "noop" };
    }
    this.#view.dispatch({
      effects: setCodeBlockLineNumbersEffect.of(enabled),
      annotations: [
        Transaction.addToHistory.of(false),
        rendererTransactionOrigin.of({ kind: "code-block-line-numbers" }),
      ],
    });
    this.#codeBlockLineNumbers = enabled;
    this.#wysiwygDiagnostics.recordCodeBlockLineNumbersToggle();
    return { status: "applied" };
  }

  setHostVisibility(hidden: boolean): void {
    setHostVisibility(this.#documentProtocolContext(), hidden);
  }

  showSuggestion(suggestion: AiSuggestionInput): void {
    if (this.#destroyed) {
      return;
    }
    this.#view.dispatch({
      effects: setAiSuggestionEffect.of(suggestion),
    });
    this.#view.focus();
  }

  setAiSuggestionLabels(labels: AiSuggestionLabels): void {
    if (this.#destroyed) {
      return;
    }
    this.#aiSuggestionLabels = labels;
    this.#view.dispatch({
      effects: this.#aiSuggestionLabelsCompartment.reconfigure(aiSuggestionLabelsFacet.of(labels)),
    });
  }

  acceptSuggestion(): boolean {
    return !this.#destroyed && acceptAiSuggestion(this.#view as unknown as EditorView);
  }

  moveBlockUp(): boolean {
    return !this.#destroyed && moveBlockUp(this.#view as unknown as EditorView);
  }

  moveBlockDown(): boolean {
    return !this.#destroyed && moveBlockDown(this.#view as unknown as EditorView);
  }

  toggleFocusMode(): boolean {
    return !this.#destroyed && toggleViewFocusMode(this.#view);
  }

  toggleTypewriterMode(): boolean {
    return !this.#destroyed && toggleViewTypewriterMode(this.#view);
  }

  getViewModeState(): { readonly focus: boolean; readonly typewriter: boolean } {
    return readViewModeState(this.#view);
  }

  duplicateBlock(): boolean {
    return !this.#destroyed && duplicateBlock(this.#view as unknown as EditorView);
  }

  deleteBlock(): boolean {
    return !this.#destroyed && deleteBlock(this.#view as unknown as EditorView);
  }

  dismissSuggestion(): boolean {
    return !this.#destroyed && dismissAiSuggestion(this.#view as unknown as EditorView);
  }

  getSuggestion(): AiSuggestionValue | null {
    if (this.#destroyed) {
      return null;
    }
    return this.#view.state.field(aiSuggestionField, false) ?? null;
  }

  getSelectionSnapshot(): {
    readonly from: number;
    readonly to: number;
    readonly text: string;
    readonly head: number;
  } {
    if (this.#destroyed) {
      return { from: 0, to: 0, text: "", head: 0 };
    }
    return readSelectionSnapshot(this.#view);
  }

  focus(): void {
    if (!this.#destroyed) {
      this.#view.focus();
    }
  }

  /**
   * 设置编辑器选区(编辑器标准能力,供宿主定位/测试)。
   * from === to 时为光标;范围按文档长度钳制。
   */
  setSelection(from: number, to: number): void {
    if (this.#destroyed) {
      return;
    }
    setViewSelection(this.#view, from, to);
  }

  /**
   * 滚动到指定行(1-based)并可将光标定位到行首。
   * line 范围自动按文档总行数钳制。
   */
  scrollToLine(
    line: number,
    options?: { readonly select?: boolean; readonly focus?: boolean },
  ): boolean {
    return this.#destroyed ? false : scrollViewToLine(this.#view, line, options);
  }

  requestMeasure(): void {
    if (!this.#destroyed) this.#requestMeasure();
  }

  flushPendingEdits(): boolean {
    return flushPendingViewEdits(this.#view, this.#destroyed);
  }

  async runDocumentLint(options?: DocumentLinterOptions): Promise<readonly Diagnostic[]> {
    return this.#destroyed ? [] : executeDocumentLint(this.#view, options);
  }

  get #targetEditorView(): EditorView {
    return this.#view.editorView ?? (this.#view as unknown as EditorView);
  }

  runMarkdownLintCommand(config?: Record<string, unknown>): MarkdownLintRunResult {
    return this.#destroyed
      ? { total: 0, errors: 0, warnings: 0 }
      : runMarkdownLintCommand(this.#targetEditorView, config);
  }

  fixAllMarkdownLint(config?: Record<string, unknown>): MarkdownLintFixAllResult {
    return this.#destroyed
      ? { appliedCount: 0, remainingCount: 0 }
      : fixAllMarkdownLintIssues(this.#targetEditorView, config);
  }

  clearMarkdownLint(): void {
    if (!this.#destroyed) clearMarkdownLintCommand(this.#targetEditorView);
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
    this.#modeScrollTopsByMode.clear();
    this.#modeCursorPosByMode.clear();
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
    this.#ledger.countMeasure();
    this.#view.requestMeasure(afterMeasure);
  }

  #createState(
    snapshot: DocumentSnapshot,
    viewAxisAlignment: ViewAxisState,
    selection: EditorSelection = EditorSelection.single(0),
  ): EditorState {
    this.#explicitStateCreationCount += 1;
    return EditorState.create({
      doc: normalizeLineEndings(snapshot.markdown),
      selection,
      extensions: [
        ...this.#rootExtensions,
        initialCodeBlockLineNumbersFacet.of(this.#codeBlockLineNumbers),
        initialInlineStyleMarkersFacet.of(this.#inlineStyleMarkers),
        this.#modeCompartment.of(createModeExtensions(snapshot.mode)),
        this.#markdownLintCompartment.of(
          createRealtimeMarkdownLintExtension(this.#markdownLintEnabled),
        ),
        // 视图轴继承（与文档正交）：作为初值注入，避免「先默认后 dispatch」的副作用
        focusModeInitialFacet.of(viewAxisAlignment.focus),
        typewriterModeInitialFacet.of(viewAxisAlignment.typewriter),
      ],
    });
  }

  #currentMode(): EditorMode {
    return this.#view.state.field(editorModeField);
  }

  #handleViewUpdate(update: ViewUpdate): void {
    handleViewUpdate(this.#documentProtocolContext(), update);
  }

  #performModeChange(mode: EditorMode, origin: RendererTransactionOrigin): void {
    dispatchModeChangeWithMemory(this.#modeViewportContext(), mode, origin);
  }

  /** 控制器持有的模式记忆状态以显式上下文交给协作器读写（避免反向运行期依赖）。 */
  #modeViewportContext(): ModeViewportContext {
    return {
      view: this.#view,
      modeCompartment: this.#modeCompartment,
      scrollTopsByMode: this.#modeScrollTopsByMode,
      cursorPosByMode: this.#modeCursorPosByMode,
      currentMode: () => this.#currentMode(),
      documentGeneration: () => this.#documentGeneration,
      isDestroyed: () => this.#destroyed,
      beginRestoreSequence: () => ++this.#modeScrollRestoreSequence,
      isCurrentRestore: (sequence) => this.#modeScrollRestoreSequence === sequence,
      requestMeasure: (afterMeasure) => this.#requestMeasure(afterMeasure),
    };
  }

  #clampedSelection(documentLength: number): EditorSelection {
    return clampSelection(this.#view.state.selection, documentLength);
  }

  /** Helpers receive only protocol inputs; all mutable storage stays in this controller. */
  #documentProtocolContext(): DocumentProtocolContext {
    // Object accessors require a stable lexical owner to read live private state.
    // oxlint-disable-next-line typescript/no-this-alias
    const owner = this;
    return {
      options: this.#options,
      clientId: this.clientId,
      acceptSnapshotBookkeeping: (snapshot) => owner.#acceptSnapshotBookkeeping(snapshot),
      clampedSelection: (length) => owner.#clampedSelection(length),
      clearPendingProtocolState: () => owner.#clearPendingProtocolState(),
      get compositionActive() {
        return owner.#compositionActive;
      },
      set compositionActive(value) {
        owner.#compositionActive = value;
      },
      get contentRevision() {
        return owner.#contentRevision;
      },
      createState: (snapshot, alignment, selection) =>
        owner.#createState(snapshot, alignment, selection),
      currentMode: () => owner.#currentMode(),
      get destroyed() {
        return owner.#destroyed;
      },
      get documentGeneration() {
        return owner.#documentGeneration;
      },
      get hiddenViewState() {
        return owner.#hiddenViewState;
      },
      set hiddenViewState(value) {
        owner.#hiddenViewState = value;
      },
      get highestPublishedRendererSequence() {
        return owner.#highestPublishedRendererSequence;
      },
      set highestPublishedRendererSequence(value) {
        owner.#highestPublishedRendererSequence = value;
      },
      get lastAcknowledgedRendererSequence() {
        return owner.#lastAcknowledgedRendererSequence;
      },
      set lastAcknowledgedRendererSequence(value) {
        owner.#lastAcknowledgedRendererSequence = value;
      },
      get lastErrorCode() {
        return owner.#lastErrorCode;
      },
      set lastErrorCode(value) {
        owner.#lastErrorCode = value;
      },
      ledger: this.#ledger,
      modeCompartment: this.#modeCompartment,
      modeCursorPosByMode: this.#modeCursorPosByMode,
      modeScrollTopsByMode: this.#modeScrollTopsByMode,
      notifyCancellation: (reason) => owner.#notifyCancellation(reason),
      notifyQueuedCancellation: (reason) => owner.#notifyQueuedCancellation(reason),
      get pendingExternalEdit() {
        return owner.#pendingExternalEdit;
      },
      set pendingExternalEdit(value) {
        owner.#pendingExternalEdit = value;
      },
      get pendingLocalSequences() {
        return owner.#pendingLocalSequences;
      },
      get pendingModeReceipt() {
        return owner.#pendingModeReceipt;
      },
      set pendingModeReceipt(value) {
        owner.#pendingModeReceipt = value;
      },
      performModeChange: (mode, origin) => owner.#performModeChange(mode, origin),
      get queuedExternalEdit() {
        return owner.#queuedExternalEdit;
      },
      set queuedExternalEdit(value) {
        owner.#queuedExternalEdit = value;
      },
      reconcileRequired: (revision) => owner.#reconcileRequired(revision),
      get reconcileScrollRestoreSequence() {
        return owner.#reconcileScrollRestoreSequence;
      },
      set reconcileScrollRestoreSequence(value) {
        owner.#reconcileScrollRestoreSequence = value;
      },
      recordSyncResult: (result) => owner.#recordSyncResult(result),
      requestMeasure: (afterMeasure) => owner.#requestMeasure(afterMeasure),
      get stateEpochId() {
        return owner.#stateEpochId;
      },
      set stateEpochId(value) {
        owner.#stateEpochId = value;
      },
      get stateEpochSequence() {
        return owner.#stateEpochSequence;
      },
      set stateEpochSequence(value) {
        owner.#stateEpochSequence = value;
      },
      get stateReplacementCount() {
        return owner.#stateReplacementCount;
      },
      set stateReplacementCount(value) {
        owner.#stateReplacementCount = value;
      },
      get stateRevision() {
        return owner.#stateRevision;
      },
      view: this.#view,
      viewId: this.#viewId,
      get visibilityRestoreSequence() {
        return owner.#visibilityRestoreSequence;
      },
      set visibilityRestoreSequence(value) {
        owner.#visibilityRestoreSequence = value;
      },
    };
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
    startComposition(this.#documentProtocolContext());
  }

  #finishComposition(): void {
    finishComposition(this.#documentProtocolContext());
  }

  use(...plugins: (MarkdownSyntaxPlugin | readonly MarkdownSyntaxPlugin[])[]): this {
    if (this.#destroyed) {
      return this;
    }
    registerSyntaxPlugins(this.#syntaxPluginContext(), plugins);
    return this;
  }

  /**
   * 动态全量替换当前已激活的 Markdown 语法插件集合。
   *
   * 核心交互与生命周期契约（全文见 `controller/plugin-management.ts`）：
   * ID 清单幂等守卫、原子化 Compartment 重构、零 DOM 侵入。
   */
  setPlugins(plugins: readonly MarkdownSyntaxPlugin[]): this {
    if (this.#destroyed) {
      return this;
    }
    replaceSyntaxPlugins(this.#syntaxPluginContext(), plugins);
    return this;
  }

  /** 控制器持有的插件注册表/Compartment 以显式上下文交给协作器读写。 */
  #syntaxPluginContext(): SyntaxPluginContext {
    return {
      view: this.#view,
      registry: this.#syntaxRegistry,
      syntaxRegistryCompartment: this.#syntaxRegistryCompartment,
      markdownLanguageCompartment: this.#markdownLanguageCompartment,
      useNativeCodeLanguages: this.#controllerOptions.useNativeCodeLanguages,
      diagnostics: this.#wysiwygDiagnostics,
    };
  }
}
