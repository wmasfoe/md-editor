// apps/utools/src/utools/types.ts
// uTools 适配层核心类型定义

/**
 * preload/index.cjs 中挂载到 window.inkpointNodeBridge 的原生能力契约
 */
export interface InkpointNodeBridge {
  readFile(filePath: string): string;
  writeFile(filePath: string, content: string): void;
  exists(filePath: string): boolean;
  getDirname(filePath: string): string;
  getBasename(filePath: string): string;
}

declare global {
  interface Window {
    inkpointNodeBridge?: InkpointNodeBridge;
  }
}

/**
 * 插件运行模式
 * - scratchpad: 快速便签（数据存储在 utools.db，支持多设备漫游）
 * - file: 本地文件直接编辑（通过 preload 桥接进行原生读写）
 * - selection: 划词导入模式（从超级面板导入内容）
 */
export type EditorMode = "scratchpad" | "file" | "selection";

/**
 * 当前打开的文档元信息
 */
export interface ActiveDocumentInfo {
  mode: EditorMode;
  filePath: string | null;
  title: string;
}
