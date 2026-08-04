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
  type MdxComponentsLookup,
  type CodeMirrorEditorClipboardWriter,
  type CodeMirrorEditorExternalEditResult,
  type CodeMirrorEditorPorts,
  type CodeMirrorEditorSyncError,
} from "./bridge";
import "./CodeMirrorEditor.css";

export interface CodeMirrorEditorProps {
  readonly document: DocumentState;
  readonly codeBlockLineNumbers?: boolean;
  readonly fontSize?: number;
  readonly hidden?: boolean;
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly ariaLabel?: string;
  readonly resolveImageSrc?: (source: string) => string;
  readonly writeClipboardText?: CodeMirrorEditorClipboardWriter;
  /** MDX 文件模式:大写标签按组件解析(默认 false = 纯 Markdown) */
  readonly mdxMode?: boolean;
  /** MDX 组件白名单(最小查找接口,纯 metadata);缺省 = 一律占位 */
  readonly mdxComponents?: MdxComponentsLookup;
  readonly onSyncError?: (error: CodeMirrorEditorSyncError) => void;
  readonly onQueuedExternalEditResult?: (result: CodeMirrorEditorExternalEditResult) => void;
  readonly onRendererPortsChange?: (ports: CodeMirrorEditorPorts | null) => void;
}

export function CodeMirrorEditor({
  document,
  codeBlockLineNumbers = false,
  fontSize,
  hidden = false,
  className,
  style,
  ariaLabel = "Markdown 编辑器",
  resolveImageSrc,
  writeClipboardText,
  mdxMode = false,
  mdxComponents,
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
    writeClipboardText,
    mdxMode,
    mdxComponents,
    onSyncError,
  });
  callbacksRef.current = {
    onQueuedExternalEditResult,
    onRendererPortsChange,
    resolveImageSrc,
    writeClipboardText,
    mdxMode,
    mdxComponents,
    onSyncError,
  };
  const hasClipboardWriter = writeClipboardText !== undefined;
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
      writeClipboardText: hasClipboardWriter
        ? (text) => {
            const writer = callbacksRef.current.writeClipboardText;
            if (!writer) {
              throw new Error("CodeMirrorEditor clipboard writer was not initialized.");
            }
            return writer(text);
          }
        : undefined,
      onSyncError(error) {
        setSyncStatus("sync-error");
        callbacksRef.current.onSyncError?.(error);
      },
      onQueuedExternalEditResult(result) {
        callbacksRef.current.onQueuedExternalEditResult?.(result);
      },
      mdxMode: callbacksRef.current.mdxMode,
      mdxComponents: callbacksRef.current.mdxComponents,
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
  }, [document, hasClipboardWriter, registerRendererPorts]);

  useLayoutEffect(() => {
    bridgeRef.current?.ports.setCodeBlockLineNumbers(codeBlockLineNumbers);
  }, [codeBlockLineNumbers]);

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
