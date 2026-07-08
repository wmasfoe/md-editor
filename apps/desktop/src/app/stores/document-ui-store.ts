import { create } from "zustand";
import type { MarkdownFileTreeNode } from "@md-editor/file-system";
import type { RecentFile } from "@md-editor/editor-core";
import type { OpenedAsset } from "../../types";

export interface DocumentUiStore {
  hasActiveDocument: boolean;
  openedAsset: OpenedAsset | null;
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

// 桌面端桥接层：真实处理函数由 useDesktopEditorController 在主应用挂载时注入。
// 这里的默认实现只用于首帧渲染和隔离测试兜底，不承载业务逻辑。
export const useDocumentUiStore = create<DocumentUiStore>(() => ({
  hasActiveDocument: false,
  openedAsset: null,
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
