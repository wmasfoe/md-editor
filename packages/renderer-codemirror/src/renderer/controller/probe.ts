/** Read-only probe assembly; counters and identities remain owned by the controller. */
import { redoDepth, undoDepth } from "@codemirror/commands";
import type { WysiwygDiagnostics } from "../../diagnostics.ts";
import { editorModeField } from "../../mode.ts";
import { inspectWysiwygProjection } from "../../wysiwyg/state/projection-field.ts";
import type { RendererTestingProbeInternal, RendererViewAdapter } from "../types.ts";
import type { TransactionLedger } from "./transaction-ledger.ts";

type ProbeValues = Pick<
  RendererTestingProbeInternal,
  | "clientId"
  | "viewId"
  | "stateEpochId"
  | "rootExtensionId"
  | "documentGeneration"
  | "stateRevision"
  | "contentRevision"
  | "codeBlockLineNumbers"
  | "viewDestructionCount"
  | "explicitStateCreationCount"
  | "stateReplacementCount"
  | "highestPublishedRendererSequence"
  | "lastAcknowledgedRendererSequence"
  | "queuedExternalEditOperationId"
  | "pendingExternalEditOperationId"
  | "pendingModeOperationId"
  | "persistenceStatus"
  | "lastSyncStatus"
  | "lastErrorCode"
  | "destroyed"
>;
export function createRendererProbe(
  view: RendererViewAdapter,
  diagnostics: WysiwygDiagnostics,
  ledger: TransactionLedger,
  values: ProbeValues,
): RendererTestingProbeInternal {
  const selection = view.state.selection;
  return Object.freeze({
    clientId: values.clientId,
    viewId: values.viewId,
    stateEpochId: values.stateEpochId,
    rootExtensionId: values.rootExtensionId,
    documentGeneration: values.documentGeneration,
    stateRevision: values.stateRevision,
    contentRevision: values.contentRevision,
    mode: view.state.field(editorModeField),
    markdown: view.state.doc.toString(),
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
    scrollTop: view.getScrollTop(),
    focused: view.hasFocus(),
    undoDepth: undoDepth(view.state),
    redoDepth: redoDepth(view.state),
    codeBlockLineNumbers: values.codeBlockLineNumbers,
    viewCreationCount: 1,
    viewDestructionCount: values.viewDestructionCount,
    explicitStateCreationCount: values.explicitStateCreationCount,
    stateReplacementCount: values.stateReplacementCount,
    ...ledger.probeFields(),
    highestPublishedRendererSequence: values.highestPublishedRendererSequence,
    lastAcknowledgedRendererSequence: values.lastAcknowledgedRendererSequence,
    queuedExternalEditOperationId: values.queuedExternalEditOperationId,
    pendingExternalEditOperationId: values.pendingExternalEditOperationId,
    pendingModeOperationId: values.pendingModeOperationId,
    persistenceStatus: values.persistenceStatus,
    lastSyncStatus: values.lastSyncStatus,
    lastErrorCode: values.lastErrorCode,
    destroyed: values.destroyed,
    wysiwyg: diagnostics.snapshot(),
    wysiwygProjection: inspectWysiwygProjection(view.state),
  });
}
