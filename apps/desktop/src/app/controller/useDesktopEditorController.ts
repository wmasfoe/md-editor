import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { switchEditorModeSafely, type EditorMode, createRecentFilesStore } from "@md-editor/editor-core";
import type { ConfirmationChoice, ConfirmationState, TocTarget } from "@md-editor/editor-ui";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type {
  FileTreeMutationResult,
  MarkdownDocumentFile,
  MarkdownFileTreeNode,
  MarkdownFolder
} from "@md-editor/file-system";
import { extractHeadingOutline, findActiveHeadingIdForLine } from "@md-editor/markdown-fidelity";
import { fileService } from "../../desktop/file-service";
import { dirname, isSameOrChildPath } from "../../lib/path";
import { resolvePreviewImageSrc } from "../../lib/markdown-preview";
import type { OpenedAsset, SidebarMode, TreeItemKind } from "../../types";
import {
  bindDesktopMenuCommands,
  bindRuntimeKeyboardShortcuts
} from "../events/command-bindings";
import { bindDropImageListener } from "../events/drop-image-listener";
import { bindRecentFileMenuEvents } from "../events/recent-file-events";
import { bindPasteImageListener } from "../events/paste-image-listener";
import { bindBrowserDirtyDocumentGuard, bindTauriCloseGuard } from "../events/window-guards";
import { findFirstMarkdownPath, resolveOpenDocumentMutation } from "../files/file-tree-mutations";
import { runtime } from "../runtime/editor-runtime";
import { shouldRefreshFolderAfterSave } from "./save-folder-refresh";

const recentFilesStore = createRecentFilesStore();

export function useDesktopEditorController() {
  const [snapshot, setSnapshot] = useState(() => runtime.getSnapshot());
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [tocTarget, setTocTarget] = useState<TocTarget | null>(null);
  const [folder, setFolder] = useState<MarkdownFolder | null>(null);
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>("files");
  const [isSidebarVisible, setIsSidebarVisible] = useState(() => window.innerWidth >= 960);
  const [hasActiveDocument, setHasActiveDocument] = useState(false);
  const [editorRevision, setEditorRevision] = useState(0);
  const [openedAsset, setOpenedAsset] = useState<OpenedAsset | null>(null);
  const [activeOutlineId, setActiveOutlineId] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<ConfirmationState | null>(null);
  const confirmationResolver = useRef<((choice: ConfirmationChoice) => void) | null>(null);
  const documentKey = `${snapshot.filePath ?? "untitled"}:${snapshot.savedMarkdown}:${editorRevision}`;
  const deferredMarkdown = useDeferredValue(snapshot.markdown);
  const outline = useMemo(() => extractHeadingOutline(deferredMarkdown), [deferredMarkdown]);

  const commitMarkdown = useCallback((markdown: string) => {
    setHasActiveDocument(true);
    setErrorMessage(null);
    setOpenedAsset(null);
    setSnapshot(runtime.document.updateMarkdown(markdown));
  }, []);

  const applyProgrammaticMarkdown = useCallback((markdown: string) => {
    setErrorMessage(null);
    setOpenedAsset(null);
    setSnapshot(runtime.document.updateMarkdown(markdown));
    setEditorRevision((current) => current + 1);
  }, []);

  const switchMode = useCallback(async (mode: EditorMode) => {
    const result = await switchEditorModeSafely(runtime.document, mode);
    setSnapshot(result.snapshot);
    setErrorMessage(result.ok ? null : result.message);
  }, []);

  const toggleSourceMode = useCallback(async () => {
    const currentMode = runtime.document.getSnapshot().mode;
    await switchMode(currentMode === "source" ? "wysiwyg" : "source");
  }, [switchMode]);

  const replaceDocument = useCallback((document: MarkdownDocumentFile | null) => {
    if (!document) {
      return;
    }

    runtime.document.updateMarkdown(document.markdown);
    setSnapshot(
      runtime.document.markSaved({
        markdown: document.markdown,
        filePath: document.filePath
      })
    );
    setErrorMessage(null);
    setOpenedAsset(null);
    setHasActiveDocument(true);

    // 添加到最近文件列表
    const fileName = document.filePath.split("/").pop() || "Untitled";
    void recentFilesStore.add({
      path: document.filePath,
      name: fileName
    }).catch((error: unknown) => {
      setErrorMessage(error instanceof Error ? error.message : "最近文件保存失败。");
    });
  }, []);

  const refreshFolderForDocumentPath = useCallback(
    async (documentPath: string) => {
      const nextRootPath =
        folder && isSameOrChildPath(documentPath, folder.rootPath)
          ? folder.rootPath
          : dirname(documentPath);

      setFolder(await fileService.refreshFolder(nextRootPath));
      setSidebarMode("files");
    },
    [folder]
  );

  const runFileAction = useCallback(async (label: string, action: () => Promise<void> | void) => {
    setPendingAction(label);
    setErrorMessage(null);
    try {
      await action();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "文件操作失败。");
    } finally {
      setPendingAction(null);
    }
  }, []);

  const requestConfirmation = useCallback((nextConfirmation: ConfirmationState) => {
    return new Promise<ConfirmationChoice>((resolve) => {
      confirmationResolver.current = resolve;
      setConfirmation(nextConfirmation);
    });
  }, []);

  const resolveConfirmation = useCallback((choice: ConfirmationChoice) => {
    const resolve = confirmationResolver.current;
    confirmationResolver.current = null;
    setConfirmation(null);
    resolve?.(choice);
  }, []);

  const saveDocument = useCallback(
    async (forceDialog = false) => {
      await runFileAction(forceDialog ? "正在另存为" : "正在保存", async () => {
        const current = runtime.document.getSnapshot();
        const saved = forceDialog
          ? await fileService.saveDocumentAs({
              filePath: current.filePath,
              markdown: current.markdown
            })
          : await fileService.saveDocument({
              filePath: current.filePath,
              markdown: current.markdown
            });

        if (saved) {
          // Only the native save confirmation clears dirty state; cancelled
          // dialogs and failed writes keep the document unsaved.
          replaceDocument(saved);
          if (
            shouldRefreshFolderAfterSave({
              previousPath: current.filePath,
              savedPath: saved.filePath,
              openedRootPath: folder?.rootPath ?? null
            })
          ) {
            await refreshFolderForDocumentPath(saved.filePath);
          }
        }
      });
    },
    [folder?.rootPath, refreshFolderForDocumentPath, replaceDocument, runFileAction]
  );

  const ensureDiscardAllowed = useCallback(async (description?: string) => {
    if (!runtime.document.getSnapshot().isDirty) {
      return true;
    }

    const choice = await requestConfirmation({
      title: "保存当前文档的更改？",
      description:
        description ?? "继续后将切换到其他文档。你可以先保存，或放弃尚未保存的更改。",
      confirmLabel: "保存并继续",
      secondaryLabel: "不保存"
    });

    if (choice === "secondary") {
      return true;
    }
    if (choice !== "confirm") {
      return false;
    }

    await saveDocument(false);
    return !runtime.document.getSnapshot().isDirty;
  }, [requestConfirmation, saveDocument]);

  const createNewDocument = useCallback(async () => {
    if (!(await ensureDiscardAllowed())) {
      return;
    }

    const nextDocument = fileService.newDocument("");
    runtime.document.updateMarkdown(nextDocument.markdown);
    setSnapshot(
      runtime.document.markSaved({
        markdown: nextDocument.markdown,
        filePath: nextDocument.filePath
      })
    );
    setErrorMessage(null);
    setOpenedAsset(null);
    setHasActiveDocument(true);
  }, [ensureDiscardAllowed]);

  const openDocument = useCallback(async () => {
    if (!(await ensureDiscardAllowed())) {
      return;
    }

    await runFileAction("正在打开", async () => {
      const document = await fileService.openDocument();
      replaceDocument(document);
      if (document) {
        await refreshFolderForDocumentPath(document.filePath);
      }
    });
  }, [ensureDiscardAllowed, refreshFolderForDocumentPath, replaceDocument, runFileAction]);

  const openRecentFile = useCallback(
    async (filePath: string) => {
      if (!(await ensureDiscardAllowed())) {
        return;
      }

      await runFileAction("正在打开", async () => {
        try {
          const document = await fileService.openDocumentAtPath(filePath);
          replaceDocument(document);
          await refreshFolderForDocumentPath(document.filePath);
        } catch (error) {
          // 文件可能已被删除或移动，从最近列表中移除
          await recentFilesStore.remove(filePath);
          throw error;
        }
      });
    },
    [ensureDiscardAllowed, refreshFolderForDocumentPath, replaceDocument, runFileAction]
  );

  const openRecentDocument = useCallback(async () => {
    const recentFiles = recentFilesStore.list();

    if (recentFiles.length === 0) {
      setErrorMessage("没有最近打开的文件");
      return;
    }
    setErrorMessage("请从“最近文件”菜单中选择要打开的文件。");
  }, []);

  const openFolder = useCallback(async () => {
    if (!(await ensureDiscardAllowed())) {
      return;
    }

    await runFileAction("正在打开文件夹", async () => {
      const openedFolder = await fileService.openFolder();
      if (!openedFolder) {
        return;
      }
      const firstMarkdownPath = findFirstMarkdownPath(openedFolder.tree);
      const firstDocument = firstMarkdownPath
        ? await fileService.openDocumentAtPath(firstMarkdownPath)
        : null;
      setFolder(openedFolder);
      setSidebarMode("files");
      setIsSidebarVisible(true);
      replaceDocument(firstDocument);
    });
  }, [ensureDiscardAllowed, replaceDocument, runFileAction]);

  const refreshOpenedFolder = useCallback(
    async (documentPath?: string) => {
      const currentPath = documentPath ?? runtime.document.getSnapshot().filePath;
      if (!currentPath) {
        return;
      }

      await refreshFolderForDocumentPath(currentPath);
    },
    [refreshFolderForDocumentPath]
  );

  const openDocumentFromTree = useCallback(
    async (filePath: string) => {
      if (!(await ensureDiscardAllowed())) {
        return;
      }

      await runFileAction("正在打开", async () => {
        const document = await fileService.openDocumentAtPath(filePath);
        replaceDocument(document);
        await refreshFolderForDocumentPath(document.filePath);
      });
    },
    [ensureDiscardAllowed, refreshFolderForDocumentPath, replaceDocument, runFileAction]
  );

  const openAssetFromTree = useCallback((node: MarkdownFileTreeNode) => {
    setErrorMessage(null);
    setOpenedAsset({ name: node.name, path: node.path });
  }, []);

  const closeAssetPreview = useCallback(() => {
    setOpenedAsset(null);
  }, []);

  const applyFileTreeMutation = useCallback(
    (result: FileTreeMutationResult, previousPath?: string) => {
      setFolder(result.folder);

      const current = runtime.document.getSnapshot();
      const mutation = resolveOpenDocumentMutation(current.filePath, result, previousPath);
      if (mutation.kind === "move") {
        setSnapshot(
          runtime.document.markSaved({
            markdown: current.markdown,
            filePath: mutation.filePath
          })
        );
        return;
      }

      if (mutation.kind === "none") {
        return;
      }

      const markdown = "";
      runtime.document.updateMarkdown(markdown);
      setSnapshot(runtime.document.markSaved({ markdown, filePath: null }));
    },
    []
  );

  const createTreeItem = useCallback(
    async (parentPath: string, kind: TreeItemKind, name: string) => {
      if (!folder) {
        return;
      }

      await runFileAction(kind === "markdown" ? "正在新建文件" : "正在新建文件夹", async () => {
        const result = await fileService.createTreeItem({
          rootPath: folder.rootPath,
          parentPath,
          name,
          kind
        });
        applyFileTreeMutation(result);
      });
    },
    [applyFileTreeMutation, folder, runFileAction]
  );

  const renameTreeItem = useCallback(
    async (node: MarkdownFileTreeNode, name: string) => {
      if (!folder || name === node.name) {
        return;
      }

      await runFileAction("正在重命名", async () => {
        const result = await fileService.renameTreeItem({
          rootPath: folder.rootPath,
          path: node.path,
          name
        });
        applyFileTreeMutation(result, node.path);
      });
    },
    [applyFileTreeMutation, folder, runFileAction]
  );

  const deleteTreeItem = useCallback(
    async (node: MarkdownFileTreeNode) => {
      if (!folder) {
        return;
      }

      const choice = await requestConfirmation({
        title: `删除“${node.name}”？`,
        description: node.kind === "directory" ? "该文件夹及其中的内容将被永久删除。" : "该文件将被永久删除。",
        confirmLabel: "删除",
        destructive: true
      });
      if (choice !== "confirm") {
        return;
      }

      await runFileAction("正在删除", async () => {
        const result = await fileService.deleteTreeItem({
          rootPath: folder.rootPath,
          path: node.path
        });
        applyFileTreeMutation(result, node.path);
      });
    },
    [applyFileTreeMutation, folder, requestConfirmation, runFileAction]
  );

  useEffect(
    () =>
      bindPasteImageListener({
        replaceDocument,
        runFileAction,
        applyMarkdown: applyProgrammaticMarkdown,
        afterSaveImage: refreshOpenedFolder
      }),
    [applyProgrammaticMarkdown, refreshOpenedFolder, replaceDocument, runFileAction]
  );
  useEffect(
    () =>
      bindDropImageListener({
        replaceDocument,
        runFileAction,
        applyMarkdown: applyProgrammaticMarkdown,
        afterSaveImage: refreshOpenedFolder
      }),
    [applyProgrammaticMarkdown, refreshOpenedFolder, replaceDocument, runFileAction]
  );

  const jumpToTocItem = useCallback((target: Omit<TocTarget, "nonce">) => {
    const matched = outline.find(
      (item) => item.line === target.line && item.level === target.level && item.text === target.text
    );
    setActiveOutlineId(matched?.id ?? null);
    setTocTarget({ ...target, nonce: Date.now() });
  }, [outline]);

  const updateActiveOutlineForLine = useCallback(
    (line: number) => {
      setActiveOutlineId(findActiveHeadingIdForLine(outline, line));
    },
    [outline]
  );

  useEffect(() => {
    // Editing can delete or rename the active heading. Clear stale ids so the
    // outline never highlights a section that no longer exists.
    if (activeOutlineId && !outline.some((item) => item.id === activeOutlineId)) {
      setActiveOutlineId(null);
    }
  }, [activeOutlineId, outline]);

  const resolveImageSrc = useCallback(
    (src: string) => resolvePreviewImageSrc(snapshot.filePath, src),
    [snapshot.filePath]
  );

  const toggleSidebarPrimary = useCallback(async () => {
    setIsSidebarVisible((current) => !current);
  }, []);

  const getRecentFiles = useCallback(() => {
    return recentFilesStore.list();
  }, []);

  const dispatchCommand = useCallback(
    async (id: string) => {
      // Global menu and keyboard events are captured outside React. Ignore
      // them while a modal decision is pending so its Promise cannot be lost.
      if (confirmationResolver.current) {
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
      saveDocument,
      switchMode,
      toggleSidebarPrimary,
      toggleSourceMode
    ]
  );

  useEffect(() => {
    return bindRuntimeKeyboardShortcuts(dispatchCommand);
  }, [dispatchCommand]);
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
    const title = `${snapshot.isDirty ? "• " : ""}${fileName} - Markdown Editor`;
    document.title = title;
    if (isTauri()) {
      // The web preview has no native window; a title-sync failure must never
      // interrupt editing in either runtime.
      void getCurrentWindow().setTitle(title).catch(() => undefined);
    }
  }, [snapshot.filePath, snapshot.isDirty]);

  useEffect(
    () =>
      bindRecentFileMenuEvents({
        store: recentFilesStore,
        openRecentFile,
        onError: setErrorMessage
      }),
    [openRecentFile]
  );

  return {
    snapshot,
    errorMessage,
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
    setSidebarMode,
    setIsSidebarVisible,
    commitMarkdown,
    dispatchCommand,
    openDocumentFromTree,
    openAssetFromTree,
    closeAssetPreview,
    createTreeItem,
    renameTreeItem,
    deleteTreeItem,
    jumpToTocItem,
    setActiveOutlineId,
    resolveConfirmation,
    updateActiveOutlineForLine,
    resolveImageSrc,
    getRecentFiles,
    openRecentFile
  };
}
