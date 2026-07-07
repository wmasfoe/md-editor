import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
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
} from "./mode-scroll-target";
import { recentFilesStore } from "./recent-files-store";
import { useConfirmationController } from "./useConfirmationController";
import { useDocumentActionsController } from "./useDocumentActionsController";
import { useFileActionController } from "./useFileActionController";
import { useFileTreeController } from "./useFileTreeController";
import { useOutlineController } from "./useOutlineController";
import {
  isUpdateActionBusy,
  shouldShowEditorUpdateAction
} from "../updates/update-status";
import { useConfirmationStore } from "../stores/confirmation-store";
import { useDocumentUiStore } from "../stores/document-ui-store";
import { useEditorScrollStore } from "../stores/editor-scroll-store";
import { useFileActionStore } from "../stores/file-action-store";
import { useFileTreeStore } from "../stores/file-tree-store";
import { useEditorCommandsStore } from "../stores/editor-commands-store";
import { useOutlineStore } from "../stores/outline-store";
import { useSidebarStore } from "../stores/sidebar-store";

export interface UseDesktopEditorControllerInput {
  readonly showToast: (message: string | null) => void;
}

export function useDesktopEditorController({ showToast }: UseDesktopEditorControllerInput) {
  const { settings, updateStatus, openSettings, relaunchUpdate, downloadUpdate, applyDownloadedUpdate } = useAppSettings();
  const snapshot = useDocumentSnapshot();
  const activeScrollRatioRef = useRef(0);

  // --- Store-backed setters (compatible with Dispatch<SetStateAction<T>>) ---

  const setIsSidebarVisible = useCallback((value: boolean | ((prev: boolean) => boolean)) => {
    useSidebarStore.setState((state) => ({
      isSidebarVisible: typeof value === "function" ? value(state.isSidebarVisible) : value,
    }));
  }, []);

  const setSidebarMode = useCallback((value: import("../../types").SidebarMode | ((prev: import("../../types").SidebarMode) => import("../../types").SidebarMode)) => {
    useSidebarStore.setState((state) => ({
      sidebarMode: typeof value === "function" ? value(state.sidebarMode) : value,
    }));
  }, []);

  const setHasActiveDocument = useCallback((value: boolean | ((prev: boolean) => boolean)) => {
    useDocumentUiStore.setState((state) => ({
      hasActiveDocument: typeof value === "function" ? value(state.hasActiveDocument) : value,
    }));
  }, []);

  const setOpenedAsset = useCallback((value: import("../../types").OpenedAsset | null | ((prev: import("../../types").OpenedAsset | null) => import("../../types").OpenedAsset | null)) => {
    useDocumentUiStore.setState((state) => ({
      openedAsset: typeof value === "function" ? value(state.openedAsset) : value,
    }));
  }, []);

  const setEditorRevision = useCallback((value: number | ((prev: number) => number)) => {
    // editorRevision is tracked locally via a ref to compute documentKey
    // We update the store's documentKey directly
  }, []);

  // documentKey: computed from filePath + revision, managed via ref
  const editorRevisionRef = useRef(0);
  const setEditorRevisionAndKey = useCallback((value: number | ((prev: number) => number)) => {
    const next = typeof value === "function" ? value(editorRevisionRef.current) : value;
    editorRevisionRef.current = next;
    const filePath = runtime.document.getSnapshot().filePath;
    useDocumentUiStore.setState({
      documentKey: `${filePath ?? "untitled"}:${next}`,
    });
  }, []);

  // --- Sub-hooks ---

  const confirmation = useConfirmationController();

  const outline = useOutlineController({ markdown: snapshot.markdown, showToast });


  const fileAction = useFileActionController({ showToast });

  const fileTree = useFileTreeController({
    clearMdxInsertRequest: () => {},
    requestConfirmation: confirmation.requestConfirmation,
    runFileAction: fileAction.runFileAction,
    setIsSidebarVisible,
    setSidebarMode,
  });

  const docActions = useDocumentActionsController({
    clearMdxInsertRequest: () => {},
    refreshFolderForDocumentPath: fileTree.refreshFolderForDocumentPath,
    requestConfirmation: confirmation.requestConfirmation,
    runFileAction: fileAction.runFileAction,
    setEditorRevision: setEditorRevisionAndKey,
    setHasActiveDocument,
    setOpenedAsset,
    showOpenedFolder: fileTree.showOpenedFolder,
    showToast,
  });

  // --- Sync sub-hook results to Zustand stores ---

  useLayoutEffect(() => {
    useConfirmationStore.setState({
      confirmation: confirmation.confirmation,
      requestConfirmation: confirmation.requestConfirmation,
      resolveConfirmation: confirmation.resolveConfirmation,
      hasPendingConfirmation: confirmation.hasPendingConfirmation,
    });
  }, [
    confirmation.confirmation,
    confirmation.hasPendingConfirmation,
    confirmation.requestConfirmation,
    confirmation.resolveConfirmation,
  ]);

  useLayoutEffect(() => {
    useOutlineStore.setState({
      outline: outline.outline,
      tocTarget: outline.tocTarget,
      activeOutlineId: outline.activeOutlineId,
      setActiveOutlineId: outline.setActiveOutlineId,
      jumpToTocItem: outline.jumpToTocItem,
      jumpToMarkdownFragment: outline.jumpToMarkdownFragment,
      updateActiveOutlineForLine: outline.updateActiveOutlineForLine,
    });
  }, [
    outline.outline,
    outline.tocTarget,
    outline.activeOutlineId,
    outline.setActiveOutlineId,
    outline.jumpToTocItem,
    outline.jumpToMarkdownFragment,
    outline.updateActiveOutlineForLine,
  ]);


  useLayoutEffect(() => {
    useFileActionStore.setState({
      pendingAction: fileAction.pendingAction,
      runFileAction: fileAction.runFileAction,
      showFileActionError: fileAction.showFileActionError,
    });
  }, [fileAction.pendingAction, fileAction.runFileAction, fileAction.showFileActionError]);

  useLayoutEffect(() => {
    useFileTreeStore.setState({
      folder: fileTree.folder,
      createTreeItem: fileTree.createTreeItem,
      renameTreeItem: fileTree.renameTreeItem,
      deleteTreeItem: fileTree.deleteTreeItem,
    });
  }, [
    fileTree.folder,
    fileTree.createTreeItem,
    fileTree.renameTreeItem,
    fileTree.deleteTreeItem,
  ]);

  // --- Coordinator-level actions (depend on multiple sub-hooks) ---

  const updateModeScrollRatio = useCallback((ratio: number) => {
    const clamped = clampEditorScrollRatio(ratio);
    if (clamped !== null) {
      activeScrollRatioRef.current = clamped;
    }
  }, []);

  const completeModeScrollTarget = useCallback((nonce: number) => {
    useEditorScrollStore.setState((current) => ({
      modeScrollTarget: current.modeScrollTarget?.target.nonce === nonce
        ? null
        : current.modeScrollTarget,
    }));
  }, []);

  const switchMode = useCallback(async (mode: EditorMode) => {
    const currentMode = runtime.document.getSnapshot().mode;
    if (currentMode !== mode) {
      useEditorScrollStore.setState({
        modeScrollTarget: createModeScrollTarget(mode, activeScrollRatioRef.current),
      });
    }
    await docActions.switchMode(mode);
    if (runtime.document.getSnapshot().mode !== mode) {
      useEditorScrollStore.setState({ modeScrollTarget: null });
    }
  }, [docActions.switchMode]);

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
      await confirmation.requestConfirmation({
        title: "请先保存文档",
        description: "当前文档还有未保存的更改。请先保存，再继续更新 App。",
        confirmLabel: "知道了"
      });
      return false;
    };

    if (nextStatus.state === "available") {
      const choice = await confirmation.requestConfirmation({
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
      const choice = await confirmation.requestConfirmation({
        title: "重启 App",
        description: "更新已安装。重启 App 后，新版本会生效。",
        confirmLabel: "重启 App"
      });
      if (choice === "confirm") await relaunchUpdate();
      return;
    }

    const choice = await confirmation.requestConfirmation({
      title: "退出并更新",
      description: `Markdown Editor ${nextStatus.latestVersion ?? "新版本"} 已准备好。继续后会退出 App 并进行更新。`,
      confirmLabel: "退出并更新"
    });
    if (choice !== "confirm") return;

    const result = await applyDownloadedUpdate();
    if (result.state === "installed") await relaunchUpdate();
  }, [
    applyDownloadedUpdate,
    confirmation.requestConfirmation,
    downloadUpdate,
    relaunchUpdate,
    updateStatus,
  ]);

  const openWysiwygLink = useCallback(async (href: string) => {
    const parts = splitLinkHref(href);
    if (parts.path === "" && parts.fragment) {
      outline.jumpToMarkdownFragment(runtime.document.getSnapshot().markdown, parts.fragment);
      return;
    }

    if (
      isHttpLink(href) ||
      (isExternalSchemeLink(href) && !href.trim().toLowerCase().startsWith("file:"))
    ) {
      await fileAction.runFileAction("正在打开链接", async () => {
        await openExternalTarget(href);
      });
      return;
    }

    const current = runtime.document.getSnapshot();
    if (!current.filePath) {
      showToast("请先保存当前文档，再打开相对链接。");
      return;
    }

    await fileAction.runFileAction("正在打开链接", async () => {
      const linked = await inspectLinkedFileTarget(
        current.filePath!,
        normalizeLocalHrefPath(parts.path)
      );

      if (linked.kind === "asset") {
        showToast(null);
        useDocumentUiStore.setState({
          openedAsset: { name: basename(linked.path), path: linked.path },
        });
        return;
      }

      if (linked.kind === "markdown") {
        if (!(await docActions.ensureDiscardAllowed())) return;
        const document = await fileService.openDocumentAtPath(linked.path);
        docActions.replaceDocument(document);
        await fileTree.refreshFolderForDocumentPath(document.filePath);
        outline.jumpToMarkdownFragment(document.markdown, parts.fragment);
        return;
      }

      await openExternalTarget(linked.path);
    });
  }, [
    docActions.ensureDiscardAllowed,
    docActions.replaceDocument,
    fileAction.runFileAction,
    fileTree.refreshFolderForDocumentPath,
    outline.jumpToMarkdownFragment,
    showToast,
  ]);

  const resolveImageSrc = useCallback(
    (src: string) => resolvePreviewImageSrc(snapshot.filePath, src),
    [snapshot.filePath]
  );

  const openAssetFromTree = useCallback((node: MarkdownFileTreeNode) => {
    showToast(null);
    useDocumentUiStore.setState({
      openedAsset: { name: node.name, path: node.path },
    });
  }, [showToast]);

  const closeAssetPreview = useCallback(() => {
    useDocumentUiStore.setState({ openedAsset: null });
  }, []);

  const dispatchCommand = useCallback(async (id: string) => {
    if (confirmation.hasPendingConfirmation()) return;
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
        openMdxComponentMenu: useEditorCommandsStore.getState().openMdxComponentMenu,
        continueAiWriting: useEditorCommandsStore.getState().continueAiWriting,
        toggleSourceMode,
        showWysiwygMode: () => switchMode("wysiwyg"),
        toggleSidebarPrimary: () => setIsSidebarVisible((v) => !v),
      },
    });
  }, [
    confirmation.hasPendingConfirmation,
    docActions.createNewDocument,
    docActions.openDocument,
    docActions.openRecentDocument,
    docActions.openFolder,
    docActions.saveDocument,
    openSettings,
    setIsSidebarVisible,
    switchMode,
    toggleSourceMode,
  ]);

  // --- Sync coordinator-level actions to document-ui store ---

  useLayoutEffect(() => {
    const filePath = snapshot.filePath;
    useDocumentUiStore.setState({
      documentKey: `${filePath ?? "untitled"}:${editorRevisionRef.current}`,
      resolveImageSrc,
      closeAssetPreview,
      openAssetFromTree,
      getRecentFiles: docActions.getRecentFiles,
      openRecentFile: docActions.openRecentFile,
      runEditorUpdateAction,
      commitMarkdown: docActions.commitMarkdown,
      openWysiwygLink,
      dispatchCommand,
      openDocumentFromTree: docActions.openDocumentFromTree,
    });
  }, [
    snapshot.filePath,
    resolveImageSrc,
    closeAssetPreview,
    openAssetFromTree,
    docActions.getRecentFiles,
    docActions.openRecentFile,
    runEditorUpdateAction,
    docActions.commitMarkdown,
    openWysiwygLink,
    dispatchCommand,
    docActions.openDocumentFromTree,
  ]);

  useLayoutEffect(() => {
    useEditorScrollStore.setState({
      updateModeScrollRatio,
      completeModeScrollTarget,
    });
  }, [updateModeScrollRatio, completeModeScrollTarget]);

  // --- Global effects ---

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
      runFileAction: fileAction.runFileAction,
      applyMarkdown: docActions.applyProgrammaticMarkdown,
      afterSaveImage: fileTree.refreshOpenedFolder,
      assetsDirectory: settings.assetsDirectory,
    }),
    [
      docActions.applyProgrammaticMarkdown,
      docActions.replaceDocument,
      fileAction.runFileAction,
      fileTree.refreshOpenedFolder,
      settings.assetsDirectory,
    ]
  );

  useEffect(
    () => bindDropImageListener({
      replaceDocument: docActions.replaceDocument,
      runFileAction: fileAction.runFileAction,
      applyMarkdown: docActions.applyProgrammaticMarkdown,
      afterSaveImage: fileTree.refreshOpenedFolder,
      assetsDirectory: settings.assetsDirectory,
    }),
    [
      docActions.applyProgrammaticMarkdown,
      docActions.replaceDocument,
      fileAction.runFileAction,
      fileTree.refreshOpenedFolder,
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

  // Reset scroll state when document changes
  const documentKey = `${snapshot.filePath ?? "untitled"}:${editorRevisionRef.current}`;
  useEffect(() => {
    activeScrollRatioRef.current = 0;
    useEditorScrollStore.setState({ modeScrollTarget: null });
  }, [documentKey]);
}
