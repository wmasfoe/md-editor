import { useCallback, useEffect, useMemo, useState } from "react";
import { switchEditorModeSafely, type EditorMode } from "@md-editor/editor-core";
import type { TocTarget } from "@md-editor/editor-ui";
import type {
  FileTreeMutationResult,
  MarkdownDocumentFile,
  MarkdownFileTreeNode,
  MarkdownFolder
} from "@md-editor/file-system";
import { extractHeadingOutline, findActiveHeadingIdForLine } from "@md-editor/markdown-fidelity";
import { fileService } from "../desktop/file-service";
import { dirname, isSameOrChildPath } from "../lib/path";
import { resolvePreviewImageSrc } from "../lib/markdown-preview";
import type { OpenedAsset, SidebarMode, TreeItemKind } from "../types";
import {
  bindBrowserDirtyDocumentGuard,
  bindDesktopMenuCommands,
  bindRuntimeKeyboardShortcuts,
  bindTauriCloseGuard
} from "./editor-events";
import { runtime } from "./editor-runtime";
import { resolveOpenDocumentMutation } from "./file-tree-mutations";
import { bindPasteImageListener } from "./paste-image-listener";

export function useDesktopEditorController() {
  const [snapshot, setSnapshot] = useState(() => runtime.getSnapshot());
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [tocTarget, setTocTarget] = useState<TocTarget | null>(null);
  const [folder, setFolder] = useState<MarkdownFolder | null>(null);
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>("files");
  const [editorRevision, setEditorRevision] = useState(0);
  const [openedAsset, setOpenedAsset] = useState<OpenedAsset | null>(null);
  const [activeOutlineId, setActiveOutlineId] = useState<string | null>(null);
  const documentKey = `${snapshot.filePath ?? "untitled"}:${snapshot.savedMarkdown}:${editorRevision}`;
  const outline = useMemo(() => extractHeadingOutline(snapshot.markdown), [snapshot.markdown]);

  const commitMarkdown = useCallback((markdown: string) => {
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

  const ensureDiscardAllowed = useCallback(() => {
    return (
      !runtime.document.getSnapshot().isDirty ||
      window.confirm("Current document has unsaved changes. Continue?")
    );
  }, []);

  const runFileAction = useCallback(async (label: string, action: () => Promise<void> | void) => {
    setPendingAction(label);
    setErrorMessage(null);
    try {
      await action();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "File operation failed.");
    } finally {
      setPendingAction(null);
    }
  }, []);

  const createNewDocument = useCallback(() => {
    if (!ensureDiscardAllowed()) {
      return;
    }

    const nextDocument = fileService.newDocument();
    runtime.document.updateMarkdown(nextDocument.markdown);
    setSnapshot(
      runtime.document.markSaved({
        markdown: nextDocument.markdown,
        filePath: nextDocument.filePath
      })
    );
    setErrorMessage(null);
  }, [ensureDiscardAllowed]);

  const openDocument = useCallback(async () => {
    if (!ensureDiscardAllowed()) {
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

  const openFolder = useCallback(async () => {
    await runFileAction("正在打开文件夹", async () => {
      const openedFolder = await fileService.openFolder();
      if (!openedFolder) {
        return;
      }
      setFolder(openedFolder);
      setSidebarMode("files");
    });
  }, [runFileAction]);

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
      if (!ensureDiscardAllowed()) {
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

      const markdown = "# Untitled\n\nStart writing Markdown.";
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

      const confirmed = window.confirm(`确定删除“${node.name}”吗？`);
      if (!confirmed) {
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
    [applyFileTreeMutation, folder, runFileAction]
  );

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
          await refreshFolderForDocumentPath(saved.filePath);
        }
      });
    },
    [refreshFolderForDocumentPath, replaceDocument, runFileAction]
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
    setSidebarMode((current) => (current === "files" ? "outline" : "files"));
  }, []);

  const dispatchCommand = useCallback(
    async (id: string) => {
      await runtime.commands.dispatch(id, {
        document: runtime.document,
        actions: {
          newDocument: createNewDocument,
          openDocument,
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
      openFolder,
      saveDocument,
      switchMode,
      toggleSidebarPrimary,
      toggleSourceMode
    ]
  );

  useEffect(() => bindRuntimeKeyboardShortcuts(dispatchCommand), [dispatchCommand]);
  useEffect(() => bindDesktopMenuCommands(dispatchCommand), [dispatchCommand]);
  useEffect(() => bindBrowserDirtyDocumentGuard(), []);
  useEffect(() => bindTauriCloseGuard(), []);

  return {
    snapshot,
    errorMessage,
    pendingAction,
    tocTarget,
    folder,
    sidebarMode,
    openedAsset,
    documentKey,
    outline,
    activeOutlineId,
    setSidebarMode,
    commitMarkdown,
    dispatchCommand,
    openDocumentFromTree,
    openAssetFromTree,
    createTreeItem,
    renameTreeItem,
    deleteTreeItem,
    jumpToTocItem,
    setActiveOutlineId,
    updateActiveOutlineForLine,
    resolveImageSrc
  };
}
