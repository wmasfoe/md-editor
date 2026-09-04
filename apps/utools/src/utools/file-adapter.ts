// apps/utools/src/utools/file-adapter.ts
// uTools 文件系统接入层适配器
// 严格实现 @md-editor/file-system 的 FileServiceAdapter 与 NativeSaveAdapter 接口
// 仅依赖 preload 暴露的原生 Node.js 桥接能力，保持与核心领域模型解耦

import {
  createRuntimeFileService,
  type FileSaveSchedulerOptions,
  type FileServiceAdapter,
  type MarkdownDocumentFile,
  type NativeFileSaveJob,
  type NativeSaveAdapter,
  type NativeSaveRuntimeRegistration,
  type RuntimeFileService,
} from "@md-editor/file-system";
import type { InkpointNodeBridge } from "./types";

function getNodeBridge(): InkpointNodeBridge {
  if (typeof window !== "undefined" && window.inkpointNodeBridge) {
    return window.inkpointNodeBridge;
  }
  throw new Error("uTools 原生桥接环境未就绪（inkpointNodeBridge 不存在）");
}

/**
 * 创建针对 uTools 环境的文件服务适配器
 */
export function createUtoolsFileAdapter(): FileServiceAdapter {
  return {
    async openMarkdownFile(): Promise<MarkdownDocumentFile | null> {
      if (typeof window === "undefined" || typeof window.utools === "undefined") {
        return null;
      }
      const paths = window.utools.showOpenDialog({
        filters: [{ name: "Markdown", extensions: ["md", "markdown", "mdx", "txt"] }],
        properties: ["openFile"],
      });
      if (!paths || paths.length === 0) {
        return null;
      }
      const bridge = getNodeBridge();
      const filePath = paths[0];
      const markdown = bridge.readFile(filePath);
      return { filePath, markdown };
    },

    async readMarkdownFile(filePath: string): Promise<MarkdownDocumentFile> {
      const bridge = getNodeBridge();
      const markdown = bridge.readFile(filePath);
      return { filePath, markdown };
    },

    // 轻量模式下不开启复杂多级目录树扫描与文件树节点增删，保证极速启动与资源轻量
    async openMarkdownFolder() {
      return null;
    },
    async refreshMarkdownFolder() {
      throw new Error("uTools 插件轻量模式不支持文件夹大纲扫描");
    },
    async createMarkdownTreeItem() {
      throw new Error("uTools 插件轻量模式不支持文件树节点创建");
    },
    async renameMarkdownTreeItem() {
      throw new Error("uTools 插件轻量模式不支持文件树重命名");
    },
    async deleteMarkdownTreeItem() {
      throw new Error("uTools 插件轻量模式不支持文件树节点删除");
    },
  };
}

/**
 * 创建针对 uTools 环境的本地保存适配器（对接 NativeSaveScheduler）
 */
export function createUtoolsNativeSaveAdapter(): NativeSaveAdapter {
  return {
    async saveMarkdownJob(job: NativeFileSaveJob): Promise<unknown> {
      const bridge = getNodeBridge();
      let targetPath: string | null = null;

      if (job.destination.kind === "current-path") {
        targetPath = job.destination.path;
      } else if (job.destination.kind === "prompt") {
        if (typeof window !== "undefined" && typeof window.utools !== "undefined") {
          const defaultPath = job.destination.suggestedPath ?? "untitled.md";
          const chosen = window.utools.showSaveDialog({
            title: "保存 Markdown 文档",
            defaultPath,
            filters: [{ name: "Markdown", extensions: ["md", "markdown"] }],
            buttonLabel: "保存",
          });
          targetPath = chosen ?? null;
        }
      }

      // 用户取消了保存对话框
      if (!targetPath) {
        return {
          status: "not-committed",
          disposition: "cancelled",
          runtimeSequence: job.orderingToken.runtimeSequence,
          phase: "dialog",
        };
      }

      try {
        bridge.writeFile(targetPath, job.markdownLf);
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
