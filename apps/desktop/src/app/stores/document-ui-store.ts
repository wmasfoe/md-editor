import { create } from "zustand";
import { invoke, isTauri } from "@tauri-apps/api/core";
import type { MarkdownFileTreeNode, RecentFile } from "@md-editor/file-system";
import type { PendingDraftInfo } from "../controller/session-controller";
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
  isMdxComponentMenuOpen: boolean;
  isInsertTableDialogOpen: boolean;
  isHistoryDrawerOpen: boolean;
  pendingDraft: PendingDraftInfo | null;
  setHasActiveDocument: StoreStateSetter<boolean>;
  setOpenedAsset: StoreStateSetter<OpenedAsset | null>;
  openMdxComponentMenu: () => void;
  closeMdxComponentMenu: () => void;
  openInsertTableDialog: () => void;
  closeInsertTableDialog: () => void;
  openHistoryDrawer: () => void;
  closeHistoryDrawer: () => void;
  setPendingDraft: (draft: PendingDraftInfo | null) => void;
  resolveImageSrc: (src: string) => string;
  openAssetPath: (path: string, name?: string) => void;
  closeAssetPreview: () => void;
  openAssetFromTree: (node: MarkdownFileTreeNode) => void;
  getRecentFiles: () => readonly RecentFile[];
}

export const useDocumentUiStore = create<DocumentUiStore>((set, get) => ({
  hasActiveDocument: false,
  openedAsset: null,
  isMdxComponentMenuOpen: false,
  isInsertTableDialogOpen: false,
  isHistoryDrawerOpen: false,
  pendingDraft: null,
  setHasActiveDocument: (value) =>
    set((state) => ({
      hasActiveDocument: typeof value === "function" ? value(state.hasActiveDocument) : value,
    })),
  setOpenedAsset: (value) =>
    set((state) => ({
      openedAsset: typeof value === "function" ? value(state.openedAsset) : value,
    })),
  openMdxComponentMenu: () => {
    set({ isMdxComponentMenuOpen: true });
  },
  closeMdxComponentMenu: () => {
    set({ isMdxComponentMenuOpen: false });
  },
  openInsertTableDialog: () => {
    set({ isInsertTableDialogOpen: true });
  },
  closeInsertTableDialog: () => {
    set({ isInsertTableDialogOpen: false });
  },
  openHistoryDrawer: () => {
    set({ isHistoryDrawerOpen: true });
  },
  closeHistoryDrawer: () => {
    set({ isHistoryDrawerOpen: false });
  },
  setPendingDraft: (draft) => {
    set({ pendingDraft: draft });
  },
  resolveImageSrc: (src) => resolvePreviewImageSrc(runtime.document.getSnapshot().filePath, src),
  openAssetPath: (path, name = basename(path)) => {
    useToastStore.getState().showToast(null);
    if (isTauri()) {
      void invoke("allow_asset_path", { path }).catch(() => {});
    }
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
