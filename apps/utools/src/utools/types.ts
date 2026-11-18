// apps/utools/src/utools/types.ts
// uTools 适配层核心类型定义

import type {
  MarkdownDocumentFile,
  MarkdownFileTreeNode,
  MarkdownFolder,
} from "@md-editor/file-system";

export interface GrantedDocument extends MarkdownDocumentFile {
  id: string;
}

export interface GrantedTreeNode extends MarkdownFileTreeNode {
  id: string;
  children?: GrantedTreeNode[];
}

export interface GrantedFolder extends MarkdownFolder {
  tree: GrantedTreeNode;
}

export interface PluginEntry {
  code: string;
  document?: GrantedDocument;
  folder?: GrantedFolder;
  text?: string;
  error?: string;
}

/** The preload accepts session IDs. Display paths stay in the UI. */
export interface InkpointNodeBridge {
  subscribeLifecycle(onEnter: (entry: PluginEntry) => void, onOut: () => void): () => void;
  pickDocument(): GrantedDocument | null;
  pickWorkspace(): GrantedFolder | null;
  openWorkspaceDocument(id: string): GrantedDocument;
  writeCurrentDocument(id: string, markdown: string): string;
  saveNewDocument(markdown: string): Pick<GrantedDocument, "filePath" | "id"> | null;
  closeDocument(): void;
  saveDocumentImage(id: string, mime: string, buffer: ArrayBuffer): { markdownPath: string };
  resolveDocumentImage(id: string | null, src: string): string;
  refreshWorkspace(): GrantedFolder;
  closeWorkspace(): void;
  createWorkspaceItem(parentId: string, name: string, kind: "markdown" | "directory"): string;
  renameWorkspaceItem(id: string, name: string): string;
  deleteWorkspaceItem(id: string): void;
}

declare global {
  interface Window {
    inkpointNodeBridge?: InkpointNodeBridge;
  }
}

/**
 * 插件运行模式
 * - file: 本地文件直接编辑（通过 preload 桥接进行原生读写）
 * - selection: 划词导入模式（从超级面板导入内容）
 */
export type EditorMode = "file" | "selection";

/**
 * 当前打开的文档元信息
 */
export interface ActiveDocumentInfo {
  mode: EditorMode;
  filePath: string | null;
  title: string;
}
