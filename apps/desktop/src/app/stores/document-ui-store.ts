import { create } from "zustand";
import type { MarkdownFileTreeNode } from "@md-editor/file-system";
import type { RecentFile } from "@md-editor/editor-core";
import type { OpenedAsset } from "../../types";

export interface DocumentUiStore {
  hasActiveDocument: boolean;
  openedAsset: OpenedAsset | null;
  documentKey: string;
  resolveImageSrc: (src: string) => string;
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

export const useDocumentUiStore = create<DocumentUiStore>(() => ({
  hasActiveDocument: false,
  openedAsset: null,
  documentKey: "untitled:0",
  resolveImageSrc: (src) => src,
  closeAssetPreview: () => {},
  openAssetFromTree: () => {},
  getRecentFiles: () => [],
  openRecentFile: async () => {},
  runEditorUpdateAction: async () => {},
  commitMarkdown: () => {},
  openWysiwygLink: async () => {},
  dispatchCommand: async () => {},
  openDocumentFromTree: async () => {},
}));
