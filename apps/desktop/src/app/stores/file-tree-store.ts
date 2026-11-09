import { create } from "zustand";
import type {
  FileTreeMutationResult,
  MarkdownFileTreeNode,
  MarkdownFolder,
  RuntimeFileService,
} from "@md-editor/file-system";
import type { TreeItemKind } from "../../types";
import { dirname, isSameOrChildPath } from "../../lib/path";
import { resolveOpenDocumentMutation } from "../files/file-tree-mutations";
import { runtime } from "../runtime/editor-runtime";
import { recentFilesStore } from "../controller/recent-files-store";
import { useConfirmationStore } from "./confirmation-store";
import { useFileActionStore } from "./file-action-store";
import { useSidebarStore } from "./sidebar-store";
import { watchFolder } from "../../desktop/file-adapter";
import { syncStyleLearningRename } from "../ai/style-learning/style-exclusions";
import { workspaceRelativePath } from "../ai/style-learning/paths";

function syncStyleLearningRenameForTree(
  rootPath: string,
  fromPath: string,
  toPath: string,
): Promise<void> {
  const from = workspaceRelativePath(rootPath, fromPath);
  const to = workspaceRelativePath(rootPath, toPath);
  if (!from || !to) return Promise.resolve();
  return syncStyleLearningRename(rootPath, from, to).catch(() => undefined);
}

export interface FileTreeStore {
  folder: MarkdownFolder | null;
  refreshFolderForDocumentPath: (
    fileService: RuntimeFileService,
    documentPath: string,
  ) => Promise<void>;
  refreshOpenedFolder: (fileService: RuntimeFileService, documentPath?: string) => Promise<void>;
  showOpenedFolder: (folder: MarkdownFolder) => void;
  createTreeItem: (
    fileService: RuntimeFileService,
    parentPath: string,
    kind: TreeItemKind,
    name: string,
  ) => Promise<void>;
  renameTreeItem: (
    fileService: RuntimeFileService,
    node: MarkdownFileTreeNode,
    name: string,
  ) => Promise<void>;
  deleteTreeItem: (fileService: RuntimeFileService, node: MarkdownFileTreeNode) => Promise<void>;
}

// 文件树变更可能影响当前打开文档；同步逻辑放在 store，调用方不需要硬算 rename/delete 影响面。
export function applyFileTreeMutation(
  fileMutation: FileTreeMutationResult,
  previousPath?: string,
): void {
  const current = runtime.document.getSnapshot();
  const mutation = resolveOpenDocumentMutation(current.filePath, fileMutation, previousPath);

  if (mutation.kind === "move") {
    const coreResult = runtime.document.setDocumentPath({
      filePath: mutation.filePath,
      expectedGeneration: current.documentGeneration,
      expectedStateRevision: current.stateRevision,
      origin: { kind: "command", commandId: "file-tree.rename" },
    });
    assertDocumentMutationApplied(coreResult.status, "rename the open document");
    return;
  }

  if (mutation.kind === "none") {
    return;
  }

  const coreResult = runtime.document.replaceDocument(
    { markdown: "", savedMarkdown: "", filePath: null },
    { kind: "command", commandId: "file-tree.delete" },
  );
  assertDocumentMutationApplied(coreResult.status, "replace the deleted open document");
}

function assertDocumentMutationApplied(status: string, operation: string): void {
  if (status !== "applied" && status !== "noop") {
    throw new Error(`Could not ${operation}: ${status}.`);
  }
}

export const useFileTreeStore = create<FileTreeStore>((set, get) => ({
  folder: null,
  refreshFolderForDocumentPath: async (fileService, documentPath) => {
    const folder = get().folder;
    const nextRootPath =
      folder && isSameOrChildPath(documentPath, folder.rootPath)
        ? folder.rootPath
        : dirname(documentPath);

    const nextFolder = await fileService.refreshFolder(nextRootPath);
    set({ folder: nextFolder });
    useSidebarStore.getState().setSidebarMode("files");
    void watchFolder(nextFolder.rootPath);
  },
  refreshOpenedFolder: async (fileService, documentPath) => {
    const folder = get().folder;
    const targetPath = documentPath ?? folder?.rootPath ?? runtime.document.getSnapshot().filePath;
    if (!targetPath) {
      return;
    }

    if (folder?.rootPath && (!documentPath || isSameOrChildPath(documentPath, folder.rootPath))) {
      const refreshed = await fileService.refreshFolder(folder.rootPath);
      set({ folder: refreshed });
      void watchFolder(refreshed.rootPath);
      return;
    }

    await get().refreshFolderForDocumentPath(fileService, targetPath);
  },
  showOpenedFolder: (folder) => {
    set({ folder });
    const sidebar = useSidebarStore.getState();
    sidebar.setSidebarMode("files");
    sidebar.setIsSidebarVisible(true);
    void watchFolder(folder.rootPath);
  },
  createTreeItem: async (fileService, parentPath, kind, name) => {
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
  renameTreeItem: async (fileService, node, name) => {
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
        // 风格学习的样本与排除列表按相对路径记录，重命名后同步，失败不影响重命名本身。
        void syncStyleLearningRenameForTree(folder.rootPath, node.path, result.affectedPath);
        await recentFilesStore.move(node.path, {
          path: result.affectedPath,
          name: result.affectedPath.split("/").pop() || name,
        });
      }
    });
  },
  deleteTreeItem: async (fileService, node) => {
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
