import { useCallback, useLayoutEffect } from "react";
import { useEditorUiActions } from "@md-editor/editor-ui";
import type { EditorMode } from "@md-editor/editor-core";
import { runtime } from "../../runtime/editor-runtime";
import { useDocumentUiStore } from "../../stores/document-ui-store";
import type { DocumentActionsController } from "../useDocumentActionsController";

interface UseDesktopCommandDispatcherOptions {
  readonly documentActions: Pick<
    DocumentActionsController,
    | "createNewDocument"
    | "openDocument"
    | "openRecentDocument"
    | "openFolder"
    | "saveDocument"
  >;
  readonly hasPendingConfirmation: () => boolean;
  readonly openSettings: () => void;
  readonly setIsSidebarVisible: (value: boolean | ((prev: boolean) => boolean)) => void;
  readonly showMode: (mode: EditorMode) => Promise<void>;
  readonly toggleSourceMode: () => Promise<void>;
}

export function useDesktopCommandDispatcher({
  documentActions,
  hasPendingConfirmation,
  openSettings,
  setIsSidebarVisible,
  showMode,
  toggleSourceMode,
}: UseDesktopCommandDispatcherOptions) {
  const { getEditorCommands } = useEditorUiActions();
  const {
    createNewDocument,
    openDocument,
    openRecentDocument,
    openFolder,
    saveDocument,
  } = documentActions;

  const dispatchCommand = useCallback(async (id: string) => {
    if (hasPendingConfirmation()) return;
    const editorCommands = getEditorCommands();
    await runtime.commands.dispatch(id, {
      document: runtime.document,
      actions: {
        newDocument: createNewDocument,
        openDocument,
        openRecentDocument,
        openFolder,
        saveDocument: () => saveDocument(false),
        saveDocumentAs: () => saveDocument(true),
        openSettings,
        openMdxComponentMenu: editorCommands.openMdxComponentMenu,
        continueAiWriting: editorCommands.continueAiWriting,
        toggleSourceMode,
        showWysiwygMode: () => showMode("wysiwyg"),
        toggleSidebarPrimary: () => setIsSidebarVisible((v) => !v),
      },
    });
  }, [
    createNewDocument,
    getEditorCommands,
    hasPendingConfirmation,
    openDocument,
    openFolder,
    openRecentDocument,
    openSettings,
    saveDocument,
    setIsSidebarVisible,
    showMode,
    toggleSourceMode,
  ]);

  // command palette / menu 入口会从 store 读取 dispatcher；hook 负责把 provider 内命令注册进去。
  useLayoutEffect(() => {
    useDocumentUiStore.setState({ dispatchCommand });
  }, [dispatchCommand]);

  return dispatchCommand;
}
