import { useCallback, useEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { EditorMode } from "@md-editor/editor-core";
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
import {
  clampEditorScrollRatio,
  createModeScrollTarget,
  type PendingModeScrollTarget
} from "./mode-scroll-target";
import { recentFilesStore } from "./recent-files-store";
import { useConfirmationController } from "./useConfirmationController";
import { useDocumentActionsController } from "./useDocumentActionsController";
import { useFileActionController } from "./useFileActionController";
import { useFileTreeController } from "./useFileTreeController";
import { useMdxAiController } from "./useMdxAiController";
import { useOutlineController } from "./useOutlineController";
import {
  isUpdateActionBusy,
  shouldShowEditorUpdateAction
} from "../updates/update-status";

export interface UseDesktopEditorControllerInput {
  readonly showToast: (message: string | null) => void;
}

export function useDesktopEditorController({ showToast }: UseDesktopEditorControllerInput) {
  const { settings, updateStatus, openSettings, relaunchUpdate, downloadUpdate, applyDownloadedUpdate } = useAppSettings();
  const snapshot = useDocumentSnapshot();
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>("files");
  const [isSidebarVisible, setIsSidebarVisible] = useState(() => window.innerWidth >= 960);
  const [hasActiveDocument, setHasActiveDocument] = useState(false);
  const [editorRevision, setEditorRevision] = useState(0);
  const [openedAsset, setOpenedAsset] = useState<OpenedAsset | null>(null);
  const [modeScrollTarget, setModeScrollTarget] = useState<PendingModeScrollTarget | null>(null);
  const activeScrollRatioRef = useRef(0);
  const documentKey = `${snapshot.filePath ?? "untitled"}:${editorRevision}`;

  const getCurrentEditorMode = useCallback(() => runtime.document.getSnapshot().mode, []);

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
    setSidebarMode
  });
  const {
    commitMarkdown,
    applyProgrammaticMarkdown,
    switchMode: baseSwitchMode,
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

  const updateModeScrollRatio = useCallback((ratio: number) => {
    const clampedRatio = clampEditorScrollRatio(ratio);
    if (clampedRatio === null) {
      return;
    }
    activeScrollRatioRef.current = clampedRatio;
  }, []);

  const completeModeScrollTarget = useCallback((nonce: number) => {
    setModeScrollTarget((current) => (
      current?.target.nonce === nonce ? null : current
    ));
  }, []);

  const switchMode = useCallback(async (mode: EditorMode) => {
    const currentMode = runtime.document.getSnapshot().mode;
    if (currentMode !== mode) {
      setModeScrollTarget(createModeScrollTarget(mode, activeScrollRatioRef.current));
    }
    await baseSwitchMode(mode);
    if (runtime.document.getSnapshot().mode !== mode) {
      setModeScrollTarget(null);
    }
  }, [baseSwitchMode]);

  const toggleSourceMode = useCallback(async () => {
    const currentMode = runtime.document.getSnapshot().mode;
    await switchMode(currentMode === "source" ? "wysiwyg" : "source");
  }, [switchMode]);

  const runEditorUpdateAction = useCallback(async () => {
    if (!shouldShowEditorUpdateAction(updateStatus) || isUpdateActionBusy(updateStatus)) {
      return;
    }

    let nextStatus = updateStatus;

    const ensureSavedBeforeApply = async () => {
      if (!runtime.document.getSnapshot().isDirty) {
        return true;
      }
      await requestConfirmation({
        title: "请先保存文档",
        description: "当前文档还有未保存的更改。请先保存，再继续更新 App。",
        confirmLabel: "知道了"
      });
      return false;
    };

    if (nextStatus.state === "available") {
      const choice = await requestConfirmation({
        title: "下载更新",
        description: `发现 Markdown Editor ${nextStatus.latestVersion ?? "新版本"}。下载完成后，你可以继续退出并更新。`,
        confirmLabel: "下载更新"
      });
      if (choice !== "confirm") {
        return;
      }
      const result = await downloadUpdate();
      if (result.state !== "downloaded") {
        return;
      }
      nextStatus = result;
    }

    if (!await ensureSavedBeforeApply()) {
      return;
    }

    if (nextStatus.state === "installed") {
      const choice = await requestConfirmation({
        title: "重启 App",
        description: "更新已安装。重启 App 后，新版本会生效。",
        confirmLabel: "重启 App"
      });
      if (choice === "confirm") {
        await relaunchUpdate();
      }
      return;
    }

    const choice = await requestConfirmation({
      title: "退出并更新",
      description: `Markdown Editor ${nextStatus.latestVersion ?? "新版本"} 已准备好。继续后会退出 App 并进行更新。`,
      confirmLabel: "退出并更新"
    });
    if (choice !== "confirm") {
      return;
    }

    const result = await applyDownloadedUpdate();
    if (result.state === "installed") {
      await relaunchUpdate();
    }
  }, [
    applyDownloadedUpdate,
    downloadUpdate,
    relaunchUpdate,
    requestConfirmation,
    updateStatus
  ]);

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

  useEffect(() => {
    activeScrollRatioRef.current = 0;
    setModeScrollTarget(null);
  }, [documentKey]);

  return {
    pendingAction,
    tocTarget,
    folder,
    sidebarMode,
    isSidebarVisible,
    hasActiveDocument,
    openedAsset,
    documentKey,
    modeScrollTarget,
    outline,
    activeOutlineId,
    confirmation,
    isMdxComponentMenuOpen,
    mdxInsertRequest,
    aiSuggestionRequest,
    isAiSuggestionPending,
    isAiCompletionReady,
    mdxComponentPlugins,
    shouldShowEditorUpdateAction: shouldShowEditorUpdateAction(updateStatus),
    isUpdateActionBusy: isUpdateActionBusy(updateStatus),
    setSidebarMode,
    setIsSidebarVisible,
    commitMarkdown,
    updateModeScrollRatio,
    completeModeScrollTarget,
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
    runEditorUpdateAction
  };
}
