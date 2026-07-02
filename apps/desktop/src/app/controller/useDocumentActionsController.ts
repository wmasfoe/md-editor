import { useCallback, type Dispatch, type SetStateAction } from "react";
import {
  switchEditorModeSafely,
  type EditorMode
} from "@md-editor/editor-core";
import type { ConfirmationChoice, ConfirmationState } from "@md-editor/editor-ui";
import type { MarkdownDocumentFile, MarkdownFolder } from "@md-editor/file-system";
import { fileService } from "../../desktop/file-service";
import type { OpenedAsset } from "../../types";
import { findFirstMarkdownPath } from "../files/file-tree-mutations";
import { runtime } from "../runtime/editor-runtime";
import { recentFilesStore } from "./recent-files-store";
import { shouldRefreshFolderAfterSave } from "./save-folder-refresh";
import type { RunFileAction } from "./useFileActionController";

type EditorSnapshot = ReturnType<typeof runtime.getSnapshot>;

interface UseDocumentActionsControllerOptions {
  readonly clearMdxInsertRequest: (id?: number) => void;
  readonly refreshFolderForDocumentPath: (documentPath: string) => Promise<void>;
  readonly requestConfirmation: (confirmation: ConfirmationState) => Promise<ConfirmationChoice>;
  readonly runFileAction: RunFileAction;
  readonly setHasActiveDocument: Dispatch<SetStateAction<boolean>>;
  readonly setOpenedAsset: Dispatch<SetStateAction<OpenedAsset | null>>;
  readonly setEditorRevision: Dispatch<SetStateAction<number>>;
  readonly setSnapshot: Dispatch<SetStateAction<EditorSnapshot>>;
  readonly showOpenedFolder: (folder: MarkdownFolder) => void;
  readonly showToast: (message: string | null) => void;
}

export function useDocumentActionsController({
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
}: UseDocumentActionsControllerOptions) {
  const rememberRecentDocument = useCallback((document: MarkdownDocumentFile) => {
    // 最近文件菜单和欢迎页共享同一个 store；文档打开/保存成功后统一在这里登记。
    const fileName = document.filePath.split("/").pop() || "Untitled";
    void recentFilesStore.add({
      path: document.filePath,
      name: fileName
    }).catch((error: unknown) => {
      showToast(error instanceof Error ? error.message : "最近文件保存失败。");
    });
  }, [showToast]);

  const commitMarkdown = useCallback((markdown: string) => {
    setHasActiveDocument(true);
    showToast(null);
    setOpenedAsset(null);
    setSnapshot(runtime.document.updateMarkdown(markdown));
  }, [setHasActiveDocument, setOpenedAsset, setSnapshot, showToast]);

  const applyProgrammaticMarkdown = useCallback((markdown: string) => {
    showToast(null);
    setOpenedAsset(null);
    setSnapshot(runtime.document.updateMarkdown(markdown));
    setEditorRevision((current) => current + 1);
  }, [setEditorRevision, setOpenedAsset, setSnapshot, showToast]);

  const switchMode = useCallback(async (mode: EditorMode) => {
    const result = await switchEditorModeSafely(runtime.document, mode);
    setSnapshot(result.snapshot);
    showToast(result.ok ? null : result.message);
  }, [setSnapshot, showToast]);

  const toggleSourceMode = useCallback(async () => {
    const currentMode = runtime.document.getSnapshot().mode;
    await switchMode(currentMode === "source" ? "wysiwyg" : "source");
  }, [switchMode]);

  const replaceDocument = useCallback((document: MarkdownDocumentFile | null) => {
    if (!document) {
      return;
    }

    clearMdxInsertRequest();
    runtime.document.updateMarkdown(document.markdown);
    setSnapshot(
      runtime.document.markSaved({
        markdown: document.markdown,
        filePath: document.filePath
      })
    );
    showToast(null);
    setOpenedAsset(null);
    setHasActiveDocument(true);
    rememberRecentDocument(document);
  }, [
    clearMdxInsertRequest,
    rememberRecentDocument,
    setHasActiveDocument,
    setOpenedAsset,
    setSnapshot,
    showToast
  ]);

  const startBlankDocument = useCallback(() => {
    const markdown = "";
    clearMdxInsertRequest();
    runtime.document.updateMarkdown(markdown);
    setSnapshot(runtime.document.markSaved({ markdown, filePath: null }));
    setEditorRevision((current) => current + 1);
    showToast(null);
    setOpenedAsset(null);
    setHasActiveDocument(true);
  }, [
    clearMdxInsertRequest,
    setEditorRevision,
    setHasActiveDocument,
    setOpenedAsset,
    setSnapshot,
    showToast
  ]);

  const markCurrentDocumentSaved = useCallback((document: MarkdownDocumentFile) => {
    const latest = runtime.document.getSnapshot();
    const nextSnapshot = latest.markdown === document.markdown
      ? runtime.document.markSaved({
          markdown: document.markdown,
          filePath: document.filePath
        })
      : runtime.document.updateSavedBaseline({
          markdown: document.markdown,
          filePath: document.filePath
        });

    setSnapshot(nextSnapshot);
    showToast(null);
    setOpenedAsset(null);
    rememberRecentDocument(document);
  }, [rememberRecentDocument, setOpenedAsset, setSnapshot, showToast]);

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
          // 只有原生保存确认成功后才清除 dirty；取消弹窗或写入失败都保持未保存状态。
          markCurrentDocumentSaved(saved);
          if (
            shouldRefreshFolderAfterSave({
              previousPath: current.filePath,
              savedPath: saved.filePath
            })
          ) {
            await refreshFolderForDocumentPath(saved.filePath);
          }
        }
      }, { feedback: "quiet" });
    },
    [markCurrentDocumentSaved, refreshFolderForDocumentPath, runFileAction]
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
    clearMdxInsertRequest();
    runtime.document.updateMarkdown(nextDocument.markdown);
    setSnapshot(
      runtime.document.markSaved({
        markdown: nextDocument.markdown,
        filePath: nextDocument.filePath
      })
    );
    showToast(null);
    setOpenedAsset(null);
    setHasActiveDocument(true);
  }, [
    clearMdxInsertRequest,
    ensureDiscardAllowed,
    setHasActiveDocument,
    setOpenedAsset,
    setSnapshot,
    showToast
  ]);

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
          // 文件可能已被删除或移动，从最近列表中移除。
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
      showToast("没有最近打开的文件");
      return;
    }
    showToast("请从“最近文件”菜单中选择要打开的文件。");
  }, [showToast]);

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
      showOpenedFolder(openedFolder);
      if (firstDocument) {
        replaceDocument(firstDocument);
      } else {
        // 文件夹没有 Markdown 时仍然展示文件树，并启动一个保存时会弹位置选择的空白文档。
        startBlankDocument();
      }
    });
  }, [ensureDiscardAllowed, replaceDocument, runFileAction, showOpenedFolder, startBlankDocument]);

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

  const getRecentFiles = useCallback(() => {
    return recentFilesStore.list();
  }, []);

  return {
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
  };
}
