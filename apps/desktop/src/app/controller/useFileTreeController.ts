import { useCallback, useState, type Dispatch, type SetStateAction } from "react";
import type {
  FileTreeMutationResult,
  MarkdownFileTreeNode,
  MarkdownFolder
} from "@md-editor/file-system";
import type { ConfirmationState, ConfirmationChoice } from "@md-editor/editor-ui";
import { fileService } from "../../desktop/file-service";
import type { SidebarMode, TreeItemKind } from "../../types";
import { dirname, isSameOrChildPath } from "../../lib/path";
import { resolveOpenDocumentMutation } from "../files/file-tree-mutations";
import { runtime } from "../runtime/editor-runtime";
import { recentFilesStore } from "./recent-files-store";
import type { RunFileAction } from "./useFileActionController";

interface UseFileTreeControllerOptions {
  readonly clearMdxInsertRequest: (id?: number) => void;
  readonly requestConfirmation: (confirmation: ConfirmationState) => Promise<ConfirmationChoice>;
  readonly runFileAction: RunFileAction;
  readonly setIsSidebarVisible: Dispatch<SetStateAction<boolean>>;
  readonly setSidebarMode: Dispatch<SetStateAction<SidebarMode>>;
}

export function useFileTreeController({
  clearMdxInsertRequest,
  requestConfirmation,
  runFileAction,
  setIsSidebarVisible,
  setSidebarMode
}: UseFileTreeControllerOptions) {
  const [folder, setFolder] = useState<MarkdownFolder | null>(null);

  const refreshFolderForDocumentPath = useCallback(
    async (documentPath: string) => {
      const nextRootPath =
        folder && isSameOrChildPath(documentPath, folder.rootPath)
          ? folder.rootPath
          : dirname(documentPath);

      setFolder(await fileService.refreshFolder(nextRootPath));
      setSidebarMode("files");
    },
    [folder, setSidebarMode]
  );

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

  const showOpenedFolder = useCallback((openedFolder: MarkdownFolder) => {
    setFolder(openedFolder);
    setSidebarMode("files");
    setIsSidebarVisible(true);
  }, [setIsSidebarVisible, setSidebarMode]);

  const applyFileTreeMutation = useCallback(
    (result: FileTreeMutationResult, previousPath?: string) => {
      // 树节点改名/删除可能影响当前打开文档，这里把文件树结果同步回文档 runtime。
      setFolder(result.folder);

      const current = runtime.document.getSnapshot();
      const mutation = resolveOpenDocumentMutation(current.filePath, result, previousPath);
      if (mutation.kind === "move") {
        runtime.document.markSaved({
          markdown: current.markdown,
          filePath: mutation.filePath
        });
        return;
      }

      if (mutation.kind === "none") {
        return;
      }

      const markdown = "";
      clearMdxInsertRequest();
      runtime.document.updateMarkdown(markdown);
      runtime.document.markSaved({ markdown, filePath: null });
    },
    [clearMdxInsertRequest]
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
        if (result.affectedPath) {
          await recentFilesStore.move(node.path, {
            path: result.affectedPath,
            name: result.affectedPath.split("/").pop() || name
          });
        }
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

  return {
    folder,
    refreshFolderForDocumentPath,
    refreshOpenedFolder,
    showOpenedFolder,
    createTreeItem,
    renameTreeItem,
    deleteTreeItem
  };
}
