import { useCallback, useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { MarkdownFileTreeNode } from "@md-editor/file-system";
import { fileService } from "../../desktop/file-service";
import { inspectLinkedFileTarget, openExternalTarget } from "../../desktop/link-service";
import {
  basename,
  isExternalSchemeLink,
  isHttpLink,
  normalizeLocalHrefPath,
  splitLinkHref
} from "../../lib/link-target";
import { resolvePreviewImageSrc } from "../../lib/markdown-preview";
import type { OpenedAsset, SidebarMode } from "../../types";
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
import { useConfirmationController } from "./useConfirmationController";
import { useDocumentActionsController } from "./useDocumentActionsController";
import { useFileActionController } from "./useFileActionController";
import { useFileTreeController } from "./useFileTreeController";
import { useMdxAiController } from "./useMdxAiController";
import { useOutlineController } from "./useOutlineController";
import { useSettingsController } from "./useSettingsController";

interface ToastState {
  readonly id: number;
  readonly message: string;
}

export function useDesktopEditorController() {
  const [snapshot, setSnapshot] = useState(() => runtime.getSnapshot());
  const [toast, setToast] = useState<ToastState | null>(null);
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>("files");
  const [isSidebarVisible, setIsSidebarVisible] = useState(() => window.innerWidth >= 960);
  const [hasActiveDocument, setHasActiveDocument] = useState(false);
  const [editorRevision, setEditorRevision] = useState(0);
  const [openedAsset, setOpenedAsset] = useState<OpenedAsset | null>(null);
  const documentKey = `${snapshot.filePath ?? "untitled"}:${editorRevision}`;

  const showToast = useCallback((message: string | null) => {
    if (!message) {
      setToast(null);
      return;
    }

    setToast({
      id: Date.now(),
      message
    });
  }, []);
  const getCurrentEditorMode = useCallback(() => runtime.document.getSnapshot().mode, []);

  const {
    settings,
    isSettingsOpen,
    shortcutDrafts,
    assetsDirectoryDraft,
    aiSettingsDraft,
    isLocalModelActionPending,
    settingsErrorMessage,
    isSavingSettings,
    updateStatus,
    setAssetsDirectoryDraft,
    setAiSettingsDraft,
    openSettings,
    closeSettings,
    captureShortcutDraft,
    resetShortcutDraft,
    saveSettings,
    downloadLocalModel,
    deleteLocalModel,
    runUpdateCheck
  } = useSettingsController({ showToast });
  const {
    confirmation,
    requestConfirmation,
    resolveConfirmation,
    hasPendingConfirmation
  } = useConfirmationController();
  const {
    tocTarget,
    outline,
    activeOutlineId,
    setActiveOutlineId,
    jumpToTocItem,
    jumpToMarkdownFragment,
    updateActiveOutlineForLine
  } = useOutlineController({ markdown: snapshot.markdown, showToast });
  const {
    isMdxComponentMenuOpen,
    mdxInsertRequest,
    aiSuggestionRequest,
    isAiSuggestionPending,
    isAiCompletionReady,
    mdxComponentPlugins,
    openMdxComponentMenu,
    closeMdxComponentMenu,
    clearMdxInsertRequest,
    clearAiSuggestionRequest,
    insertMdxComponent,
    continueAiWriting,
    requestAiSuggestion,
    handleAiSuggestionError
  } = useMdxAiController({
    aiSettings: settings.ai,
    getEditorMode: getCurrentEditorMode,
    showToast
  });
  const {
    pendingAction,
    runFileAction,
    showFileActionError
  } = useFileActionController({ showToast });
  const {
    folder,
    refreshFolderForDocumentPath,
    refreshOpenedFolder,
    showOpenedFolder,
    createTreeItem,
    renameTreeItem,
    deleteTreeItem
  } = useFileTreeController({
    clearMdxInsertRequest,
    requestConfirmation,
    runFileAction,
    setIsSidebarVisible,
    setSidebarMode,
    setSnapshot
  });
  const {
    commitMarkdown,
    applyProgrammaticMarkdown,
    switchMode,
    toggleSourceMode,
    replaceDocument,
    saveDocument,
    ensureDiscardAllowed,
    createNewDocument,
    openDocument,
    openRecentFile,
    openRecentDocument,
    openFolder,
    openDocumentFromTree,
    getRecentFiles
  } = useDocumentActionsController({
    clearMdxInsertRequest,
    refreshFolderForDocumentPath,
    requestConfirmation,
    runFileAction,
    setEditorRevision,
    setHasActiveDocument,
    setOpenedAsset,
    setSnapshot,
    showOpenedFolder,
    showToast
  });

  const openAssetFromTree = useCallback((node: MarkdownFileTreeNode) => {
    showToast(null);
    setOpenedAsset({ name: node.name, path: node.path });
  }, [showToast]);

  const closeAssetPreview = useCallback(() => {
    setOpenedAsset(null);
  }, []);

  useEffect(
    () =>
      bindPasteImageListener({
        replaceDocument,
        runFileAction,
        applyMarkdown: applyProgrammaticMarkdown,
        afterSaveImage: refreshOpenedFolder,
        assetsDirectory: settings.assetsDirectory
      }),
    [applyProgrammaticMarkdown, refreshOpenedFolder, replaceDocument, runFileAction, settings.assetsDirectory]
  );
  useEffect(
    () =>
      bindDropImageListener({
        replaceDocument,
        runFileAction,
        applyMarkdown: applyProgrammaticMarkdown,
        afterSaveImage: refreshOpenedFolder,
        assetsDirectory: settings.assetsDirectory
      }),
    [applyProgrammaticMarkdown, refreshOpenedFolder, replaceDocument, runFileAction, settings.assetsDirectory]
  );

  const resolveImageSrc = useCallback(
    (src: string) => resolvePreviewImageSrc(snapshot.filePath, src),
    [snapshot.filePath]
  );

  const toggleSidebarPrimary = useCallback(async () => {
    setIsSidebarVisible((current) => !current);
  }, []);

  const openWysiwygLink = useCallback(
    async (href: string) => {
      const parts = splitLinkHref(href);
      if (parts.path === "" && parts.fragment) {
        jumpToMarkdownFragment(runtime.document.getSnapshot().markdown, parts.fragment);
        return;
      }

      if (
        isHttpLink(href) ||
        (isExternalSchemeLink(href) && !href.trim().toLowerCase().startsWith("file:"))
      ) {
        await runFileAction("正在打开链接", async () => {
          await openExternalTarget(href);
        });
        return;
      }

      const current = runtime.document.getSnapshot();
      if (!current.filePath) {
        showToast("请先保存当前文档，再打开相对链接。");
        return;
      }
      const currentFilePath = current.filePath;

      await runFileAction("正在打开链接", async () => {
        const linked = await inspectLinkedFileTarget(
          currentFilePath,
          normalizeLocalHrefPath(parts.path)
        );

        if (linked.kind === "asset") {
          showToast(null);
          setOpenedAsset({ name: basename(linked.path), path: linked.path });
          return;
        }

        if (linked.kind === "markdown") {
          if (!(await ensureDiscardAllowed())) {
            return;
          }

          const document = await fileService.openDocumentAtPath(linked.path);
          replaceDocument(document);
          await refreshFolderForDocumentPath(document.filePath);
          jumpToMarkdownFragment(document.markdown, parts.fragment);
          return;
        }

        await openExternalTarget(linked.path);
      });
    },
    [
      ensureDiscardAllowed,
      jumpToMarkdownFragment,
      refreshFolderForDocumentPath,
      replaceDocument,
      runFileAction,
      showToast
    ]
  );

  const dispatchCommand = useCallback(
    async (id: string) => {
      // 全局菜单和快捷键在 React 外部捕获；有弹窗等待决策时先忽略，避免 Promise 丢失。
      if (hasPendingConfirmation()) {
        return;
      }
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
          openMdxComponentMenu,
          continueAiWriting,
          toggleSourceMode,
          showWysiwygMode: () => switchMode("wysiwyg"),
          toggleSidebarPrimary
        }
      });
    },
    [
      createNewDocument,
      openDocument,
      openRecentDocument,
      openFolder,
      openSettings,
      openMdxComponentMenu,
      continueAiWriting,
      hasPendingConfirmation,
      saveDocument,
      switchMode,
      toggleSidebarPrimary,
      toggleSourceMode
    ]
  );

  useEffect(() => {
    return bindRuntimeKeyboardShortcuts(dispatchCommand, settings);
  }, [dispatchCommand, settings]);
  useEffect(() => {
    return bindDesktopMenuCommands(dispatchCommand);
  }, [dispatchCommand]);
  useEffect(() => bindBrowserDirtyDocumentGuard(), []);
  useEffect(
    () =>
      bindTauriCloseGuard(() =>
        ensureDiscardAllowed("关闭应用前，你可以保存当前文档，或放弃尚未保存的更改。")
      ),
    [ensureDiscardAllowed]
  );

  useEffect(() => {
    const media = window.matchMedia("(max-width: 959px)");
    const collapseForNarrowWindow = (event: MediaQueryListEvent) => {
      if (event.matches) {
        setIsSidebarVisible(false);
      }
    };
    media.addEventListener("change", collapseForNarrowWindow);
    return () => media.removeEventListener("change", collapseForNarrowWindow);
  }, []);

  useEffect(() => {
    const fileName = snapshot.filePath?.split(/[\\/]/).pop() || "未命名文档";
    const title = `${fileName}${snapshot.isDirty ? "*" : ""}`;
    document.title = title;
    if (isTauri()) {
      // Web 预览没有原生窗口；标题同步失败不能影响任一运行时的编辑流程。
      void getCurrentWindow().setTitle(title).catch((error: unknown) => {
        console.warn("窗口标题同步失败", error);
      });
    }
  }, [snapshot.filePath, snapshot.isDirty]);

  useEffect(
    () =>
      bindRecentFileMenuEvents({
        store: recentFilesStore,
        openRecentFile,
        onError: showToast
      }),
    [openRecentFile, showToast]
  );

  return {
    snapshot,
    toast,
    pendingAction,
    tocTarget,
    folder,
    sidebarMode,
    isSidebarVisible,
    hasActiveDocument,
    openedAsset,
    documentKey,
    outline,
    activeOutlineId,
    confirmation,
    isMdxComponentMenuOpen,
    mdxInsertRequest,
    aiSuggestionRequest,
    isAiSuggestionPending,
    isAiCompletionReady,
    mdxComponentPlugins,
    settings,
    isSettingsOpen,
    shortcutDrafts,
    assetsDirectoryDraft,
    aiSettingsDraft,
    isLocalModelActionPending,
    settingsErrorMessage,
    isSavingSettings,
    updateStatus,
    setSidebarMode,
    setIsSidebarVisible,
    setAssetsDirectoryDraft,
    setAiSettingsDraft,
    commitMarkdown,
    dispatchCommand,
    openDocumentFromTree,
    openAssetFromTree,
    openWysiwygLink,
    closeAssetPreview,
    createTreeItem,
    renameTreeItem,
    deleteTreeItem,
    showFileActionError,
    jumpToTocItem,
    setActiveOutlineId,
    resolveConfirmation,
    closeMdxComponentMenu,
    clearMdxInsertRequest,
    clearAiSuggestionRequest,
    insertMdxComponent,
    requestAiSuggestion,
    handleAiSuggestionError,
    updateActiveOutlineForLine,
    resolveImageSrc,
    getRecentFiles,
    openRecentFile,
    closeSettings,
    captureShortcutDraft,
    resetShortcutDraft,
    saveSettings,
    downloadLocalModel,
    deleteLocalModel,
    runUpdateCheck
  };
}
