/**
 * @file file-adapter.ts
 * @module apps/desktop/desktop/file-adapter
 * @description
 * Tauri 桌面端文件系统桥接适配器。
 *
 * 将前端文件树操作、Markdown 打开/读取、图片保存以及文件夹实时监听
 * 映射为底层的 Tauri IPC 命令调用（`invoke(...)`），实现与 Rust 后端 `file_commands` 的协议交互。
 */

import { invoke, isTauri } from "@tauri-apps/api/core";
import type {
  FileServiceAdapter,
  FileTreeMutationResult,
  ImageSaveInput,
  ImageStorageProvider,
  MarkdownDocumentFile,
  MarkdownFolder,
  NativeSaveAdapter,
} from "@md-editor/file-system";
import type { PastedImageFile } from "../types";

/**
 * 创建用于 Tauri 桌面端的文件系统操作适配器。
 *
 * @returns 符合 `@md-editor/file-system` 契约的 `FileServiceAdapter`
 */
export function createDesktopFileAdapter(): FileServiceAdapter {
  return {
    openMarkdownFile() {
      assertDesktopRuntime();
      return invoke<MarkdownDocumentFile | null>("open_markdown_document");
    },
    openMarkdownFolder() {
      assertDesktopRuntime();
      return invoke<MarkdownFolder | null>("open_markdown_folder");
    },
    readMarkdownFile(path) {
      assertDesktopRuntime();
      return invoke<MarkdownDocumentFile>("open_markdown_document_at_path", { path });
    },
    refreshMarkdownFolder(rootPath) {
      assertDesktopRuntime();
      return invoke<MarkdownFolder>("refresh_markdown_folder", { rootPath });
    },
    createMarkdownTreeItem(input) {
      assertDesktopRuntime();
      return invoke<FileTreeMutationResult>("create_markdown_tree_item", {
        rootPath: input.rootPath,
        parentPath: input.parentPath,
        name: input.name,
        kind: input.kind,
      });
    },
    renameMarkdownTreeItem(input) {
      assertDesktopRuntime();
      return invoke<FileTreeMutationResult>("rename_markdown_tree_item", {
        rootPath: input.rootPath,
        path: input.path,
        name: input.name,
      });
    },
    deleteMarkdownTreeItem(input) {
      assertDesktopRuntime();
      return invoke<FileTreeMutationResult>("delete_markdown_tree_item", {
        rootPath: input.rootPath,
        path: input.path,
      });
    },
  };
}

/**
 * 创建用于 Tauri 桌面端的保序原子写盘原生适配器。
 *
 * 将携带了 `NativeSaveOrderingToken` 的任务转发至 Rust 后端的 `save_markdown_document_ordered` 命令。
 */
export function createDesktopNativeSaveAdapter(): NativeSaveAdapter {
  return {
    saveMarkdownJob(job) {
      assertDesktopRuntime();
      return invoke("save_markdown_document_ordered", {
        orderingToken: job.orderingToken,
        markdownLf: job.markdownLf,
        destination: job.destination,
      });
    },
  };
}

/**
 * 保存剪贴板或拖拽的图片二进制字节到本地资产目录。
 *
 * @param input 图片保存上下文与原始字节
 * @returns 包含文件系统绝对路径与 Markdown 相对引用路径的结果对象
 */
export async function savePastedImage(input: ImageSaveInput): Promise<PastedImageFile> {
  assertDesktopRuntime();
  return invoke<PastedImageFile>("save_pasted_image", {
    documentPath: input.context.documentPath,
    defaultAssetsDir: input.context.defaultAssetsDir,
    preferredName: input.context.preferredName ?? null,
    mimeType: input.mimeType,
    bytes: Array.from(input.bytes),
  });
}

/**
 * 创建将图片存储在本地资产目录的提供者。
 */
export function createLocalAssetsImageStorageProvider(): ImageStorageProvider {
  return {
    async save(input) {
      const result = await savePastedImage(input);
      return {
        src: result.markdownPath,
        storageType: "local",
      };
    },
  };
}

/**
 * 检测指定绝对路径在操作系统文件系统中是否存在。
 *
 * @param path 待检查的文件或目录绝对路径
 */
export async function checkPathExists(path: string): Promise<boolean> {
  if (!isTauri()) {
    return true;
  }
  return invoke<boolean>("check_path_exists", { path });
}

/**
 * 启动对目标文件夹的底层文件系统变更监听（由 notify crate 支持）。
 *
 * @param path 目标工作空间根目录绝对路径
 */
export async function watchFolder(path: string): Promise<void> {
  if (!isTauri()) {
    return;
  }
  try {
    await invoke("watch_folder", { path });
  } catch (error) {
    console.warn("Failed to watch folder:", path, error);
  }
}

/**
 * 停止对当前监听文件夹的后台监控进程。
 */
export async function unwatchFolder(): Promise<void> {
  if (!isTauri()) {
    return;
  }
  try {
    await invoke("unwatch_folder");
  } catch (error) {
    console.warn("Failed to unwatch folder:", error);
  }
}

/**
 * 断言当前代码运行在 Tauri 桌面端环境中，若在普通浏览器则抛出明确异常。
 */
export function assertDesktopRuntime(): void {
  if (!isTauri()) {
    throw new Error("File operations are available in the Tauri desktop app.");
  }
}
