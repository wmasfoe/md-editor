import { create } from "zustand";
import type { MarkdownFileTreeNode, MarkdownFolder } from "@md-editor/file-system";
import type { TreeItemKind } from "../../types";

export interface FileTreeStore {
  folder: MarkdownFolder | null;
  createTreeItem: (parentPath: string, kind: TreeItemKind, name: string) => Promise<void>;
  renameTreeItem: (node: MarkdownFileTreeNode, name: string) => Promise<void>;
  deleteTreeItem: (node: MarkdownFileTreeNode) => Promise<void>;
}

export const useFileTreeStore = create<FileTreeStore>(() => ({
  folder: null,
  createTreeItem: async () => {},
  renameTreeItem: async () => {},
  deleteTreeItem: async () => {},
}));
