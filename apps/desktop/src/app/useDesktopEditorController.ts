import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useMemo, useState } from "react";
import { switchEditorModeSafely, type EditorMode } from "@md-editor/editor-core";
import type { TocTarget } from "@md-editor/editor-ui";
import type {
  FileTreeMutationResult,
  MarkdownDocumentFile,
  MarkdownFileTreeNode,
  MarkdownFolder
} from "@md-editor/file-system";
import { extractHeadingOutline } from "@md-editor/markdown-fidelity";
import { fileService } from "../desktop/file-service";
import { listenToDesktopMenuActions } from "../desktop/menu-events";
import { matchesRuntimeKeymap } from "../lib/keyboard";
import { dirname, isSameOrChildPath } from "../lib/path";
import { getPastedImage, pasteImageInput } from "../lib/paste-image";
import { resolvePreviewImageSrc } from "../lib/markdown-preview";
import type { KeyboardShortcut, OpenedAsset, SidebarMode, TreeItemKind } from "../types";
import { runtime } from "./editor-runtime";

export function useDesktopEditorController() {
  const [snapshot, setSnapshot] = useState(() => runtime.getSnapshot());
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [tocTarget, setTocTarget] = useState<TocTarget | null>(null);
  const [folder, setFolder] = useState<MarkdownFolder | null>(null);
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>("files");
  const [editorRevision, setEditorRevision] = useState(0);
  const [openedAsset, setOpenedAsset] = useState<OpenedAsset | null>(null);
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
      if (!current.filePath) {
        return;
      }

      if (!previousPath || !isSameOrChildPath(current.filePath, previousPath)) {
        return;
      }

      if (result.affectedPath) {
        // Rename returns the new root path for the changed item. If the open
        // document is inside that renamed folder, preserve its relative suffix.
        const nextFilePath =
          current.filePath === previousPath
            ? result.affectedPath
            : `${result.affectedPath}${current.filePath.slice(previousPath.length)}`;

        setSnapshot(
          runtime.document.markSaved({
            markdown: current.markdown,
            filePath: nextFilePath
          })
        );
        return;
      }

      const markdown = "# Untitled\n\nStart writing Markdown.";
      runtime.document.updateMarkdown(markdown);
      setSnapshot(runtime.document.markSaved({ markdown, filePath: null }));
    },
    []
  );

  const createTreeItem = useCallback(
    async (parentPath: string, kind: TreeItemKind) => {
      if (!folder) {
        return;
      }

      const defaultName = kind === "markdown" ? "Untitled.md" : "Untitled";
      const name = window.prompt(kind === "markdown" ? "新建 Markdown 文件" : "新建文件夹", defaultName);
      if (!name) {
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
    async (node: MarkdownFileTreeNode) => {
      if (!folder) {
        return;
      }

      const name = window.prompt("重命名", node.name);
      if (!name || name === node.name) {
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

  useEffect(() => {
    const listener = (event: ClipboardEvent) => {
      if (!event.clipboardData) {
        return;
      }

      const image = getPastedImage(event.clipboardData);
      if (!image) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      void pasteImageInput(image, {
        replaceDocument,
        runFileAction,
        applyMarkdown: applyProgrammaticMarkdown,
        afterSaveImage: refreshOpenedFolder
      });
    };

    window.addEventListener("paste", listener, true);
    return () => window.removeEventListener("paste", listener, true);
  }, [applyProgrammaticMarkdown, refreshOpenedFolder, replaceDocument, runFileAction]);

  const jumpToTocItem = useCallback((target: Omit<TocTarget, "nonce">) => {
    setTocTarget({ ...target, nonce: Date.now() });
  }, []);

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

  useEffect(() => {
    // Keymaps come from editor-core so menu actions, app commands, and keyboard
    // shortcuts stay on the same command IDs instead of drifting independently.
    const shortcuts: readonly KeyboardShortcut[] = runtime.keymaps.list().map((keymap) => ({
      matches: (event) => matchesRuntimeKeymap(event, keymap.key),
      run: () => {
        void dispatchCommand(keymap.commandId);
      }
    }));

    const listener = (event: KeyboardEvent) => {
      const shortcut = shortcuts.find((candidate) => candidate.matches(event));
      if (!shortcut) {
        return;
      }

      event.preventDefault();
      shortcut.run(event);
    };

    window.addEventListener("keydown", listener, { capture: true });
    return () => window.removeEventListener("keydown", listener, { capture: true });
  }, [dispatchCommand]);

  const runMenuAction = useCallback(
    (action: string) => {
      switch (action) {
        case "md-editor:new":
          void dispatchCommand("file.new");
          break;
        case "md-editor:open":
          void dispatchCommand("file.open");
          break;
        case "md-editor:open-folder":
          void dispatchCommand("file.openFolder");
          break;
        case "md-editor:save":
          void dispatchCommand("file.save");
          break;
        case "md-editor:save-as":
          void dispatchCommand("file.saveAs");
          break;
        case "md-editor:mode-wysiwyg":
          void dispatchCommand("view.showWysiwyg");
          break;
        case "md-editor:toggle-source":
          void dispatchCommand("view.toggleSource");
          break;
        case "md-editor:toggle-sidebar-primary":
          void dispatchCommand("view.toggleSidebarPrimary");
          break;
      }
    },
    [dispatchCommand]
  );

  useEffect(() => listenToDesktopMenuActions(runMenuAction), [runMenuAction]);

  useEffect(() => {
    const listener = (event: BeforeUnloadEvent) => {
      if (!runtime.document.getSnapshot().isDirty) {
        return;
      }

      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", listener);
    return () => window.removeEventListener("beforeunload", listener);
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    if (!isTauri()) {
      return undefined;
    }

    void getCurrentWindow().onCloseRequested((event) => {
      if (!runtime.document.getSnapshot().isDirty) {
        return;
      }

      const confirmed = window.confirm("Current document has unsaved changes. Close anyway?");
      if (!confirmed) {
        event.preventDefault();
      }
    }).then((dispose) => {
      unlisten = dispose;
    });

    return () => {
      unlisten?.();
    };
  }, []);

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
    setSidebarMode,
    commitMarkdown,
    dispatchCommand,
    openDocumentFromTree,
    openAssetFromTree,
    createTreeItem,
    renameTreeItem,
    deleteTreeItem,
    jumpToTocItem,
    resolveImageSrc
  };
}
