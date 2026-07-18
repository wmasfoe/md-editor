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
  type CodeMirrorRenderer,
  type ExternalEditRequest,
  type ExternalEditResult,
  type LineNumberPortResult,
} from "@md-editor/renderer-codemirror";

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
  setLineNumbers(enabled: boolean): LineNumberPortResult;
  setHostVisibility(hidden: boolean): void;
  focus(): void;
  requestMeasure(): void;
}

export type CodeMirrorEditorSyncError =
  | {
      readonly kind: "renderer-sync";
      readonly delivery: Extract<RendererSyncDeliveryResult, { readonly status: "sync-error" }>;
    }
  | {
      readonly kind: "local-change-rejected";
      readonly result: Exclude<DocumentMutationResult, { readonly status: "applied" }>;
    };

export interface CodeMirrorEditorBridgeOptions {
  readonly parent: HTMLElement;
  readonly document: DocumentState;
  readonly resolveImageSrc?: (source: string) => string;
  readonly onSyncError: (error: CodeMirrorEditorSyncError) => void;
  readonly onQueuedExternalEditResult: (result: CodeMirrorEditorExternalEditResult) => void;
}

export interface CodeMirrorEditorBridge {
  readonly ports: CodeMirrorEditorPorts;
  destroy(): void;
}

const rendererByPorts = new WeakMap<CodeMirrorEditorPorts, CodeMirrorRenderer>();

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

  const renderer = createCodeMirrorRenderer({
    parent: options.parent,
    initialSnapshot: options.document.getSnapshot(),
    resolveImagePreview: ({ source }) => options.resolveImageSrc?.(source) ?? source,
    onEditorChange(change) {
      const result = options.document.applyEditorChange(change.markdown, change.origin);
      if (result.status !== "applied") {
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
  });

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
    setLineNumbers: (enabled: boolean) => renderer.setLineNumbers(enabled),
    setHostVisibility: (hidden: boolean) => renderer.setHostVisibility(hidden),
    focus: () => renderer.focus(),
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
