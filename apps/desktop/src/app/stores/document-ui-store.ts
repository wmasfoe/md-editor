import { create } from "zustand";
import type { MarkdownFileTreeNode } from "@md-editor/file-system";
import type { RecentFile } from "@md-editor/editor-core";
import type { OpenedAsset } from "../../types";
import { basename } from "../../lib/link-target";
import { resolvePreviewImageSrc } from "../../lib/markdown-preview";
import { runtime } from "../runtime/editor-runtime";
import { recentFilesStore } from "../controller/recent-files-store";
import { useToastStore } from "./toast-store";

type StoreStateSetter<T> = (value: T | ((prev: T) => T)) => void;

export interface DocumentUiStore {
  hasActiveDocument: boolean;
  openedAsset: OpenedAsset | null;
  setHasActiveDocument: StoreStateSetter<boolean>;
  setOpenedAsset: StoreStateSetter<OpenedAsset | null>;
  resolveImageSrc: (src: string) => string;
  openAssetPath: (path: string, name?: string) => void;
  closeAssetPreview: () => void;
  openAssetFromTree: (node: MarkdownFileTreeNode) => void;
  getRecentFiles: () => readonly RecentFile[];
}

export const useDocumentUiStore = create<DocumentUiStore>((set, get) => ({
  hasActiveDocument: false,
  openedAsset: null,
  setHasActiveDocument: (value) =>
    set((state) => ({
      hasActiveDocument: typeof value === "function" ? value(state.hasActiveDocument) : value,
    })),
  setOpenedAsset: (value) =>
    set((state) => ({
      openedAsset: typeof value === "function" ? value(state.openedAsset) : value,
    })),
  resolveImageSrc: (src) => resolvePreviewImageSrc(runtime.document.getSnapshot().filePath, src),
  openAssetPath: (path, name = basename(path)) => {
    useToastStore.getState().showToast(null);
    set({ openedAsset: { name, path } });
  },
  closeAssetPreview: () => {
    set({ openedAsset: null });
  },
  openAssetFromTree: (node) => {
    get().openAssetPath(node.path, node.name);
  },
  getRecentFiles: () => recentFilesStore.list(),
}));
