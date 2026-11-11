import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { CodeMirrorEditor, type CodeMirrorEditorProps } from "@md-editor/editor-react";
import type { CodeMirrorEditorPorts } from "@md-editor/editor";
import { useTranslation } from "@md-editor/i18n";
import { useOptionalEditorUiActions } from "../hooks/useEditorUi";

export type AppEditorProps = CodeMirrorEditorProps;

/** Connect application outline, language and command access to the standalone React editor. */
export function AppEditor({
  onCursorLineChange,
  onRendererPortsChange,
  language,
  ...props
}: AppEditorProps) {
  const actions = useOptionalEditorUiActions();
  const { i18n } = useTranslation();
  const [ports, setPorts] = useState<CodeMirrorEditorPorts | null>(null);
  const callbacks = useRef({ onCursorLineChange, onRendererPortsChange });
  callbacks.current = { onCursorLineChange, onRendererPortsChange };

  const handlePortsChange = useCallback((next: CodeMirrorEditorPorts | null) => {
    setPorts(next);
    callbacks.current.onRendererPortsChange?.(next);
  }, []);

  useLayoutEffect(() => {
    if (ports && actions) return actions.registerRendererPorts(ports);
  }, [actions, ports]);

  // Keep application-wide language events outside the independently usable React package.
  useEffect(() => {
    const refreshLint = () => {
      if (props.enableMarkdownLint) ports?.recomputeMarkdownLint();
    };
    window.addEventListener("md-editor:language-changed", refreshLint);
    return () => window.removeEventListener("md-editor:language-changed", refreshLint);
  }, [ports, props.enableMarkdownLint]);

  return (
    <CodeMirrorEditor
      {...props}
      language={language ?? i18n?.language}
      onCursorLineChange={(line) => {
        callbacks.current.onCursorLineChange?.(line);
        actions?.updateActiveOutlineForLine(line);
      }}
      onRendererPortsChange={handlePortsChange}
    />
  );
}
