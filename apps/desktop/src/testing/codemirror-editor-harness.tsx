import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  createDocumentState,
  switchEditorModeSafely,
  type DocumentState,
  type EditorMode,
} from "@md-editor/editor-core";
import {
  CodeMirrorEditor,
  EditorUiProvider,
  useEditorUiActions,
  type CodeMirrorEditorExternalEditResult,
  type CodeMirrorEditorPorts,
  type CodeMirrorEditorSyncError,
  type EditorUiActionsContextValue,
} from "@md-editor/editor-ui";
import { inspectCodeMirrorEditorForTesting } from "@md-editor/editor-ui/CodeMirrorEditor/testing";

interface SubscriptionDiagnostics {
  snapshotActive: number;
  snapshotSubscribed: number;
  snapshotUnsubscribed: number;
  snapshotInvalidations: number;
  transitionActive: number;
  transitionSubscribed: number;
  transitionUnsubscribed: number;
  transitionDeliveries: number;
}

interface HarnessControls {
  readonly setEditorMounted: (mounted: boolean) => void;
  readonly setFontSize: (fontSize: number) => void;
  readonly setLineNumbers: (enabled: boolean) => void;
  readonly setPreviewVisible: (visible: boolean) => void;
  readonly rerender: () => void;
}

export interface CodeMirrorEditorHarnessDiagnostics {
  readonly cmEditorCount: number;
  readonly rendererAccess: "available" | "unavailable";
  readonly renderer: ReturnType<typeof inspectCodeMirrorEditorForTesting> | null;
  readonly rendererLifecycles: readonly ReturnType<typeof inspectCodeMirrorEditorForTesting>[];
  readonly subscriptions: Readonly<SubscriptionDiagnostics>;
  readonly syncErrorCount: number;
  readonly queuedResultCount: number;
}

export interface CodeMirrorEditorHarnessBridge {
  readonly version: 1;
  getDiagnostics(): CodeMirrorEditorHarnessDiagnostics;
  rerender(): void;
  setMode(
    mode: EditorMode,
  ): ReturnType<typeof switchEditorModeSafely> | { readonly status: "unavailable" };
  setFontSize(fontSize: number): void;
  setLineNumbers(enabled: boolean): void;
  setPreviewVisible(visible: boolean): void;
  applyExternalEdit(
    markdown: string,
  ): CodeMirrorEditorExternalEditResult | { readonly status: "unavailable" };
  replaceDocument(markdown: string, mode?: EditorMode): void;
  unmountEditor(): void;
  mountEditor(): void;
}

declare global {
  interface Window {
    __CODEMIRROR_EDITOR_E2E__?: CodeMirrorEditorHarnessBridge;
  }
}

function createScrollDocument(): string {
  return Array.from({ length: 320 }, (_, index) => `Line ${String(index + 1).padStart(3, "0")}`)
    .join("\n")
    .concat("\n");
}

function createInstrumentedDocument(): {
  readonly document: DocumentState;
  readonly diagnostics: SubscriptionDiagnostics;
} {
  const core = createDocumentState({ markdown: createScrollDocument() });
  const diagnostics: SubscriptionDiagnostics = {
    snapshotActive: 0,
    snapshotSubscribed: 0,
    snapshotUnsubscribed: 0,
    snapshotInvalidations: 0,
    transitionActive: 0,
    transitionSubscribed: 0,
    transitionUnsubscribed: 0,
    transitionDeliveries: 0,
  };

  const document: DocumentState = Object.freeze({
    ...core,
    subscribeSnapshot(listener: Parameters<DocumentState["subscribeSnapshot"]>[0]) {
      diagnostics.snapshotActive += 1;
      diagnostics.snapshotSubscribed += 1;
      const unsubscribe = core.subscribeSnapshot(() => {
        diagnostics.snapshotInvalidations += 1;
        listener();
      });
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        diagnostics.snapshotActive -= 1;
        diagnostics.snapshotUnsubscribed += 1;
        unsubscribe();
      };
    },
    subscribeTransitions(listener: Parameters<DocumentState["subscribeTransitions"]>[0]) {
      diagnostics.transitionActive += 1;
      diagnostics.transitionSubscribed += 1;
      const unsubscribe = core.subscribeTransitions((event) => {
        diagnostics.transitionDeliveries += 1;
        listener(event);
      });
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        diagnostics.transitionActive -= 1;
        diagnostics.transitionUnsubscribed += 1;
        unsubscribe();
      };
    },
  });

  return { document, diagnostics };
}

export function installCodeMirrorEditorHarness(
  rootElement: HTMLElement,
  strictMode: boolean,
): void {
  const runtime = createInstrumentedDocument();
  const rendererLifecycles: CodeMirrorEditorPorts[] = [];
  const syncErrors: CodeMirrorEditorSyncError[] = [];
  const queuedResults: CodeMirrorEditorExternalEditResult[] = [];
  let actions: EditorUiActionsContextValue | null = null;
  let controls: HarnessControls | null = null;
  let externalSequence = 0;

  function requireControls(): HarnessControls {
    if (!controls) throw new Error("The CodeMirror editor harness is not ready.");
    return controls;
  }

  function getRendererAccess() {
    return (
      actions?.getRendererPorts() ?? {
        status: "unavailable" as const,
        reason: "editor-not-mounted" as const,
      }
    );
  }

  const bridge: CodeMirrorEditorHarnessBridge = Object.freeze({
    version: 1,
    getDiagnostics() {
      const access = getRendererAccess();
      return Object.freeze({
        cmEditorCount: rootElement.querySelectorAll(".cm-editor").length,
        rendererAccess: access.status,
        renderer:
          access.status === "available" ? inspectCodeMirrorEditorForTesting(access.ports) : null,
        rendererLifecycles: Object.freeze(
          rendererLifecycles.map((ports) => inspectCodeMirrorEditorForTesting(ports)),
        ),
        subscriptions: Object.freeze({ ...runtime.diagnostics }),
        syncErrorCount: syncErrors.length,
        queuedResultCount: queuedResults.length,
      });
    },
    rerender() {
      requireControls().rerender();
    },
    setMode(mode: EditorMode) {
      const access = getRendererAccess();
      if (access.status !== "available") return { status: "unavailable" as const };
      return switchEditorModeSafely(runtime.document, mode, {
        operationId: `browser:mode:${mode}:${runtime.document.getSnapshot().stateRevision}`,
        renderer: access.ports.mode,
      });
    },
    setFontSize(fontSize: number) {
      requireControls().setFontSize(fontSize);
    },
    setLineNumbers(enabled: boolean) {
      requireControls().setLineNumbers(enabled);
    },
    setPreviewVisible(visible: boolean) {
      requireControls().setPreviewVisible(visible);
    },
    applyExternalEdit(markdown: string) {
      const access = getRendererAccess();
      if (access.status !== "available") return { status: "unavailable" as const };
      const snapshot = runtime.document.getSnapshot();
      externalSequence += 1;
      return access.ports.applyExternalEdit({
        operationId: `browser:external:${externalSequence}`,
        markdown,
        expectedGeneration: snapshot.documentGeneration,
        expectedContentRevision: snapshot.contentRevision,
        selection: "preserve-offset-clamped",
      });
    },
    replaceDocument(markdown: string, mode?: EditorMode) {
      runtime.document.replaceDocument(
        { markdown, savedMarkdown: markdown, mode },
        { kind: "command", commandId: "file.open" },
      );
    },
    unmountEditor() {
      requireControls().setEditorMounted(false);
    },
    mountEditor() {
      requireControls().setEditorMounted(true);
    },
  });

  function HarnessApp() {
    const [editorMounted, setEditorMounted] = useState(true);
    const [fontSize, setFontSize] = useState(16);
    const [lineNumbers, setLineNumbers] = useState(false);
    const [previewVisible, setPreviewVisible] = useState(false);
    const [, setRenderSequence] = useState(0);

    controls = {
      setEditorMounted,
      setFontSize,
      setLineNumbers,
      setPreviewVisible,
      rerender: () => setRenderSequence((sequence) => sequence + 1),
    };

    return (
      <EditorUiProvider markdown={runtime.document.getSnapshot().markdown} showToast={() => {}}>
        <ActionCapture onActions={(value) => (actions = value)} />
        <div
          style={{
            position: "relative",
            display: "flex",
            flexDirection: "column",
            height: 360,
            width: 720,
          }}
        >
          {editorMounted ? (
            <CodeMirrorEditor
              document={runtime.document}
              fontSize={fontSize}
              lineNumbers={lineNumbers}
              hidden={previewVisible}
              onSyncError={(error) => syncErrors.push(error)}
              onQueuedExternalEditResult={(result) => queuedResults.push(result)}
              onRendererPortsChange={(ports) => {
                if (ports && rendererLifecycles.at(-1) !== ports) {
                  rendererLifecycles.push(ports);
                }
              }}
            />
          ) : null}
          {previewVisible ? (
            <div
              data-testid="asset-preview"
              style={{ position: "absolute", inset: 0, background: "white" }}
            />
          ) : null}
        </div>
      </EditorUiProvider>
    );
  }

  const app = <HarnessApp />;
  createRoot(rootElement).render(strictMode ? <StrictMode>{app}</StrictMode> : app);
  window.__CODEMIRROR_EDITOR_E2E__ = bridge;
}

function ActionCapture({
  onActions,
}: {
  readonly onActions: (actions: EditorUiActionsContextValue) => void;
}) {
  onActions(useEditorUiActions());
  return null;
}
