/**
 * @file types.ts
 * @description `renderer/` 子模块共享的类型契约（渲染器公开接口、视图适配器协议、测试探针）。
 *
 * 本模块是 `renderer/` 依赖图的叶子：只重述契约、不 import 任何运行期值，
 * 供 `view-adapter` / `controller` / `index` 与包内调用方共享。
 */

import type { EditorState, StateEffect, Transaction, TransactionSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { Diagnostic } from "@codemirror/lint";
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
import type { Markdown } from "@md-editor/shared";
import type { WysiwygDiagnosticsSnapshot } from "../diagnostics.ts";
import type { MarkdownSyntaxPlugin } from "../plugins/syntax-plugin.ts";
import type { MdxComponentLookup } from "../wysiwyg/projections/mdx-projection.ts";
import type { WysiwygProjectionSnapshot } from "../wysiwyg/state/types.ts";
import type { ImagePreviewResolver } from "../wysiwyg/view/image-resolver.ts";
import type {
  AiSuggestionInput,
  AiSuggestionLabels,
  AiSuggestionValue,
} from "../wysiwyg/view/suggestion.ts";
import type { DocumentLinterOptions } from "../lint/types.ts";
export type { DocumentLinterOptions };

export interface CodeMirrorRendererOptions {
  readonly parent: HTMLElement;
  readonly initialSnapshot: DocumentSnapshot;
  readonly resolveImagePreview?: ImagePreviewResolver;
  readonly writeClipboardText?: (text: string) => Promise<void>;
  /** MDX 文件模式:大写标签按组件解析(默认 false = 纯 Markdown) */
  readonly mdxMode?: boolean;
  /** MDX 组件白名单查找(最小接口,不执行组件代码);缺省 null = 一律占位 */
  readonly mdxComponents?: MdxComponentLookup;
  /** 链接打开回调(宿主决策:内部 markdown 文件打开文档,外部链接走系统浏览器) */
  readonly openLinkTarget?: (url: string) => void;
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
  /** 光标所在行号变更回调(1-based)，用于联动大纲等 UI 高亮 */
  readonly onCursorLineChange?: (line: number) => void;
  /** D-2 可配 dim 强度（轮1 architect WATCH concern-8）：宿主注入通道，缺省走 facet 默认 0.38；
   * 读取时按 spec 区间 [0.30, 0.50] 硬夹（resolveDimOpacity）。 */
  readonly focusDimOpacity?: number;
  /** 是否开启实时 Markdown 规范检查（默认 false，由宿主按需开启） */
  readonly enableMarkdownLint?: boolean;
  /** 可选语法扩展插件列表（纯增量加载，未配置时保持标准 CommonMark/GFM） */
  readonly plugins?: readonly MarkdownSyntaxPlugin[];
  /** 兼容别名：同 plugins */
  readonly syntaxPlugins?: readonly MarkdownSyntaxPlugin[];
  /** AI 建议徽标国际化文案 */
  readonly aiSuggestionLabels?: AiSuggestionLabels;
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

export type CodeBlockLineNumberPortResult =
  { readonly status: "applied" } | { readonly status: "noop" } | { readonly status: "destroyed" };

/**
 * 行内标记源码显隐开关的端口结果。
 *
 * 独立于 `CodeBlockLineNumberPortResult`：两者语义无关，未来任一方的 state 集合变化
 * 都不应牵动另一方（禁止复用同一导出）。
 */
export type InlineStyleMarkerPortResult =
  { readonly status: "applied" } | { readonly status: "noop" } | { readonly status: "destroyed" };

export type MarkdownLintPortResult =
  { readonly status: "applied" } | { readonly status: "noop" } | { readonly status: "destroyed" };

export interface CodeMirrorRenderer {
  readonly clientId: string;
  sync(event: DocumentStateEvent): RendererSyncResult;
  reconcile(snapshot: DocumentSnapshot): RendererSyncResult;
  applyReservedExternalEdit(request: ExternalEditRequest): ExternalEditResult;
  applyMode(request: ModeRequest): ModePortResult;
  rollbackMode(receipt: ModeReceipt): void;
  setCodeBlockLineNumbers(enabled: boolean): CodeBlockLineNumberPortResult;
  setInlineStyleMarkers(enabled: boolean): InlineStyleMarkerPortResult;
  setMarkdownLint(enabled: boolean): MarkdownLintPortResult;
  recomputeMarkdownLint(): MarkdownLintPortResult;
  setHostVisibility(hidden: boolean): void;
  showSuggestion(suggestion: AiSuggestionInput): void;
  setAiSuggestionLabels(labels: AiSuggestionLabels): void;
  acceptSuggestion(): boolean;
  dismissSuggestion(): boolean;
  getSuggestion(): AiSuggestionValue | null;
  moveBlockUp(): boolean;
  moveBlockDown(): boolean;
  duplicateBlock(): boolean;
  deleteBlock(): boolean;
  /** D-2：切换专注模式，返回切换后状态（供 host 镜像到菜单勾选态） */
  toggleFocusMode(): boolean;
  /** 回读视图轴（专注/打字机）真实开关态，供宿主核对菜单镜像一致性（S1(b)/MED-4） */
  getViewModeState(): { readonly focus: boolean; readonly typewriter: boolean };
  /** D-2：切换打字机模式，返回切换后状态 */
  toggleTypewriterMode(): boolean;
  getSelectionSnapshot(): {
    readonly from: number;
    readonly to: number;
    readonly text: string;
    readonly head: number;
  };
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
  readonly isComposing: boolean;
  /** 将当前未提交的投影控件/表单（例如 WYSIWYG 表格单元格）同步刷新到底层文档 */
  flushPendingEdits(): boolean;
  /** 安装/挂载 Markdown 语法扩展插件（支持链式调用） */
  use(...plugins: (MarkdownSyntaxPlugin | readonly MarkdownSyntaxPlugin[])[]): this;
  /** 全量替换并热重载 Markdown 语法扩展插件列表（用于启用/禁用插件热更新） */
  setPlugins(plugins: readonly MarkdownSyntaxPlugin[]): this;
  /** 执行文档 MarkdownLint 与链接检查，将诊断结果同步分发至视口 */
  runDocumentLint(options?: DocumentLinterOptions): Promise<readonly Diagnostic[]>;
  /** 运行单次 Markdown 规范检查，分发诊断并打开问题面板 */
  runMarkdownLintCommand(config?: Record<string, unknown>): {
    readonly total: number;
    readonly errors: number;
    readonly warnings: number;
  };
  /** 一键自动修复所有支持自动修复的 Markdown 规范问题 */
  fixAllMarkdownLint(config?: Record<string, unknown>): {
    readonly appliedCount: number;
    readonly remainingCount: number;
  };
  destroy(): void;
}

/**
 * 视图轴（专注/打字机）开关快照。
 *
 * 视图轴与文档轴**正交**：文档边界（换文档 / 同一文档重装载）重建 `EditorState` 时，
 * 视图轴开关必须由渲染层**继承**，不能随文档重置 —— 否则用户的视图偏好被静默关掉，
 * 且宿主原生菜单镜像会与渲染层真实状态发散（S1(b) / MED-4 根因）。
 */
export interface ViewAxisState {
  readonly focus: boolean;
  readonly typewriter: boolean;
}

export interface RendererViewAdapter {
  readonly state: EditorState;
  readonly isComposing: boolean;
  /** 底层真实 CodeMirror EditorView 引用（测试 mock 适配器可能缺省） */
  readonly editorView?: EditorView;
  dispatch(spec: TransactionSpec): void;
  dispatchTransaction(transaction: Transaction): void;
  setState(state: EditorState): void;
  scrollSnapshot(): StateEffect<unknown>;
  getScrollTop(): number;
  setScrollTop(value: number): void;
  getCursorCoordinates?(pos: number): {
    readonly top: number;
    readonly bottom: number;
    readonly left: number;
    readonly right: number;
  } | null;
  getViewportRect?(): {
    readonly top: number;
    readonly bottom: number;
    readonly left: number;
    readonly right: number;
  } | null;
  getLineBlockTop?(pos: number): number | null;
  hasFocus(): boolean;
  focus(): void;
  requestMeasure(afterMeasure?: () => void): void;
  clearDomSelection(): void;
  flushPendingEdits?(): boolean;
  destroy(): void;
}

export interface RendererViewFactoryInput {
  readonly parent: HTMLElement;
  readonly state: EditorState;
  readonly onCompositionStart: () => void;
  readonly onCompositionEnd: () => void;
}

export type RendererViewFactory = (input: RendererViewFactoryInput) => RendererViewAdapter;

export interface CodeMirrorRendererControllerOptions {
  readonly useNativeCodeLanguages: boolean;
}

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
  readonly selectionRanges: readonly {
    readonly anchor: number;
    readonly head: number;
  }[];
  readonly scrollTop: number;
  readonly focused: boolean;
  readonly undoDepth: number;
  readonly redoDepth: number;
  readonly codeBlockLineNumbers: boolean;
  readonly inlineStyleMarkers: boolean;
  readonly viewCreationCount: number;
  readonly viewDestructionCount: number;
  readonly explicitStateCreationCount: number;
  readonly stateReplacementCount: number;
  readonly documentTransactionCount: number;
  readonly modeTransactionCount: number;
  readonly externalEditTransactionCount: number;
  readonly reconciliationTransactionCount: number;
  readonly codeBlockLineNumberTransactionCount: number;
  readonly inlineStyleMarkerTransactionCount: number;
  /** 进入“无激活增量但需冻结新投影”的选区分支次数（显形点集失效见证）。 */
  readonly selectionFreezeWithoutDeltaCount: number;
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
  readonly wysiwyg: WysiwygDiagnosticsSnapshot;
  readonly wysiwygProjection: WysiwygProjectionSnapshot;
}
