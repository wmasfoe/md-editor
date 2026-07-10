import { create } from "zustand";
import type {
  FileTreeMutationResult,
  MarkdownFileTreeNode,
  MarkdownFolder,
} from "@md-editor/file-system";
import type { TreeItemKind } from "../../types";
import { fileService } from "../../desktop/file-service";
import { dirname, isSameOrChildPath } from "../../lib/path";
import { resolveOpenDocumentMutation } from "../files/file-tree-mutations";
import { runtime } from "../runtime/editor-runtime";
import { recentFilesStore } from "../controller/recent-files-store";
import { useConfirmationStore } from "./confirmation-store";
import { useFileActionStore } from "./file-action-store";
import { useSidebarStore } from "./sidebar-store";

export interface FileTreeStore {
  folder: MarkdownFolder | null;
  refreshFolderForDocumentPath: (documentPath: string) => Promise<void>;
  refreshOpenedFolder: (documentPath?: string) => Promise<void>;
  showOpenedFolder: (folder: MarkdownFolder) => void;
  createTreeItem: (parentPath: string, kind: TreeItemKind, name: string) => Promise<void>;
  renameTreeItem: (node: MarkdownFileTreeNode, name: string) => Promise<void>;
  deleteTreeItem: (node: MarkdownFileTreeNode) => Promise<void>;
}

// 文件树变更可能影响当前打开文档；同步逻辑放在 store，调用方不需要硬算 rename/delete 影响面。
function applyFileTreeMutation(result: FileTreeMutationResult, previousPath?: string) {
  const current = runtime.document.getSnapshot();
  const mutation = resolveOpenDocumentMutation(current.filePath, result, previousPath);

  if (mutation.kind === "move") {
    runtime.document.markSaved({
      markdown: current.markdown,
      filePath: mutation.filePath,
    });
    return;
  }

  if (mutation.kind === "none") {
    return;
  }

  const markdown = "";
  runtime.document.updateMarkdown(markdown);
  runtime.document.markSaved({ markdown, filePath: null });
}

export const useFileTreeStore = create<FileTreeStore>((set, get) => ({
  folder: null,
  refreshFolderForDocumentPath: async (documentPath) => {
    const folder = get().folder;
    const nextRootPath =
      folder && isSameOrChildPath(documentPath, folder.rootPath)
        ? folder.rootPath
        : dirname(documentPath);

    set({ folder: await fileService.refreshFolder(nextRootPath) });
    useSidebarStore.getState().setSidebarMode("files");
  },
  refreshOpenedFolder: async (documentPath) => {
    const currentPath = documentPath ?? runtime.document.getSnapshot().filePath;
    if (!currentPath) {
      return;
    }

    await get().refreshFolderForDocumentPath(currentPath);
  },
  showOpenedFolder: (folder) => {
    set({ folder });
    const sidebar = useSidebarStore.getState();
    sidebar.setSidebarMode("files");
    sidebar.setIsSidebarVisible(true);
  },
  createTreeItem: async (parentPath, kind, name) => {
    const folder = get().folder;
    if (!folder) {
      return;
    }

    await useFileActionStore
      .getState()
      .runFileAction(kind === "markdown" ? "正在新建文件" : "正在新建文件夹", async () => {
        const result = await fileService.createTreeItem({
          rootPath: folder.rootPath,
          parentPath,
          name,
          kind,
        });
        set({ folder: result.folder });
        applyFileTreeMutation(result);
      });
  },
  renameTreeItem: async (node, name) => {
    const folder = get().folder;
    if (!folder || name === node.name) {
      return;
    }

    await useFileActionStore.getState().runFileAction("正在重命名", async () => {
      const result = await fileService.renameTreeItem({
        rootPath: folder.rootPath,
        path: node.path,
        name,
      });
      set({ folder: result.folder });
      applyFileTreeMutation(result, node.path);
      if (result.affectedPath) {
        await recentFilesStore.move(node.path, {
          path: result.affectedPath,
          name: result.affectedPath.split("/").pop() || name,
        });
      }
    });
  },
  deleteTreeItem: async (node) => {
    const folder = get().folder;
    if (!folder) {
      return;
    }

    const choice = await useConfirmationStore.getState().requestConfirmation({
      title: `删除“${node.name}”？`,
      description:
        node.kind === "directory" ? "该文件夹及其中的内容将被永久删除。" : "该文件将被永久删除。",
      confirmLabel: "删除",
      destructive: true,
    });
    if (choice !== "confirm") {
      return;
    }

    await useFileActionStore.getState().runFileAction("正在删除", async () => {
      const result = await fileService.deleteTreeItem({
        rootPath: folder.rootPath,
        path: node.path,
      });
      set({ folder: result.folder });
      applyFileTreeMutation(result, node.path);
    });
  },
}));
