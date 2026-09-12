// apps/utools/src/utools/types.ts
// uTools 适配层核心类型定义

import type { MarkdownFolder } from "@md-editor/file-system";

export interface SavedPastedImageResult {
  absolutePath: string;
  markdownPath: string;
}

/**
 * preload/index.js 中挂载到 window.inkpointNodeBridge 的原生能力契约
 */
export interface InkpointNodeBridge {
  readFile(filePath: string): string;
  writeFile(filePath: string, content: string): void;
  writeBinaryFile?(filePath: string, buffer: Uint8Array | ArrayBuffer): void;
  savePastedImage?(
    documentPath: string,
    mimeType: string,
    buffer: Uint8Array | ArrayBuffer,
    preferredName?: string,
  ): SavedPastedImageResult;
  resolveImageSrc?(documentPath: string, src: string, workspaceRoot?: string): string;
  exists(filePath: string): boolean;
  getDirname(filePath: string): string;
  getBasename(filePath: string): string;
  isDirectory(filePath: string): boolean;
  scanFolder(dirPath: string): MarkdownFolder;
  createTreeItem(parentPath: string, name: string, kind: "markdown" | "directory"): string;
  renameTreeItem(oldPath: string, newName: string): string;
  deleteTreeItem(targetPath: string): void;
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
