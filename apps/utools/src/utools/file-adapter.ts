// apps/utools/src/utools/file-adapter.ts
// uTools 文件系统接入层适配器
// 严格实现 @md-editor/file-system 的 FileServiceAdapter 与 NativeSaveAdapter 接口
// 仅依赖 preload 暴露的原生 Node.js 桥接能力，保持与核心领域模型解耦

import {
  createRuntimeFileService,
  type CreateTreeItemInput,
  type DeleteTreeItemInput,
  type FileSaveSchedulerOptions,
  type FileServiceAdapter,
  type FileTreeMutationResult,
  type MarkdownDocumentFile,
  type MarkdownFolder,
  type NativeFileSaveJob,
  type NativeSaveAdapter,
  type NativeSaveRuntimeRegistration,
  type RenameTreeItemInput,
  type RuntimeFileService,
} from "@md-editor/file-system";
import { fileAccess } from "./file-access";

/**
 * 创建针对 uTools 环境的文件服务适配器
 */
export function createUtoolsFileAdapter(): FileServiceAdapter {
  return {
    async openMarkdownFile(): Promise<MarkdownDocumentFile | null> {
      return fileAccess.pickDocument();
    },

    async readMarkdownFile(filePath: string): Promise<MarkdownDocumentFile> {
      return fileAccess.openWorkspaceDocument(filePath);
    },

    async openMarkdownFolder(): Promise<MarkdownFolder | null> {
      return fileAccess.pickWorkspace();
    },

    async refreshMarkdownFolder(rootPath: string): Promise<MarkdownFolder> {
      return fileAccess.refreshWorkspace(rootPath);
    },

    async createMarkdownTreeItem(input: CreateTreeItemInput): Promise<FileTreeMutationResult> {
      const affectedPath = fileAccess.createTreeItem(input.parentPath, input.name, input.kind);
      const folder = fileAccess.refreshWorkspace(input.rootPath);
      return { folder, affectedPath };
    },

    async renameMarkdownTreeItem(input: RenameTreeItemInput): Promise<FileTreeMutationResult> {
      const affectedPath = fileAccess.renameTreeItem(input.path, input.name);
      const folder = fileAccess.refreshWorkspace(input.rootPath);
      return { folder, affectedPath };
    },

    async deleteMarkdownTreeItem(input: DeleteTreeItemInput): Promise<FileTreeMutationResult> {
      fileAccess.deleteTreeItem(input.path);
      const folder = fileAccess.refreshWorkspace(input.rootPath);
      return { folder, affectedPath: null };
    },
  };
}

/**
 * 创建针对 uTools 环境的本地保存适配器（对接 NativeSaveScheduler）
 */
export function createUtoolsNativeSaveAdapter(): NativeSaveAdapter {
  return {
    async saveMarkdownJob(job: NativeFileSaveJob): Promise<unknown> {
      try {
        const targetPath = fileAccess.saveMarkdown(
          job.destination.kind === "current-path" ? job.destination.path : null,
          job.markdownLf,
        );
        if (!targetPath) {
          return {
            status: "not-committed",
            disposition: "cancelled",
            runtimeSequence: job.orderingToken.runtimeSequence,
            phase: "dialog",
          };
        }
        return {
          status: "committed",
          runtimeSequence: job.orderingToken.runtimeSequence,
          filePath: targetPath,
          warnings: [],
        };
      } catch (err) {
        return {
          status: "not-committed",
          disposition: "failed",
          runtimeSequence: job.orderingToken.runtimeSequence,
          phase: "temp-write",
          errorCode: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}

/**
 * 组装生成全生命周期的 uTools RuntimeFileService
 */
export function createUtoolsRuntimeFileService(
  registration: NativeSaveRuntimeRegistration,
  options?: FileSaveSchedulerOptions,
): RuntimeFileService {
  return createRuntimeFileService(
    createUtoolsFileAdapter(),
    createUtoolsNativeSaveAdapter(),
    registration,
    options,
  );
}
