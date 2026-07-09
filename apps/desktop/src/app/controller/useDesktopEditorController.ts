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
import { bindBrowserDirtyDocumentGuard, bindTauriCloseGuard } from "../events/window-guards";
import { bindPasteImageListener } from "../events/paste-image-listener";
import { fileService } from "../../desktop/file-service";
import { inspectLinkedFileTarget, openExternalTarget } from "../../desktop/link-service";
import {
  isExternalSchemeLink,
  isHttpLink,
  normalizeLocalHrefPath,
  splitLinkHref
} from "../../lib/link-target";
import { runtime } from "../runtime/editor-runtime";
import { recentFilesStore } from "./recent-files-store";
import { useDocumentActionsController } from "./useDocumentActionsController";
import { useEditorUiActions } from "@md-editor/editor-ui";
import { useConfirmationStore } from "../stores/confirmation-store";
import { useDocumentUiStore } from "../stores/document-ui-store";
import { useFileActionStore } from "../stores/file-action-store";
import { useFileTreeStore } from "../stores/file-tree-store";
import { useSidebarStore } from "../stores/sidebar-store";
import {
  isUpdateActionBusy,
  shouldShowEditorUpdateAction
} from "../updates/update-status";
import type { DesktopEditorActions } from "../context/DesktopEditorActionsContext";

export interface UseDesktopEditorControllerInput {
  readonly showToast: (message: string | null) => void;
}

export function useDesktopEditorController({ showToast }: UseDesktopEditorControllerInput): DesktopEditorActions {
  const { settings, updateStatus, openSettings, relaunchUpdate, downloadUpdate, applyDownloadedUpdate } = useAppSettings();
  const snapshot = useDocumentSnapshot();
  const {
    clearModeScrollTarget,
    getEditorCommands,
    jumpToMarkdownFragment,
    setDocumentRevision: setEditorRevision,
    startModeScrollTarget
  } = useEditorUiActions();

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

  // --- dispatchCommand ---
  const dispatchCommand = useCallback(async (id: string) => {
    if (hasPendingConfirmation()) return;
    const editorCommands = getEditorCommands();
    await runtime.commands.dispatch(id, {
      document: runtime.document,
      actions: {
        newDocument: docActions.createNewDocument,
        openDocument: docActions.openDocument,
        openRecentDocument: docActions.openRecentDocument,
        openFolder: docActions.openFolder,
        saveDocument: () => docActions.saveDocument(false),
        saveDocumentAs: () => docActions.saveDocument(true),
        openSettings,
        openMdxComponentMenu: editorCommands.openMdxComponentMenu,
        continueAiWriting: editorCommands.continueAiWriting,
        toggleSourceMode,
        showWysiwygMode: () => switchMode("wysiwyg"),
        toggleSidebarPrimary: () => setIsSidebarVisible((v) => !v),
      },
    });
  }, [
    docActions.createNewDocument,
    docActions.openDocument,
    docActions.openFolder,
    docActions.openRecentDocument,
    docActions.saveDocument,
    getEditorCommands,
    hasPendingConfirmation,
    openSettings,
    setIsSidebarVisible,
    switchMode,
    toggleSourceMode,
  ]);

  // --- runEditorUpdateAction ---
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
      if (choice !== "confirm") return;
      const result = await downloadUpdate();
      if (result.state !== "downloaded") return;
      nextStatus = result;
    }

    if (!await ensureSavedBeforeApply()) return;

    if (nextStatus.state === "installed") {
      const choice = await requestConfirmation({
        title: "重启 App",
        description: "更新已安装。重启 App 后，新版本会生效。",
        confirmLabel: "重启 App"
      });
      if (choice === "confirm") await relaunchUpdate();
      return;
    }

    const choice = await requestConfirmation({
      title: "退出并更新",
      description: `Markdown Editor ${nextStatus.latestVersion ?? "新版本"} 已准备好。继续后会退出 App 并进行更新。`,
      confirmLabel: "退出并更新"
    });
    if (choice !== "confirm") return;

    const result = await applyDownloadedUpdate();
    if (result.state === "installed") await relaunchUpdate();
  }, [
    applyDownloadedUpdate,
    downloadUpdate,
    relaunchUpdate,
    requestConfirmation,
    updateStatus,
  ]);

  // --- openWysiwygLink ---
  const openWysiwygLink = useCallback(async (href: string) => {
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

    await runFileAction("正在打开链接", async () => {
      const linked = await inspectLinkedFileTarget(
        current.filePath!,
        normalizeLocalHrefPath(parts.path)
      );

      if (linked.kind === "asset") {
        openAssetPath(linked.path);
        return;
      }

      if (linked.kind === "markdown") {
        if (!(await docActions.ensureDiscardAllowed())) return;
        const document = await fileService.openDocumentAtPath(linked.path);
        docActions.replaceDocument(document);
        await refreshFolderForDocumentPath(document.filePath);
        if (parts.fragment) {
          jumpToMarkdownFragment(document.markdown, parts.fragment);
        }
        return;
      }

      await openExternalTarget(linked.path);
    });
  }, [
    docActions.ensureDiscardAllowed,
    docActions.replaceDocument,
    jumpToMarkdownFragment,
    openAssetPath,
    refreshFolderForDocumentPath,
    runFileAction,
    showToast,
  ]);

  // --- lifecycle bindings ---
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

  return {
    dispatchCommand,
    openDocumentFromTree: docActions.openDocumentFromTree,
    openRecentFile: docActions.openRecentFile,
    openWysiwygLink,
    runEditorUpdateAction,
  };
}
