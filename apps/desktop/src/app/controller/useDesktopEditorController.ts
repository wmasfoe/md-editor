import { useCallback, useEffect } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { EditorMode } from "@md-editor/editor-core";
import { useDocumentSnapshot } from "../document-store";
import { useAppSettings } from "../settings-context";
import {
  bindDesktopMenuCommands,
  bindRuntimeKeyboardShortcuts
} from "../events/command-bindings";
import { bindDropImageListener } from "../events/drop-image-listener";
import { bindRecentFileMenuEvents } from "../events/recent-file-events";
import { bindPasteImageListener } from "../events/paste-image-listener";
import { bindBrowserDirtyDocumentGuard, bindTauriCloseGuard } from "../events/window-guards";
import { runtime } from "../runtime/editor-runtime";
import { recentFilesStore } from "./recent-files-store";
import { useDocumentActionsController } from "./useDocumentActionsController";
import { useEditorUiActions } from "@md-editor/editor-ui";
import { useConfirmationStore } from "../stores/confirmation-store";
import { useDocumentUiStore } from "../stores/document-ui-store";
import { useFileActionStore } from "../stores/file-action-store";
import { useFileTreeStore } from "../stores/file-tree-store";
import { useSidebarStore } from "../stores/sidebar-store";
import { useDesktopCommandDispatcher } from "./bridges/useDesktopCommandDispatcher";
import { useDesktopDocumentOpenBridge } from "./bridges/useDesktopDocumentOpenBridge";
import { useDesktopDocumentMutationBridge } from "./bridges/useDesktopDocumentMutationBridge";
import { useDesktopUpdateActionBridge } from "./bridges/useDesktopUpdateActionBridge";
import { useDesktopWysiwygLinkBridge } from "./bridges/useDesktopWysiwygLinkBridge";

export interface UseDesktopEditorControllerInput {
  readonly showToast: (message: string | null) => void;
}

export function useDesktopEditorController({ showToast }: UseDesktopEditorControllerInput) {
  const { settings, updateStatus, openSettings, relaunchUpdate, downloadUpdate, applyDownloadedUpdate } = useAppSettings();
  const snapshot = useDocumentSnapshot();
  const {
    clearModeScrollTarget,
    jumpToMarkdownFragment,
    startModeScrollTarget
  } = useEditorUiActions();
  const { setEditorRevision } = useDesktopDocumentMutationBridge();

  // 保持 Dispatch 形态，文档动作可以像 React state setter 一样写入 zustand store。
  const setIsSidebarVisible = useCallback((value: boolean | ((prev: boolean) => boolean)) => {
    useSidebarStore.setState((state) => ({
      isSidebarVisible: typeof value === "function" ? value(state.isSidebarVisible) : value,
    }));
  }, []);

  const requestConfirmation = useConfirmationStore((state) => state.requestConfirmation);
  const hasPendingConfirmation = useConfirmationStore((state) => state.hasPendingConfirmation);
  const setHasActiveDocument = useDocumentUiStore((state) => state.setHasActiveDocument);
  const setOpenedAsset = useDocumentUiStore((state) => state.setOpenedAsset);
  const openAssetPath = useDocumentUiStore((state) => state.openAssetPath);
  const runFileAction = useFileActionStore((state) => state.runFileAction);
  const refreshFolderForDocumentPath = useFileTreeStore((state) => state.refreshFolderForDocumentPath);
  const refreshOpenedFolder = useFileTreeStore((state) => state.refreshOpenedFolder);
  const showOpenedFolder = useFileTreeStore((state) => state.showOpenedFolder);

  const docActions = useDocumentActionsController({
    refreshFolderForDocumentPath,
    requestConfirmation,
    runFileAction,
    setEditorRevision,
    setHasActiveDocument,
    setOpenedAsset,
    showOpenedFolder,
    showToast,
  });

  // 模式切换需要 editor-ui 的滚动锚点配合，仍由顶层 hook 协调 provider 内能力。
  const switchMode = useCallback(async (mode: EditorMode) => {
    const currentMode = runtime.document.getSnapshot().mode;
    if (currentMode !== mode) {
      startModeScrollTarget(mode);
    }
    await docActions.switchMode(mode);
    if (runtime.document.getSnapshot().mode !== mode) {
      clearModeScrollTarget();
    }
  }, [clearModeScrollTarget, docActions.switchMode, startModeScrollTarget]);

  const toggleSourceMode = useCallback(async () => {
    const currentMode = runtime.document.getSnapshot().mode;
    await switchMode(currentMode === "source" ? "wysiwyg" : "source");
  }, [switchMode]);

  useDesktopUpdateActionBridge({
    applyDownloadedUpdate,
    downloadUpdate,
    relaunchUpdate,
    requestConfirmation,
    updateStatus,
  });

  useDesktopWysiwygLinkBridge({
    documentActions: docActions,
    jumpToMarkdownFragment,
    openAssetPath,
    refreshFolderForDocumentPath,
    runFileAction,
    showToast,
  });

  const dispatchCommand = useDesktopCommandDispatcher({
    documentActions: docActions,
    hasPendingConfirmation,
    openSettings,
    setIsSidebarVisible,
    showMode: switchMode,
    toggleSourceMode,
  });

  useDesktopDocumentOpenBridge({ documentActions: docActions });

  // 这些是桌面运行时订阅，生命周期绑定到编辑器壳层，而不是某个局部组件。
  useEffect(() => bindRuntimeKeyboardShortcuts(dispatchCommand, settings), [dispatchCommand, settings]);
  useEffect(() => bindDesktopMenuCommands(dispatchCommand), [dispatchCommand]);
  useEffect(() => bindBrowserDirtyDocumentGuard(), []);
  useEffect(
    () => bindTauriCloseGuard(() =>
      docActions.ensureDiscardAllowed("关闭应用前，你可以保存当前文档，或放弃尚未保存的更改。")
    ),
    [docActions.ensureDiscardAllowed]
  );

  useEffect(
    () => bindPasteImageListener({
      replaceDocument: docActions.replaceDocument,
      runFileAction,
      applyMarkdown: docActions.applyProgrammaticMarkdown,
      afterSaveImage: refreshOpenedFolder,
      assetsDirectory: settings.assetsDirectory,
    }),
    [
      docActions.applyProgrammaticMarkdown,
      docActions.replaceDocument,
      refreshOpenedFolder,
      runFileAction,
      settings.assetsDirectory,
    ]
  );

  useEffect(
    () => bindDropImageListener({
      replaceDocument: docActions.replaceDocument,
      runFileAction,
      applyMarkdown: docActions.applyProgrammaticMarkdown,
      afterSaveImage: refreshOpenedFolder,
      assetsDirectory: settings.assetsDirectory,
    }),
    [
      docActions.applyProgrammaticMarkdown,
      docActions.replaceDocument,
      refreshOpenedFolder,
      runFileAction,
      settings.assetsDirectory,
    ]
  );

  useEffect(
    () => bindRecentFileMenuEvents({
      store: recentFilesStore,
      openRecentFile: docActions.openRecentFile,
      onError: showToast,
    }),
    [docActions.openRecentFile, showToast]
  );

  useEffect(() => {
    const media = window.matchMedia("(max-width: 959px)");
    const collapse = (event: MediaQueryListEvent) => {
      if (event.matches) setIsSidebarVisible(false);
    };
    media.addEventListener("change", collapse);
    return () => media.removeEventListener("change", collapse);
  }, [setIsSidebarVisible]);

  useEffect(() => {
    const fileName = snapshot.filePath?.split(/[\\/]/).pop() || "未命名文档";
    const title = `${fileName}${snapshot.isDirty ? "*" : ""}`;
    document.title = title;
    if (isTauri()) {
      void getCurrentWindow().setTitle(title).catch((error: unknown) => {
        console.warn("窗口标题同步失败", error);
      });
    }
  }, [snapshot.filePath, snapshot.isDirty]);
}
