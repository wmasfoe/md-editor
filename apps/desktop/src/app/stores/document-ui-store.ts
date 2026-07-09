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
  openRecentFile: (path: string) => Promise<void>;
  runEditorUpdateAction: () => Promise<void>;
  commitMarkdown: (markdown: string) => void;
  openWysiwygLink: (href: string) => Promise<void>;
  dispatchCommand: (id: string) => Promise<void>;
  openDocumentFromTree: (filePath: string) => Promise<void>;
}

// 少数动作依赖 React provider 或设置上下文，只在对应 bridge 挂载后替换。
// 默认实现保留在 store 里，避免首帧/测试环境因为调用顺序直接崩溃。
function createMissingBridgeAction(name: string): () => Promise<void> {
  return async () => {
    console.warn(`${name} bridge is not mounted yet.`);
  };
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
  openRecentFile: createMissingBridgeAction("openRecentFile"),
  runEditorUpdateAction: createMissingBridgeAction("runEditorUpdateAction"),
  // commitMarkdown 是稳定的 desktop 行为，直接落在 store，避免再通过 controller 注入。
  commitMarkdown: (markdown) => {
    runtime.document.updateMarkdown(markdown);
    set({ hasActiveDocument: true, openedAsset: null });
    useToastStore.getState().showToast(null);
  },
  openWysiwygLink: createMissingBridgeAction("openWysiwygLink"),
  dispatchCommand: createMissingBridgeAction("dispatchCommand"),
  openDocumentFromTree: createMissingBridgeAction("openDocumentFromTree"),
}));
