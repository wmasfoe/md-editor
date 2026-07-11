import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import type { EditorMode } from "@md-editor/editor-core";
import {
  reconcileWysiwygMarkdownSourceDrafts,
  type WysiwygMarkdownSourceDraft,
} from "../utils/wysiwyg-markdown-source";
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
  readonly wysiwygMarkdownSourceDrafts: readonly WysiwygMarkdownSourceDraft[];
  readonly setWysiwygMarkdownSourceDrafts: (drafts: readonly WysiwygMarkdownSourceDraft[]) => void;
}

export interface EditorUiStateContextValue {
  readonly documentKey: string;
  readonly documentRevision: number;
  readonly outline: readonly OutlineItem[];
  readonly tocTarget: TocTarget | null;
  readonly activeOutlineId: string | null;
  readonly modeScrollTarget: PendingModeScrollTarget | null;
  readonly wysiwygMarkdownSourceDrafts: readonly WysiwygMarkdownSourceDraft[];
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
  readonly setWysiwygMarkdownSourceDrafts: (drafts: readonly WysiwygMarkdownSourceDraft[]) => void;
}

export const emptyEditorUiCommandSlots: EditorUiCommandSlots = {
  openMdxComponentMenu: () => {},
  continueAiWriting: async () => {},
};
const emptyWysiwygMarkdownSourceDrafts: readonly WysiwygMarkdownSourceDraft[] = [];

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
  const [sourceDraftState, setSourceDraftState] = useState<{
    readonly documentKey: string;
    readonly drafts: readonly WysiwygMarkdownSourceDraft[];
  } | null>(null);
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
  const setWysiwygMarkdownSourceDrafts = useCallback(
    (drafts: readonly WysiwygMarkdownSourceDraft[]) => {
      setSourceDraftState({ documentKey, drafts });
    },
    [documentKey],
  );
  const storedWysiwygMarkdownSourceDrafts =
    sourceDraftState?.documentKey === documentKey
      ? sourceDraftState.drafts
      : emptyWysiwygMarkdownSourceDrafts;
  const wysiwygMarkdownSourceDrafts = useMemo(
    () => reconcileWysiwygMarkdownSourceDrafts(markdown, storedWysiwygMarkdownSourceDrafts),
    [markdown, storedWysiwygMarkdownSourceDrafts],
  );

  useLayoutEffect(() => {
    if (
      sourceDraftState?.documentKey !== documentKey ||
      areWysiwygMarkdownSourceDraftListsEqual(sourceDraftState.drafts, wysiwygMarkdownSourceDrafts)
    ) {
      return;
    }
    setSourceDraftState({ documentKey, drafts: wysiwygMarkdownSourceDrafts });
  }, [documentKey, sourceDraftState, wysiwygMarkdownSourceDrafts]);

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
      wysiwygMarkdownSourceDrafts,
    }),
    [
      documentKey,
      documentRevision,
      modeScrollTarget,
      outline.activeOutlineId,
      outline.outline,
      outline.tocTarget,
      wysiwygMarkdownSourceDrafts,
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
      setWysiwygMarkdownSourceDrafts,
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
      setWysiwygMarkdownSourceDrafts,
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

function areWysiwygMarkdownSourceDraftListsEqual(
  left: readonly WysiwygMarkdownSourceDraft[],
  right: readonly WysiwygMarkdownSourceDraft[],
): boolean {
  return left.length === right.length && left.every((draft, index) => draft === right[index]);
}
