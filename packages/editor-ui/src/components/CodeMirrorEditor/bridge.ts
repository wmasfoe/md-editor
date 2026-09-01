import {
  synchronizeRendererEvent,
  type DocumentMutationResult,
  type DocumentState,
  type ExternalEditFinalizeReceipt,
  type ExternalEditReservationResult,
  type ModeReceipt,
  type ModeRequest,
  type ModeRendererPort,
  type MutationBusyResult,
  type MutationRejectedResult,
  type RendererSyncDeliveryResult,
} from "@md-editor/editor-core";
import {
  createCodeMirrorRenderer,
  type CodeMirrorRendererOptions,
  type CodeBlockLineNumberPortResult,
  type CodeMirrorRenderer,
  type ExternalEditRequest,
  type ExternalEditResult,
  type AiSuggestionInput,
  type AiSuggestionValue,
} from "@md-editor/renderer-codemirror";

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
  setCodeBlockLineNumbers(enabled: boolean): CodeBlockLineNumberPortResult;
  setHostVisibility(hidden: boolean): void;
  showSuggestion(suggestion: AiSuggestionInput): void;
  acceptSuggestion(): boolean;
  dismissSuggestion(): boolean;
  getSuggestion(): AiSuggestionValue | null;
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
 * MDX 组件白名单最小接口(与 renderer-codemirror 的 MdxComponentLookup 同形状;
 * 不 import mdx-component-registry,遵守 editor-ui 包边界)。
 */
export interface MdxComponentsLookup {
  getByComponentName(
    name: string,
  ): { readonly component: { readonly displayName: string } } | undefined;
}

export interface CodeMirrorEditorBridgeOptions {
  readonly parent: HTMLElement;
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

  const rendererOptions: CodeMirrorRendererOptions = {
    parent: options.parent,
    initialSnapshot: options.document.getSnapshot(),
    resolveImagePreview: ({ source }) => options.resolveImageSrc?.(source) ?? source,
    writeClipboardText: options.writeClipboardText ?? defaultWriteClipboardText,
    mdxMode: options.mdxMode ?? false,
    mdxComponents: options.mdxComponents,
    openLinkTarget: options.openLinkTarget,
    onCursorLineChange: options.onCursorLineChange,
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
  const ports: CodeMirrorEditorPorts = Object.freeze({
    clientId: renderer.clientId,
    mode,
    applyExternalEdit,
    setCodeBlockLineNumbers: (enabled: boolean) => renderer.setCodeBlockLineNumbers(enabled),
    setHostVisibility: (hidden: boolean) => renderer.setHostVisibility(hidden),
    showSuggestion: (suggestion: AiSuggestionValue) => renderer.showSuggestion(suggestion),
    acceptSuggestion: () => renderer.acceptSuggestion(),
    dismissSuggestion: () => renderer.dismissSuggestion(),
    getSuggestion: () => renderer.getSuggestion(),
    getSelectionSnapshot: () => renderer.getSelectionSnapshot(),
    focus: () => renderer.focus(),
    setSelection: (from: number, to: number) => renderer.setSelection(from, to),
    scrollToLine: (
      line: number,
      scrollOptions?: { readonly select?: boolean; readonly focus?: boolean },
    ) => renderer.scrollToLine(line, scrollOptions),
    requestMeasure: () => renderer.requestMeasure(),
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
