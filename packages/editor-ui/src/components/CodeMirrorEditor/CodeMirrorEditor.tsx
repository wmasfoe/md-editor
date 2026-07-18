import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from "react";
import type { DocumentState } from "@md-editor/editor-core";
import { useEditorUiActions } from "../../hooks/useEditorUi";
import {
  createCodeMirrorEditorBridge,
  type CodeMirrorEditorBridge,
  type CodeMirrorEditorExternalEditResult,
  type CodeMirrorEditorPorts,
  type CodeMirrorEditorSyncError,
} from "./bridge";
import "./CodeMirrorEditor.css";

export interface CodeMirrorEditorProps {
  readonly document: DocumentState;
  readonly lineNumbers?: boolean;
  readonly fontSize?: number;
  readonly hidden?: boolean;
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly ariaLabel?: string;
  readonly resolveImageSrc?: (source: string) => string;
  readonly onSyncError?: (error: CodeMirrorEditorSyncError) => void;
  readonly onQueuedExternalEditResult?: (result: CodeMirrorEditorExternalEditResult) => void;
  readonly onRendererPortsChange?: (ports: CodeMirrorEditorPorts | null) => void;
}

export function CodeMirrorEditor({
  document,
  lineNumbers = false,
  fontSize,
  hidden = false,
  className,
  style,
  ariaLabel = "Markdown 编辑器",
  resolveImageSrc,
  onSyncError,
  onQueuedExternalEditResult,
  onRendererPortsChange,
}: CodeMirrorEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const bridgeRef = useRef<CodeMirrorEditorBridge | null>(null);
  const callbacksRef = useRef({
    onQueuedExternalEditResult,
    onRendererPortsChange,
    resolveImageSrc,
    onSyncError,
  });
  callbacksRef.current = {
    onQueuedExternalEditResult,
    onRendererPortsChange,
    resolveImageSrc,
    onSyncError,
  };
  const [syncStatus, setSyncStatus] = useState<"synchronized" | "sync-error">("synchronized");
  const { registerRendererPorts } = useEditorUiActions();
  const subscribeSnapshot = useCallback(
    (onStoreChange: () => void) => document.subscribeSnapshot(onStoreChange),
    [document],
  );
  const getSnapshot = useCallback(() => document.getSnapshot(), [document]);
  const snapshot = useSyncExternalStore(subscribeSnapshot, getSnapshot, getSnapshot);

  useLayoutEffect(() => {
    const parent = hostRef.current;
    if (!parent) {
      throw new Error("CodeMirrorEditor requires a mounted host element.");
    }

    const bridge = createCodeMirrorEditorBridge({
      parent,
      document,
      resolveImageSrc(source) {
        return callbacksRef.current.resolveImageSrc?.(source) ?? source;
      },
      onSyncError(error) {
        setSyncStatus("sync-error");
        callbacksRef.current.onSyncError?.(error);
      },
      onQueuedExternalEditResult(result) {
        callbacksRef.current.onQueuedExternalEditResult?.(result);
      },
    });
    bridgeRef.current = bridge;
    const unregisterRendererPorts = registerRendererPorts(bridge.ports);
    callbacksRef.current.onRendererPortsChange?.(bridge.ports);

    return () => {
      unregisterRendererPorts();
      bridgeRef.current = null;
      bridge.destroy();
      callbacksRef.current.onRendererPortsChange?.(null);
    };
  }, [document, registerRendererPorts]);

  useLayoutEffect(() => {
    bridgeRef.current?.ports.setLineNumbers(lineNumbers);
  }, [lineNumbers]);

  useLayoutEffect(() => {
    const host = hostRef.current;
    const bridge = bridgeRef.current;
    if (!host || !bridge) {
      return;
    }

    if (hidden) {
      bridge.ports.setHostVisibility(true);
      host.inert = true;
    } else {
      host.inert = false;
      bridge.ports.setHostVisibility(false);
    }
  }, [hidden]);

  const hiddenStyle: CSSProperties | undefined = hidden
    ? { visibility: "hidden", pointerEvents: "none" }
    : undefined;
  const fontSizeStyle: CSSProperties | undefined =
    fontSize !== undefined && Number.isFinite(fontSize) && fontSize > 0 ? { fontSize } : undefined;

  return (
    <div
      ref={hostRef}
      className={["code-mirror-editor-host", className].filter(Boolean).join(" ")}
      style={{ ...style, ...fontSizeStyle, ...hiddenStyle }}
      aria-label={ariaLabel}
      aria-hidden={hidden || undefined}
      data-document-generation={snapshot.documentGeneration}
      data-state-revision={snapshot.stateRevision}
      data-sync-status={syncStatus}
    />
  );
}
