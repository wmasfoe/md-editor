/**
 * @file controller.ts
 * @description CodeMirror 渲染器控制器：持有协议状态、编排视图与投影扩展，并驱动端口语义。
 *
 * 本模块只保留"状态持有 + 编排"残余；可独立成簇的行为已抽为接收显式上下文的协作器：
 * - 模式切换视口/光标记忆 → `controller/mode-viewport.ts`
 * - 语法插件注册/替换 → `controller/plugin-management.ts`
 * - 选区钳制 → `controller/selection.ts`
 * - 入参校验/冻结 → `controller/validation.ts`
 *
 * 对外门面（`CodeMirrorRenderer`）由 `renderer/index.ts` 在控制器之后装配，避免 TDZ。
 */

import {
  defaultKeymap,
  history,
  historyKeymap,
  isolateHistory,
  redoDepth,
  undoDepth,
} from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { codeFolding } from "@codemirror/language";
import { search, searchKeymap } from "@codemirror/search";
import {
  Compartment,
  EditorSelection,
  EditorState,
  Transaction,
  type Extension,
  type StateEffect,
  type TransactionSpec,
} from "@codemirror/state";
import { EditorView, keymap, type ViewUpdate } from "@codemirror/view";
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
import { provideWysiwygDiagnostics, WysiwygDiagnostics } from "../diagnostics.ts";
import {
  codeBlockTokenHighlighting,
  createMarkdownLanguageSupport,
} from "../markdown/code-languages.ts";
import { M1_MARKDOWN_EXTENSIONS } from "../markdown/extensions.ts";
import {
  markdownRangeIndexField,
  mdxModeFacet,
  syntaxPluginRegistryFacet,
} from "../markdown/range-index.ts";
import { createModeExtensions, editorModeField, setEditorModeEffect } from "../mode.ts";
import {
  readRendererTransactionOrigin,
  rendererTransactionOrigin,
  type RendererTransactionOrigin,
} from "../origin.ts";
import type { MarkdownSyntaxPlugin } from "../plugins/syntax-plugin.ts";
import { SyntaxPluginRegistry } from "../plugins/syntax-registry.ts";
import { blockToolbarExtension } from "../wysiwyg/blocks/block-toolbar.ts";
import {
  deleteBlock,
  duplicateBlock,
  moveBlockDown,
  moveBlockUp,
} from "../wysiwyg/blocks/block-move.ts";
import { codeBlockSelectionExtension } from "../wysiwyg/editing/code-block-selection.ts";
import { createWysiwygProjectionExtensions } from "../wysiwyg/index.ts";
import {
  typewriterModeField,
  typewriterModeInitialFacet,
} from "../wysiwyg/input/typewriter-mode.ts";
import { mdxComponentRegistryFacet } from "../wysiwyg/projections/mdx-projection.ts";
import {
  initialCodeBlockLineNumbersFacet,
  setCodeBlockLineNumbersEffect,
} from "../wysiwyg/projections/code-block-projection.ts";
import { authorizeWysiwygProtectedChange } from "../wysiwyg/state/change-authorization.ts";
import {
  endWysiwygCompositionGuardEffect,
  inspectWysiwygProjection,
  refreshWysiwygProjectionEffect,
  startWysiwygCompositionGuardEffect,
} from "../wysiwyg/state/projection-state.ts";
import {
  focusDimOpacityFacet,
  focusModeField,
  focusModeInitialFacet,
} from "../wysiwyg/view/focus-mode.ts";
import { provideImagePreviewResolver } from "../wysiwyg/view/image-resolver.ts";
import { linkInteractionExtension, openLinkTargetFacet } from "../wysiwyg/view/link-interaction.ts";
import { createLiquidSearchPanel } from "../wysiwyg/view/search-panel.ts";
import {
  acceptAiSuggestion,
  aiSuggestionExtension,
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
  freezeExternalRequest,
  validateExternalRequest,
  validateModeRequest,
} from "./controller/validation.ts";
import {
  readSelectionSnapshot,
  readViewModeState,
  scrollViewToLine,
  setViewSelection,
  toggleViewFocusMode,
  toggleViewTypewriterMode,
} from "./controller/view-operations.ts";
import type {
  CodeBlockLineNumberPortResult,
  CodeMirrorRendererControllerOptions,
  CodeMirrorRendererOptions,
  ExternalEditRequest,
  ExternalEditResult,
  RendererViewAdapter,
  RendererViewFactory,
  RendererTestingProbeInternal,
  ViewAxisState,
} from "./types.ts";

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

    const initialPlugins = options.plugins ?? options.syntaxPlugins ?? [];
    this.#syntaxRegistry = new SyntaxPluginRegistry(initialPlugins);
    const pluginExtensions = this.#syntaxRegistry.getMarkdownExtensions();
    const markdownExtensions = Object.freeze([...M1_MARKDOWN_EXTENSIONS, ...pluginExtensions]);

    this.#rootExtensions = Object.freeze([
      history(),
      EditorState.allowMultipleSelections.of(true),
      EditorView.lineWrapping,
      codeFolding(),
      search({ top: true, createPanel: createLiquidSearchPanel }),
      keymap.of([...searchKeymap, ...defaultKeymap, ...historyKeymap]),
      this.#markdownLanguageCompartment.of(
        controllerOptions.useNativeCodeLanguages
          ? createMarkdownLanguageSupport(
              { extensions: markdownExtensions, addKeymap: false },
              this.#wysiwygDiagnostics,
            )
          : markdown({ extensions: markdownExtensions, addKeymap: false }),
      ),
      this.#syntaxRegistryCompartment.of(syntaxPluginRegistryFacet.of(this.#syntaxRegistry)),
      codeBlockTokenHighlighting,
      provideWysiwygDiagnostics(this.#wysiwygDiagnostics),
      options.resolveImagePreview ? provideImagePreviewResolver(options.resolveImagePreview) : [],
      editorModeField,
      markdownRangeIndexField,
      mdxModeFacet.of(options.mdxMode ?? false),
      // 轮1 architect WATCH concern-8：renderer 选项 → facet 的宿主注入路径（通道端到端可行使）
      ...(options.focusDimOpacity === undefined
        ? []
        : [focusDimOpacityFacet.of(options.focusDimOpacity)]),
      mdxComponentRegistryFacet.of(options.mdxComponents ?? null),
      openLinkTargetFacet.of(options.openLinkTarget ?? null),
      linkInteractionExtension,
      blockToolbarExtension,
      codeBlockSelectionExtension,
      aiSuggestionExtension,
      this.#aiSuggestionLabelsCompartment.of(aiSuggestionLabelsFacet.of(this.#aiSuggestionLabels)),
      createWysiwygProjectionExtensions(
        [
          "inline-styles",
          "headings",
          "blocks",
          "links",
          "images",
          "thematic-breaks",
          "default-atoms",
          "frontmatter",
          "tables",
          "html",
          "mdx",
          "directives",
        ],
        { writeClipboardText: options.writeClipboardText },
      ),
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
      selectionRanges: Object.freeze(
        selection.ranges.map((range) =>
          Object.freeze({
            anchor: range.anchor,
            head: range.head,
          }),
        ),
      ),
      scrollTop: this.#view.getScrollTop(),
      focused: this.#view.hasFocus(),
      undoDepth: undoDepth(this.#view.state),
      redoDepth: redoDepth(this.#view.state),
      codeBlockLineNumbers: this.#codeBlockLineNumbers,
      viewCreationCount: 1,
      viewDestructionCount: this.#viewDestructionCount,
      explicitStateCreationCount: this.#explicitStateCreationCount,
      stateReplacementCount: this.#stateReplacementCount,
      ...this.#ledger.probeFields(),
      highestPublishedRendererSequence: this.#highestPublishedRendererSequence,
      lastAcknowledgedRendererSequence: this.#lastAcknowledgedRendererSequence,
      queuedExternalEditOperationId: this.#queuedExternalEdit?.operationId ?? null,
      pendingExternalEditOperationId: this.#pendingExternalEdit?.operationId ?? null,
      pendingModeOperationId: this.#pendingModeReceipt?.operationId ?? null,
      persistenceStatus: this.#persistenceStatus,
      lastSyncStatus: this.#lastSyncStatus,
      lastErrorCode: this.#lastErrorCode,
      destroyed: this.#destroyed,
      wysiwyg: this.#wysiwygDiagnostics.snapshot(),
      wysiwygProjection: inspectWysiwygProjection(this.#view.state),
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
    // S7：**全量替换文档时必须保留视口位置**。
    //
    // 宿主与应用自身在会话中会重新装载当前文档（保存往返、外部改动、设置变更后的快照同步
    // 都走本路径）。只要重发内容与编辑器当前内容存在**任何微小差异**（换行/尾空白归一即足够），
    // 下面就是一次全量替换 —— 若不恢复滚动，正在阅读的用户会被**弹回顶部**。
    // 属主复现（E34，夹具为其逐字文档）：滚动到 2560 → 装载后 0；修复后保持原位。
    const preservedScrollTop = markdownLf === currentMarkdown ? null : this.#view.getScrollTop();
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
        authorizeWysiwygProtectedChange.of(true),
        rendererTransactionOrigin.of({ kind: "reconcile" }),
      ],
    });
    if (preservedScrollTop !== null) {
      // CodeMirror 可能在随后的 measure 中调整滚动锚点（与 setHostVisibility 同款处置）：
      // 先在本次写入恢复一次，再在 measure 回调里复核一次。
      this.#view.setScrollTop(preservedScrollTop);
      const restoreSequence = ++this.#reconcileScrollRestoreSequence;
      this.#requestMeasure(() => {
        if (!this.#destroyed && this.#reconcileScrollRestoreSequence === restoreSequence) {
          this.#view.setScrollTop(preservedScrollTop);
        }
      });
    }
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
          authorizeWysiwygProtectedChange.of(true),
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
      transactionSequence: this.#ledger.documentTransactionCount,
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
      this.#performModeChange(request.mode, {
        kind: "mode",
        operationId: request.operationId,
      });
    } catch (error) {
      console.error("[applyMode dispatch failed]", error);
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
    this.#performModeChange(receipt.previousMode, {
      kind: "mode-rollback",
      operationId: receipt.operationId,
    });
    this.#pendingModeReceipt = null;
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
    if (this.#destroyed) {
      return false;
    }
    return acceptAiSuggestion(this.#view as unknown as EditorView);
  }

  moveBlockUp(): boolean {
    if (this.#destroyed) {
      return false;
    }
    return moveBlockUp(this.#view as unknown as EditorView);
  }

  moveBlockDown(): boolean {
    if (this.#destroyed) {
      return false;
    }
    return moveBlockDown(this.#view as unknown as EditorView);
  }

  toggleFocusMode(): boolean {
    if (this.#destroyed) {
      return false;
    }
    return toggleViewFocusMode(this.#view);
  }

  toggleTypewriterMode(): boolean {
    if (this.#destroyed) {
      return false;
    }
    return toggleViewTypewriterMode(this.#view);
  }

  getViewModeState(): { readonly focus: boolean; readonly typewriter: boolean } {
    return readViewModeState(this.#view);
  }

  duplicateBlock(): boolean {
    if (this.#destroyed) {
      return false;
    }
    return duplicateBlock(this.#view as unknown as EditorView);
  }

  deleteBlock(): boolean {
    if (this.#destroyed) {
      return false;
    }
    return deleteBlock(this.#view as unknown as EditorView);
  }

  dismissSuggestion(): boolean {
    if (this.#destroyed) {
      return false;
    }
    return dismissAiSuggestion(this.#view as unknown as EditorView);
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
    if (this.#destroyed) {
      return false;
    }
    return scrollViewToLine(this.#view, line, options);
  }

  requestMeasure(): void {
    if (!this.#destroyed) {
      this.#requestMeasure();
    }
  }

  flushPendingEdits(): boolean {
    if (this.#destroyed) {
      return false;
    }
    return this.#view.flushPendingEdits?.() ?? false;
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
        this.#modeCompartment.of(createModeExtensions(snapshot.mode)),
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
    if (update.selectionSet || update.docChanged) {
      const head = update.state.selection.main.head;
      const line = update.state.doc.lineAt(head).number;
      this.#options.onCursorLineChange?.(line);
    }

    const documentTransactions = update.transactions.filter(
      (transaction) => transaction.docChanged,
    );
    if (documentTransactions.length === 0) {
      for (const transaction of update.transactions) {
        this.#ledger.countOrigin(readRendererTransactionOrigin(transaction));
      }
      return;
    }

    this.#ledger.countDocumentTransactions(documentTransactions.length);
    const localTransactions: Transaction[] = [];
    for (const transaction of update.transactions) {
      const origin = readRendererTransactionOrigin(transaction);
      this.#ledger.countOrigin(origin);
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

  #installDocumentBoundary(snapshot: DocumentSnapshot): void {
    const notifyQueuedCancellation = this.#queuedExternalEdit !== null;
    this.#queuedExternalEdit = null;
    this.#compositionActive = false;
    this.#hiddenViewState = null;
    this.#visibilityRestoreSequence += 1;
    this.#modeScrollTopsByMode.clear();
    this.#modeCursorPosByMode.clear();
    this.#clearPendingProtocolState();
    // S7：**区分「换文档」与「同一文档重装载」**。
    // 换文档回顶部是对的；但同一文档的重装载（保存往返、外部改动、设置变更后的快照重发）
    // 若无条件归零，就会把正在阅读的用户**弹回顶部** —— 属主复现（E34，夹具为其逐字文档）。
    //
    // 身份判据**只认宿主声明**（`snapshot.replaceIntent`），渲染层不做任何推断
    //（architect 终审驱动项 ①）：从路径/内容前缀反推会重复宿主的领域知识
    //（宿主本就拥有 `documentGeneration` 与重装载意图），并悄悄成为视口语义的隐性事实源。
    // 未声明时按 `"different"` 归零（fail-safe：宁归零，不保留错位阅读位置）——见 R17/R17e/R17f。
    const previousScrollTop = this.#view.getScrollTop();
    const sameDocument = snapshot.replaceIntent === "same";
    // 同一文档重装载：**连光标一起保留**。否则视口保留了、光标却被复位到 0 ⇒ 光标落在视口之外，
    // 下一次按键会把视口拽回顶部，等于没修（code-reviewer 复审 MEDIUM-3）。
    // 换文档仍归零（R17 原契约）；same 时用 `#clampedSelection` 按新文档长度夹取
    //（与 reconcile / external-edit 两条兄弟路径同一约定，可保留区间与多光标 —— architect R3）。
    // 视图轴（专注/打字机）与文档轴正交：跨边界继承，不随文档重置（S1(b)/MED-4 根因修复）。
    const viewAxisAlignment: ViewAxisState = {
      focus: this.#view.state.field(focusModeField, false) === true,
      typewriter: this.#view.state.field(typewriterModeField, false) === true,
    };
    const nextState = this.#createState(
      snapshot,
      viewAxisAlignment,
      sameDocument
        ? // 用**归一后**长度夹取（与 `#createState` 的 `normalizeLineEndings` 及 reconcile 兄弟路径
          // 的 `markdownLf.length` 一致；今天等价，但不留「归一前/后长度混用」的潜在坑 —— architect R3/code-reviewer 残留 3）
          this.#clampedSelection(normalizeLineEndings(snapshot.markdown).length)
        : undefined,
    );
    this.#view.setState(nextState);
    this.#view.clearDomSelection();
    if (sameDocument) {
      // 与 setHostVisibility 同款：先写一次，再在 measure 回调复核（CM 可能调整滚动锚点）
      const restoreSequence = ++this.#reconcileScrollRestoreSequence;
      this.#view.setScrollTop(previousScrollTop);
      this.#requestMeasure(() => {
        if (!this.#destroyed && this.#reconcileScrollRestoreSequence === restoreSequence) {
          this.#view.setScrollTop(previousScrollTop);
        }
      });
    } else {
      this.#view.setScrollTop(0);
    }
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
    if (this.#compositionActive || this.#destroyed) {
      return;
    }
    this.#compositionActive = true;
    this.#view.dispatch({
      effects: startWysiwygCompositionGuardEffect.of(
        this.#view.state.selection.ranges.map((range) => ({
          from: range.from,
          to: range.to,
        })),
      ),
      annotations: Transaction.addToHistory.of(false),
    });
  }

  #finishComposition(): void {
    if (!this.#compositionActive) {
      return;
    }
    this.#compositionActive = false;
    if (!this.#destroyed) {
      this.#view.dispatch({
        effects: [
          endWysiwygCompositionGuardEffect.of(null),
          // G004 P0-2:composition 期间投影装饰只 map 未重建,结束必须全量重建一次,
          // 保证装饰与 IME 提交后的最终文档一致。
          refreshWysiwygProjectionEffect.of(null),
        ],
        annotations: Transaction.addToHistory.of(false),
      });
    }
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
