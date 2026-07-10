import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import type { EditorMode } from "@md-editor/editor-core";
import type { OutlineItem } from "../components/OutlinePanel";
import type { EditorScrollTarget, TocTarget } from "../types";
import {
  clampEditorScrollRatio,
  createEditorDocumentKey,
  createModeScrollTarget,
  type PendingModeScrollTarget,
} from "../utils/editor-ui-state";
import { useOutlineController } from "./useOutlineController";

export interface EditorUiCommandSlots {
  readonly openMdxComponentMenu: () => void;
  readonly continueAiWriting: () => Promise<void>;
}

export interface EditorUiProviderProps {
  readonly children?: ReactNode;
  readonly filePath: string | null;
  readonly markdown: string;
  readonly showToast: (message: string | null) => void;
  readonly initialDocumentRevision?: number;
}

export interface EditorUiContextValue {
  readonly state: EditorUiStateContextValue;
  readonly actions: EditorUiActionsContextValue;
  readonly documentKey: string;
  readonly documentRevision: number;
  readonly setDocumentRevision: Dispatch<SetStateAction<number>>;
  readonly bumpDocumentRevision: () => void;
  readonly outline: readonly OutlineItem[];
  readonly tocTarget: TocTarget | null;
  readonly activeOutlineId: string | null;
  readonly setActiveOutlineId: (id: string | null) => void;
  readonly jumpToTocItem: (target: Omit<TocTarget, "nonce">) => void;
  readonly jumpToMarkdownFragment: (markdown: string, fragment: string | null) => void;
  readonly updateActiveOutlineForLine: (line: number) => void;
  readonly modeScrollTarget: PendingModeScrollTarget | null;
  readonly updateModeScrollRatio: (ratio: number) => void;
  readonly startModeScrollTarget: (mode: EditorMode) => void;
  readonly clearModeScrollTarget: () => void;
  readonly completeModeScrollTarget: (nonce: number) => void;
  readonly registerEditorCommands: (commands: EditorUiCommandSlots) => void;
  readonly getEditorCommands: () => EditorUiCommandSlots;
}

export interface EditorUiStateContextValue {
  readonly documentKey: string;
  readonly documentRevision: number;
  readonly outline: readonly OutlineItem[];
  readonly tocTarget: TocTarget | null;
  readonly activeOutlineId: string | null;
  readonly modeScrollTarget: PendingModeScrollTarget | null;
}

export interface EditorUiActionsContextValue {
  readonly setDocumentRevision: Dispatch<SetStateAction<number>>;
  readonly bumpDocumentRevision: () => void;
  readonly setActiveOutlineId: (id: string | null) => void;
  readonly jumpToTocItem: (target: Omit<TocTarget, "nonce">) => void;
  readonly jumpToMarkdownFragment: (markdown: string, fragment: string | null) => void;
  readonly updateActiveOutlineForLine: (line: number) => void;
  readonly updateModeScrollRatio: (ratio: number) => void;
  readonly startModeScrollTarget: (mode: EditorMode) => void;
  readonly clearModeScrollTarget: () => void;
  readonly completeModeScrollTarget: (nonce: number) => void;
  readonly registerEditorCommands: (commands: EditorUiCommandSlots) => void;
  readonly getEditorCommands: () => EditorUiCommandSlots;
}

export const emptyEditorUiCommandSlots: EditorUiCommandSlots = {
  openMdxComponentMenu: () => {},
  continueAiWriting: async () => {},
};

const EditorUiStateContext = createContext<EditorUiStateContextValue | null>(null);
const EditorUiActionsContext = createContext<EditorUiActionsContextValue | null>(null);

export function EditorUiProvider({
  children,
  filePath,
  initialDocumentRevision = 0,
  markdown,
  showToast,
}: EditorUiProviderProps) {
  const [documentRevision, setDocumentRevision] = useState(initialDocumentRevision);
  const [modeScrollTarget, setModeScrollTarget] = useState<PendingModeScrollTarget | null>(null);
  const activeScrollRatioRef = useRef(0);
  const commandSlotsRef = useRef<EditorUiCommandSlots>(emptyEditorUiCommandSlots);
  const outline = useOutlineController({ markdown, showToast });
  const documentKey = createEditorDocumentKey(filePath, documentRevision);

  const bumpDocumentRevision = useCallback(() => {
    setDocumentRevision((current) => current + 1);
  }, []);

  const updateModeScrollRatio = useCallback((ratio: number) => {
    const clamped = clampEditorScrollRatio(ratio);
    if (clamped !== null) {
      activeScrollRatioRef.current = clamped;
    }
  }, []);

  const startModeScrollTarget = useCallback((mode: EditorMode) => {
    setModeScrollTarget(createModeScrollTarget(mode, activeScrollRatioRef.current));
  }, []);

  const clearModeScrollTarget = useCallback(() => {
    setModeScrollTarget(null);
  }, []);

  const completeModeScrollTarget = useCallback((nonce: number) => {
    setModeScrollTarget((current) => (current?.target.nonce === nonce ? null : current));
  }, []);

  const registerEditorCommands = useCallback((commands: EditorUiCommandSlots) => {
    commandSlotsRef.current = commands;
  }, []);

  const getEditorCommands = useCallback(() => commandSlotsRef.current, []);

  useEffect(() => {
    activeScrollRatioRef.current = 0;
    setModeScrollTarget(null);
  }, [documentKey]);

  const state = useMemo<EditorUiStateContextValue>(
    () => ({
      documentKey,
      documentRevision,
      outline: outline.outline,
      tocTarget: outline.tocTarget,
      activeOutlineId: outline.activeOutlineId,
      modeScrollTarget,
    }),
    [
      documentKey,
      documentRevision,
      modeScrollTarget,
      outline.activeOutlineId,
      outline.outline,
      outline.tocTarget,
    ],
  );

  const actions = useMemo<EditorUiActionsContextValue>(
    () => ({
      setDocumentRevision,
      bumpDocumentRevision,
      setActiveOutlineId: outline.setActiveOutlineId,
      jumpToTocItem: outline.jumpToTocItem,
      jumpToMarkdownFragment: outline.jumpToMarkdownFragment,
      updateActiveOutlineForLine: outline.updateActiveOutlineForLine,
      updateModeScrollRatio,
      startModeScrollTarget,
      clearModeScrollTarget,
      completeModeScrollTarget,
      registerEditorCommands,
      getEditorCommands,
    }),
    [
      bumpDocumentRevision,
      clearModeScrollTarget,
      completeModeScrollTarget,
      getEditorCommands,
      outline.jumpToMarkdownFragment,
      outline.jumpToTocItem,
      outline.setActiveOutlineId,
      outline.updateActiveOutlineForLine,
      registerEditorCommands,
      startModeScrollTarget,
      updateModeScrollRatio,
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

export function getModeScrollTargetForMode(
  modeScrollTarget: PendingModeScrollTarget | null,
  mode: EditorMode,
): EditorScrollTarget | null {
  return modeScrollTarget?.mode === mode ? modeScrollTarget.target : null;
}
