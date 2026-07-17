import { createContext, useCallback, useContext, useMemo, useRef, type ReactNode } from "react";
import type { CodeMirrorEditorPorts } from "../components/CodeMirrorEditor/bridge";
import type { OutlineItem } from "../components/OutlinePanel";
import type { TocTarget } from "../types";
import { useOutlineController } from "./useOutlineController";

export interface EditorUiUnsupportedCommandResult {
  readonly status: "unsupported";
  readonly reason: "not-available-in-active-editor";
}

export type EditorUiCommandResult = void | EditorUiUnsupportedCommandResult;

export interface EditorUiCommandSlots {
  readonly openMdxComponentMenu: () => EditorUiCommandResult;
  readonly continueAiWriting: () => Promise<EditorUiCommandResult>;
}

export type EditorRendererPortsAccess =
  | { readonly status: "available"; readonly ports: CodeMirrorEditorPorts }
  | { readonly status: "unavailable"; readonly reason: "editor-not-mounted" };

export interface EditorUiProviderProps {
  readonly children?: ReactNode;
  readonly markdown: string;
  readonly showToast: (message: string | null) => void;
}

export interface EditorUiContextValue {
  readonly state: EditorUiStateContextValue;
  readonly actions: EditorUiActionsContextValue;
  readonly outline: readonly OutlineItem[];
  readonly tocTarget: TocTarget | null;
  readonly activeOutlineId: string | null;
  readonly setActiveOutlineId: (id: string | null) => void;
  readonly jumpToTocItem: (target: Omit<TocTarget, "nonce">) => void;
  readonly jumpToMarkdownFragment: (markdown: string, fragment: string | null) => void;
  readonly updateActiveOutlineForLine: (line: number) => void;
  readonly registerRendererPorts: (ports: CodeMirrorEditorPorts) => () => void;
  readonly getRendererPorts: () => EditorRendererPortsAccess;
}

export interface EditorUiStateContextValue {
  readonly outline: readonly OutlineItem[];
  readonly tocTarget: TocTarget | null;
  readonly activeOutlineId: string | null;
}

export interface EditorUiActionsContextValue {
  readonly setActiveOutlineId: (id: string | null) => void;
  readonly jumpToTocItem: (target: Omit<TocTarget, "nonce">) => void;
  readonly jumpToMarkdownFragment: (markdown: string, fragment: string | null) => void;
  readonly updateActiveOutlineForLine: (line: number) => void;
  readonly registerRendererPorts: (ports: CodeMirrorEditorPorts) => () => void;
  readonly getRendererPorts: () => EditorRendererPortsAccess;
}

const unsupportedEditorCommandResult: EditorUiUnsupportedCommandResult = Object.freeze({
  status: "unsupported",
  reason: "not-available-in-active-editor",
});

export const unsupportedEditorUiCommandSlots: EditorUiCommandSlots = Object.freeze({
  openMdxComponentMenu: () => unsupportedEditorCommandResult,
  continueAiWriting: async () => unsupportedEditorCommandResult,
});

const unavailableRendererPorts: EditorRendererPortsAccess = Object.freeze({
  status: "unavailable",
  reason: "editor-not-mounted",
});

const EditorUiStateContext = createContext<EditorUiStateContextValue | null>(null);
const EditorUiActionsContext = createContext<EditorUiActionsContextValue | null>(null);

export function EditorUiProvider({ children, markdown, showToast }: EditorUiProviderProps) {
  const rendererPortsRef = useRef<CodeMirrorEditorPorts | null>(null);
  const outline = useOutlineController({ markdown, showToast });

  const registerRendererPorts = useCallback((ports: CodeMirrorEditorPorts) => {
    if (rendererPortsRef.current !== null) {
      throw new Error("Only one active Markdown renderer may register with EditorUiProvider.");
    }
    rendererPortsRef.current = ports;
    let registered = true;

    return () => {
      if (!registered) {
        return;
      }
      registered = false;
      if (rendererPortsRef.current === ports) {
        rendererPortsRef.current = null;
      }
    };
  }, []);

  const getRendererPorts = useCallback((): EditorRendererPortsAccess => {
    const ports = rendererPortsRef.current;
    return ports === null ? unavailableRendererPorts : { status: "available", ports };
  }, []);

  const state = useMemo<EditorUiStateContextValue>(
    () => ({
      outline: outline.outline,
      tocTarget: outline.tocTarget,
      activeOutlineId: outline.activeOutlineId,
    }),
    [outline.activeOutlineId, outline.outline, outline.tocTarget],
  );

  const actions = useMemo<EditorUiActionsContextValue>(
    () => ({
      setActiveOutlineId: outline.setActiveOutlineId,
      jumpToTocItem: outline.jumpToTocItem,
      jumpToMarkdownFragment: outline.jumpToMarkdownFragment,
      updateActiveOutlineForLine: outline.updateActiveOutlineForLine,
      registerRendererPorts,
      getRendererPorts,
    }),
    [
      getRendererPorts,
      outline.jumpToMarkdownFragment,
      outline.jumpToTocItem,
      outline.setActiveOutlineId,
      outline.updateActiveOutlineForLine,
      registerRendererPorts,
    ],
  );

  return (
    <EditorUiActionsContext.Provider value={actions}>
      <EditorUiStateContext.Provider value={state}>{children}</EditorUiStateContext.Provider>
    </EditorUiActionsContext.Provider>
  );
}

export function useEditorUiState(): EditorUiStateContextValue {
  const state = useContext(EditorUiStateContext);
  if (!state) {
    throw new Error("useEditorUiState must be used within an EditorUiProvider.");
  }
  return state;
}

export function useEditorUiActions(): EditorUiActionsContextValue {
  const actions = useContext(EditorUiActionsContext);
  if (!actions) {
    throw new Error("useEditorUiActions must be used within an EditorUiProvider.");
  }
  return actions;
}

export function useEditorUi(): EditorUiContextValue {
  const state = useEditorUiState();
  const actions = useEditorUiActions();

  return {
    state,
    actions,
    ...state,
    ...actions,
  };
}
