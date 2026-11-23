import type { DocumentMetrics } from "./markdown/document-metrics.ts";
import {
  switchEditorModeSafely,
  synchronizeRendererEvent,
  type DocumentMutationResult,
  type DocumentState,
  type DocumentSnapshot,
  type EditorMode,
  type ExternalEditFinalizeReceipt,
  type ExternalEditReservationResult,
  type ModeReceipt,
  type ModeRequest,
  type ModeRendererPort,
  type MutationBusyResult,
  type MutationRejectedResult,
  type RendererSyncDeliveryResult,
} from "@md-editor/core";
import {
  createCodeMirrorRenderer,
  type CodeMirrorRendererOptions,
  type CodeBlockLineNumberPortResult,
  type InlineStyleMarkerPortResult,
  type MarkdownLintPortResult,
  type MarkdownLintTarget,
  type MarkdownLintTargetState,
  type CodeMirrorRenderer,
  type ExternalEditRequest,
  type ExternalEditResult,
} from "./renderer/index.ts";
import type {
  AiSuggestionInput,
  AiSuggestionLabels,
  AiSuggestionValue,
  AiSuggestionAcceptedEvent,
} from "./wysiwyg/view/suggestion-model.ts";
import type {
  EditorMessageTranslator,
  MarkdownSyntaxPlugin,
  SyntaxPluginHostPorts,
} from "@md-editor/plugin-sdk/syntax";
import type { Disposable } from "@md-editor/plugin-sdk";
import type { MarkdownLintEngine } from "./lint/engine.ts";
import type { Diagnostic } from "@codemirror/lint";
import type { DocumentLinterOptions } from "./lint/types.ts";
import {
  prepareImageInsertion,
  type ImageInsertionOptions,
  type PreparedImageInsertion,
} from "./image-insertion.ts";

export type CodeMirrorEditorClipboardWriter = (text: string) => Promise<void>;

export type CodeMirrorEditorExternalEditResult =
  | { readonly status: "applied"; readonly receipt: ExternalEditFinalizeReceipt }
  | Extract<ExternalEditResult, { readonly status: "queued-composition" | "noop" | "stale" }>
  | Extract<ExternalEditResult, { readonly status: "cancelled" | "reconcile-required" }>
  | MutationBusyResult
  | MutationRejectedResult;

export interface CodeMirrorEditorPorts {
  readonly clientId: string;
  readonly mode: ModeRendererPort;
  applyExternalEdit(request: ExternalEditRequest): CodeMirrorEditorExternalEditResult;
  /** Capture the selection before storing an image, then inject the resolved image address. */
  prepareImageInsertion(options?: ImageInsertionOptions): PreparedImageInsertion;
  setCodeBlockLineNumbers(enabled: boolean): CodeBlockLineNumberPortResult;
  setInlineStyleMarkers(enabled: boolean): InlineStyleMarkerPortResult;
  setMarkdownLint(enabled: boolean): MarkdownLintPortResult;
  /**
   * **原子**提交 `{ engine, enabled }`。
   *
   * React 侧用它把"引擎"和"开关"合成一次提交：分成两步时会出现
   * 「开关 true + 无引擎」的非法中间态。
   */
  configureMarkdownLint(target: MarkdownLintTarget): MarkdownLintPortResult;
  /** 当前 lint 配置快照（测试与宿主自检用）。 */
  getMarkdownLintState(): MarkdownLintTargetState;
  /**
   * 运行期注入/替换 lint 引擎。
   *
   * 引擎改走动态 import 后，它通常比视图晚到；这条通道让宿主在引擎就绪时补上，
   * 而不必重建视图（重建会丢选区、撤销栈与 IME 状态）。
   */
  setMarkdownLintEngine(engine: MarkdownLintEngine | undefined): MarkdownLintPortResult;
  recomputeMarkdownLint(): MarkdownLintPortResult;
  setLanguage(language: string | undefined): MarkdownLintPortResult;
  setHostVisibility(hidden: boolean): void;
  showSuggestion(suggestion: AiSuggestionInput): void;
  setAiSuggestionLabels(labels: AiSuggestionLabels): void;
  acceptSuggestion(): boolean;
  dismissSuggestion(): boolean;
  getSuggestion(): AiSuggestionValue | null;
  /** Read cached counters only when the renderer represents this exact snapshot. */
  getDocumentMetrics?(
    snapshot: Pick<DocumentSnapshot, "documentGeneration" | "contentRevision">,
  ): DocumentMetrics | null;
  getSelectionSnapshot(): {
    readonly from: number;
    readonly to: number;
    readonly text: string;
    readonly head: number;
    readonly anchor: number;
  };
  undo(): boolean;
  /** D-3 块操作：上移块 */
  moveBlockUp(): boolean;
  /** D-3 块操作：下移块 */
  moveBlockDown(): boolean;
  /** D-3 块操作：复制块 */
  duplicateBlock(): boolean;
  /** D-3 块操作：删除块 */
  deleteBlock(): boolean;
  /** 执行 Markdown 常用格式化命令 */
  executeFormatting(commandId: string): boolean;
  /** 打开文档内查找面板 */
  openFind(): boolean;
  /** 打开文档内替换面板 */
  openReplace(): boolean;
  /** 动态更新格式化快捷键映射 */
  setKeymaps(customKeymaps: ReadonlyMap<string, string>): void;
  /** D-2 视图模式：切换专注模式，返回切换后状态 */
  toggleFocusMode(): boolean;
  /** D-2 视图模式：切换打字机模式，返回切换后状态 */
  toggleTypewriterMode(): boolean;
  /**
   * D-2/S1(b) 视图模式：**回读**视图轴（专注/打字机）真实开关态。
   *
   * 渲染层的 `focusModeField` / `typewriterModeField` 是单一事实源；
   * 宿主菜单镜像记的是「最近一次已知勾选态」，文档边界等事件后必须用它校对并**重同步**（MED-4）。
   */
  getViewModeState(): { readonly focus: boolean; readonly typewriter: boolean };
  focus(): void;
  setSelection(from: number, to: number): void;
  scrollToLine(
    line: number,
    options?: { readonly select?: boolean; readonly focus?: boolean },
  ): boolean;
  requestMeasure(): void;
  /**
   * 组合输入（IME）是否进行中：宿主据此推迟视口重排与桥接上报，
   * 避免 iOS WebKit 在组合期把 pre-edit（拼音）当作普通文本提交。
   */
  isComposing(): boolean;
  /** 将当前未提交的投影控件/表单（例如 WYSIWYG 表格单元格）同步刷新到底层文档 */
  flushPendingEdits(): boolean;
  /** 全量替换声明式插件集合（不清除 `addSyntaxPlugin` 的注册）。 */
  setSyntaxPlugins(plugins: readonly MarkdownSyntaxPlugin[]): void;
  /** 增量安装一个插件，返回可卸载句柄（与 `plugin-sdk` 的 register 同语义）。 */
  addSyntaxPlugin(plugin: MarkdownSyntaxPlugin): Disposable;
  /** 执行文档 MarkdownLint 与链接检查，将诊断结果同步分发至视口 */
  runDocumentLint(options?: DocumentLinterOptions): Promise<readonly Diagnostic[]>;
  /** 运行或切换 Markdown 规范检查，分发诊断并打开问题面板（若已开启则 Toggle Off 关闭） */
  runMarkdownLint(config?: Record<string, unknown>): {
    readonly total: number;
    readonly errors: number;
    readonly warnings: number;
    readonly toggledOff?: boolean;
  };
  /** 一键自动修复所有支持自动修复的 Markdown 规范问题 */
  fixAllMarkdownLint(config?: Record<string, unknown>): {
    readonly appliedCount: number;
    readonly remainingCount: number;
  };
  /** 清除 Markdown 规范检查状态（波浪线与底部面板） */
  clearMarkdownLint(): void;
}

export type CodeMirrorEditorSyncError =
  | {
      readonly kind: "renderer-sync";
      readonly delivery: Extract<RendererSyncDeliveryResult, { readonly status: "sync-error" }>;
    }
  | {
      readonly kind: "local-change-rejected";
      readonly result: Exclude<DocumentMutationResult, { readonly status: "applied" | "noop" }>;
    };

/**
 * MDX 组件白名单最小接口(与 editor 的 MdxComponentLookup 同形状;
 * 不 import plugin-host,遵守包边界)。
 */
export interface MdxComponentsLookup {
  getByComponentName(
    name: string,
  ): { readonly component: { readonly displayName: string } } | undefined;
}

export interface CodeMirrorEditorBridgeOptions {
  readonly parent: HTMLElement;
  /**
   * 是否自动注入编辑器自带样式（默认 true）。
   * 只在创建时读取：运行时改它需要重建编辑器。
   */
  readonly injectStyles?: boolean;
  /** CSP nonce，透传给自动注入的 `<style nonce>`。只在创建时读取。 */
  readonly styleNonce?: string;
  /**
   * 语法插件宿主端口（媒体查看器、callout widget 等）。
   * 缺省用渲染器自带实现；传 `{}` 可让插件优雅降级。
   */
  readonly syntaxPluginHostPorts?: SyntaxPluginHostPorts;
  /** 专注模式遮罩强度（0.30–0.50，越界会被夹紧）。 */
  readonly focusDimOpacity?: number;
  /** Per-editor lint language; omitted values follow the host document. */
  readonly language?: string;
  readonly translateEditorMessage?: EditorMessageTranslator | undefined;
  readonly document: DocumentState;
  readonly resolveImageSrc?: (source: string) => string;
  readonly writeClipboardText?: CodeMirrorEditorClipboardWriter;
  /** MDX 文件模式(透传给 renderer) */
  readonly mdxMode?: boolean;
  /** MDX 组件白名单(透传给 renderer;纯 metadata) */
  readonly mdxComponents?: MdxComponentsLookup;
  /** 链接打开回调(透传给 renderer;宿主决策内部文件 vs 外部链接) */
  readonly openLinkTarget?: (url: string) => void;
  readonly onCursorLineChange?: (line: number) => void;
  /** 是否开启实时 Markdown 规范检查（默认 false） */
  readonly enableMarkdownLint?: boolean;
  /** 宿主注入的 lint 引擎（`{ lint }` 来自 `markdownlint/sync`）。 */
  readonly markdownlint?: MarkdownLintEngine;
  /** 可选语法扩展插件列表（声明式） */
  readonly plugins?: readonly MarkdownSyntaxPlugin[];
  readonly aiSuggestionLabels?: AiSuggestionLabels;
  readonly onAiSuggestionAccepted?: (event: AiSuggestionAcceptedEvent) => void;
  readonly onSyncError: (error: CodeMirrorEditorSyncError) => void;
  readonly onQueuedExternalEditResult: (result: CodeMirrorEditorExternalEditResult) => void;
}

export interface CodeMirrorEditorBridge {
  readonly ports: CodeMirrorEditorPorts;
  destroy(): void;
}

const rendererByPorts = new WeakMap<CodeMirrorEditorPorts, CodeMirrorRenderer>();

function defaultWriteClipboardText(text: string): Promise<void> {
  const writeText = globalThis.navigator?.clipboard?.writeText;
  if (typeof writeText !== "function") {
    return Promise.reject(
      new Error("Clipboard write is unavailable: navigator.clipboard.writeText is not available."),
    );
  }
  return writeText.call(globalThis.navigator.clipboard, text);
}

function releaseReservation(
  document: DocumentState,
  reservation: Extract<
    ExternalEditReservationResult,
    { readonly status: "reserved" }
  >["reservation"],
  reason: Parameters<DocumentState["releaseExternalEdit"]>[1],
): void {
  document.releaseExternalEdit(reservation, reason);
}

export function createCodeMirrorEditorBridge(
  options: CodeMirrorEditorBridgeOptions,
): CodeMirrorEditorBridge {
  let destroyed = false;

  const reportSyncError = (error: CodeMirrorEditorSyncError) => {
    try {
      options.onSyncError(error);
    } catch {
      // Consumer diagnostics must not interrupt CM6 transaction delivery.
    }
  };

  const applyExternalEdit = (request: ExternalEditRequest): CodeMirrorEditorExternalEditResult => {
    const reservationResult = options.document.reserveExternalEdit(request);
    if (reservationResult.status !== "reserved") {
      return reservationResult;
    }

    let rendererResult: ExternalEditResult;
    try {
      rendererResult = renderer.applyReservedExternalEdit(request);
    } catch (error) {
      releaseReservation(options.document, reservationResult.reservation, "renderer-failed");
      throw error;
    }

    switch (rendererResult.status) {
      case "applied":
        return {
          status: "applied",
          receipt: options.document.finalizeExternalEdit(
            reservationResult.reservation,
            rendererResult.receipt,
          ),
        };
      case "noop":
        releaseReservation(options.document, reservationResult.reservation, "renderer-noop");
        return rendererResult;
      case "queued-composition":
        releaseReservation(options.document, reservationResult.reservation, "composition-deferred");
        return rendererResult;
      case "cancelled":
        releaseReservation(options.document, reservationResult.reservation, "cancelled");
        return rendererResult;
      case "reconcile-required":
      case "stale":
        releaseReservation(options.document, reservationResult.reservation, "renderer-failed");
        return rendererResult;
    }
  };

  // 内置 view.toggleSource：实现定义在 renderer 创建之后（它需要 renderer 与 mode 端口），
  // 用可回填的引用持有，避免先有鸡还是先有蛋。
  const toggleSourceMode = { current: (): boolean => false };

  const rendererOptions: CodeMirrorRendererOptions = {
    parent: options.parent,
    injectStyles: options.injectStyles,
    styleNonce: options.styleNonce,
    syntaxPluginHostPorts: options.syntaxPluginHostPorts,
    focusDimOpacity: options.focusDimOpacity,
    markdownlint: options.markdownlint,
    language: options.language,
    translateEditorMessage: options.translateEditorMessage,
    initialSnapshot: options.document.getSnapshot(),
    // Older custom states remain valid, but cannot authorize guarded graphical edits.
    isDocumentBusy: () => options.document.isMutationBusy?.() ?? true,
    resolveImagePreview: ({ source }) => options.resolveImageSrc?.(source) ?? source,
    writeClipboardText: options.writeClipboardText ?? defaultWriteClipboardText,
    mdxMode: options.mdxMode ?? false,
    mdxComponents: options.mdxComponents,
    openLinkTarget: options.openLinkTarget,
    onCursorLineChange: options.onCursorLineChange,
    plugins: options.plugins,
    aiSuggestionLabels: options.aiSuggestionLabels,
    onAiSuggestionAccepted: options.onAiSuggestionAccepted,
    enableMarkdownLint: options.enableMarkdownLint,
    onEditorChange(change) {
      const result = options.document.applyEditorChange(change.markdown, change.origin);
      if (result.status !== "applied" && result.status !== "noop") {
        renderer.reconcile(options.document.getSnapshot());
        reportSyncError({ kind: "local-change-rejected", result });
      }
    },
    onQueuedExternalEditReady(request) {
      options.onQueuedExternalEditResult(applyExternalEdit(request));
    },
    onQueuedExternalEditCancelled(result) {
      options.onQueuedExternalEditResult(result);
    },
    // 编辑器自己完成"切换源码/所见即所得"：这是内置键位，宿主不需要再绑 ⌘/。
    onToggleSourceMode: () => toggleSourceMode.current(),
  };
  const renderer = createCodeMirrorRenderer(rendererOptions);

  const unsubscribeTransitions = options.document.subscribeTransitions((event) => {
    const delivery = synchronizeRendererEvent(options.document, renderer, event);
    if (delivery.status === "sync-error") {
      reportSyncError({ kind: "renderer-sync", delivery });
    }
  });

  const mode: ModeRendererPort = Object.freeze({
    applyMode: (request: ModeRequest) => renderer.applyMode(request),
    rollbackMode: (receipt: ModeReceipt) => renderer.rollbackMode(receipt),
  });

  // 两阶段切换：渲染器先应用 → 核心做 CAS 提交 → 失败自动回滚。
  // 宿主自己绑这个键时也得走同一条路径，所以把它内置在这里更安全。
  toggleSourceMode.current = () => {
    if (destroyed) return false;
    const snapshot = options.document.getSnapshot();
    const nextMode: EditorMode = snapshot.mode === "wysiwyg" ? "source" : "wysiwyg";
    // 先把渲染器里尚未提交的输入刷给核心，避免切换时丢字
    renderer.flushPendingEdits();
    const result = switchEditorModeSafely(options.document, nextMode, {
      operationId: `bridge:mode:${Date.now()}`,
      renderer: mode,
      origin: { kind: "command", commandId: "view.toggleSource" },
    });
    return result.ok;
  };
  const ports: CodeMirrorEditorPorts = Object.freeze({
    clientId: renderer.clientId,
    mode,
    applyExternalEdit,
    prepareImageInsertion: (insertionOptions?: ImageInsertionOptions) =>
      prepareImageInsertion(
        options.document,
        renderer,
        (request) => {
          if (destroyed) return { status: "cancelled", reason: "destroyed" };
          const result = applyExternalEdit(request);
          if (result.status === "applied") renderer.focus();
          return result;
        },
        insertionOptions,
      ),
    moveBlockUp: () => renderer.moveBlockUp(),
    moveBlockDown: () => renderer.moveBlockDown(),
    duplicateBlock: () => renderer.duplicateBlock(),
    deleteBlock: () => renderer.deleteBlock(),
    executeFormatting: (commandId: string) => renderer.executeFormatting(commandId),
    openFind: () => renderer.openFind(),
    openReplace: () => renderer.openReplace(),
    setKeymaps: (customKeymaps: ReadonlyMap<string, string>) => renderer.setKeymaps(customKeymaps),
    toggleFocusMode: () => renderer.toggleFocusMode(),
    toggleTypewriterMode: () => renderer.toggleTypewriterMode(),
    getViewModeState: () => renderer.getViewModeState(),
    setCodeBlockLineNumbers: (enabled: boolean) => renderer.setCodeBlockLineNumbers(enabled),
    setInlineStyleMarkers: (enabled: boolean) => renderer.setInlineStyleMarkers(enabled),
    setMarkdownLint: (enabled: boolean) => renderer.setMarkdownLint(enabled),
    configureMarkdownLint: (target: MarkdownLintTarget) => renderer.configureMarkdownLint(target),
    getMarkdownLintState: () => renderer.getMarkdownLintState(),
    setMarkdownLintEngine: (engine: MarkdownLintEngine | undefined) =>
      renderer.setMarkdownLintEngine(engine),
    recomputeMarkdownLint: () => renderer.recomputeMarkdownLint(),
    setLanguage: (language: string | undefined) => renderer.setLanguage(language),
    setHostVisibility: (hidden: boolean) => renderer.setHostVisibility(hidden),
    showSuggestion: (suggestion: AiSuggestionInput) => renderer.showSuggestion(suggestion),
    setAiSuggestionLabels: (labels: AiSuggestionLabels) => renderer.setAiSuggestionLabels(labels),
    acceptSuggestion: () => renderer.acceptSuggestion(),
    dismissSuggestion: () => renderer.dismissSuggestion(),
    getSuggestion: () => renderer.getSuggestion(),
    getDocumentMetrics: (
      snapshot: Pick<DocumentSnapshot, "documentGeneration" | "contentRevision">,
    ) => renderer.getDocumentMetrics?.(snapshot) ?? null,
    getSelectionSnapshot: () => renderer.getSelectionSnapshot(),
    undo: () => renderer.undo(),
    focus: () => renderer.focus(),
    setSelection: (from: number, to: number) => renderer.setSelection(from, to),
    scrollToLine: (
      line: number,
      scrollOptions?: { readonly select?: boolean; readonly focus?: boolean },
    ) => renderer.scrollToLine(line, scrollOptions),
    requestMeasure: () => renderer.requestMeasure(),
    isComposing: () => renderer.isComposing,
    flushPendingEdits: () => renderer.flushPendingEdits(),
    setSyntaxPlugins: (plugins: readonly MarkdownSyntaxPlugin[]) =>
      renderer.setSyntaxPlugins(plugins),
    addSyntaxPlugin: (plugin: MarkdownSyntaxPlugin) => renderer.addSyntaxPlugin(plugin),
    runDocumentLint: (opts?: DocumentLinterOptions) => renderer.runDocumentLint(opts),
    runMarkdownLint: (config?: Record<string, unknown>) => renderer.runMarkdownLintCommand(config),
    fixAllMarkdownLint: (config?: Record<string, unknown>) => renderer.fixAllMarkdownLint(config),
    clearMarkdownLint: () => renderer.clearMarkdownLint(),
  });
  rendererByPorts.set(ports, renderer);

  return Object.freeze({
    ports,
    destroy() {
      if (destroyed) {
        return;
      }
      destroyed = true;
      unsubscribeTransitions();
      renderer.destroy();
    },
  });
}

/** @internal Used only by the package's testing entrypoint. */
export function getRendererForTesting(ports: CodeMirrorEditorPorts): CodeMirrorRenderer {
  const renderer = rendererByPorts.get(ports);
  if (!renderer) {
    throw new Error("The editor ports were not created by this package instance.");
  }
  return renderer;
}
