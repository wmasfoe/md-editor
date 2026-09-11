/**
 * @file useDocumentActionsController.ts
 * @module apps/desktop/app/controller/useDocumentActionsController
 * @description
 * 桌面端文档生命周期动作控制器（Document Actions Controller）。
 *
 * 聚合并向 UI 层提供文档操作的高阶业务逻辑：
 * 1. 新建、打开、另存为、持久化原子保存（含落盘校验与保序）；
 * 2. 未保存内容防丢保护机制（Discard Protection Dialog）；
 * 3. WYSIWYG、分栏、纯源码等视图模式的安全平滑切换；
 * 4. 最近打开文件（Recent Files）记录维护与工作区侧边栏联动刷新。
 */

import { useCallback, useRef, type Dispatch, type SetStateAction } from "react";
import { switchEditorModeSafely, type EditorMode } from "@md-editor/editor-core";
import type {
  ConfirmationChoice,
  ConfirmationState,
  EditorUiActionsContextValue,
  RunFileAction,
} from "@md-editor/editor-ui";
import type {
  MarkdownDocumentFile,
  MarkdownFolder,
  RuntimeFileService,
} from "@md-editor/file-system";
import { t } from "@md-editor/i18n";
import type { OpenedAsset } from "../../types";
import { findFirstMarkdownPath } from "../files/file-tree-mutations";
import { runtime } from "../runtime/editor-runtime";
import { recentFilesStore } from "./recent-files-store";
import { shouldRefreshFolderAfterSave } from "./save-folder-refresh";
import { executeDocumentSave, getSaveFeedback, isDiscardProtectionRequired } from "./document-save";

/**
 * 文档动作控制器入参配置。
 */
interface UseDocumentActionsControllerOptions {
  /** 文件系统运行时服务 */
  readonly fileService: RuntimeFileService;
  /** 获取当前活跃渲染器（如 CodeMirror）端口句柄 */
  readonly getRendererPorts: EditorUiActionsContextValue["getRendererPorts"];
  /** 文档保存后触发工作区目录树定向刷新 */
  readonly refreshFolderForDocumentPath: (documentPath: string) => Promise<void>;
  /** 弹出未保存防丢二次确认弹窗 */
  readonly requestConfirmation: (confirmation: ConfirmationState) => Promise<ConfirmationChoice>;
  /** 包装长耗时文件操作（显示顶部加载状态等） */
  readonly runFileAction: RunFileAction;
  /** 更新当前是否有活跃文档状态 */
  readonly setHasActiveDocument: Dispatch<SetStateAction<boolean>>;
  /** 设置当前打开的非 Markdown 资产（如图片预览） */
  readonly setOpenedAsset: Dispatch<SetStateAction<OpenedAsset | null>>;
  /** 展示打开的整个文件夹工作空间 */
  readonly showOpenedFolder: (folder: MarkdownFolder) => void;
  /** 弹出轻提示 Toast */
  readonly showToast: (message: string | null) => void;
}

let nextDesktopOperationSequence = 1;

/**
 * 构造桌面端操作追踪序列号。
 */
function createDesktopOperationId(kind: "external-edit" | "mode"): string {
  const sequence = nextDesktopOperationSequence;
  nextDesktopOperationSequence += 1;
  return `desktop:${kind}:${sequence}`;
}

/**
 * 桌面端核心文档操作 Hook。
 */
export function useDocumentActionsController({
  fileService,
  getRendererPorts,
  refreshFolderForDocumentPath,
  requestConfirmation,
  runFileAction,
  setHasActiveDocument,
  setOpenedAsset,
  showOpenedFolder,
  showToast,
}: UseDocumentActionsControllerOptions) {
  /**
   * 记录最近打开的文件路径。
   */
  const rememberRecentPath = useCallback(
    (filePath: string) => {
      const fileName = filePath.split("/").pop() || "Untitled";
      void recentFilesStore.add({ path: filePath, name: fileName }).catch((error: unknown) => {
        showToast(error instanceof Error ? error.message : t("toasts.recentFilesFailed"));
      });
    },
    [showToast],
  );

  /**
   * 记录最近打开的 MarkdownDocument 对象。
   */
  const rememberRecentDocument = useCallback(
    (document: MarkdownDocumentFile) => rememberRecentPath(document.filePath),
    [rememberRecentPath],
  );

  /**
   * 以编程式事务方式将外部 Markdown 文本推送到编辑器中，并保持选区夹紧。
   */
  const applyProgrammaticMarkdown = useCallback(
    (markdown: string) => {
      const access = getRendererPorts();
      if (access.status !== "available") {
        showToast(t("toasts.editorNotReady"));
        return;
      }

      const current = runtime.document.getSnapshot();
      const result = access.ports.applyExternalEdit({
        operationId: createDesktopOperationId("external-edit"),
        markdown,
        expectedGeneration: current.documentGeneration,
        expectedContentRevision: current.contentRevision,
        selection: "preserve-offset-clamped",
      });

      if (
        result.status === "applied" ||
        result.status === "noop" ||
        result.status === "queued-composition"
      ) {
        setHasActiveDocument(true);
        setOpenedAsset(null);
        showToast(null);
        return;
      }

      showToast(t("toasts.editorApplyFailed", { status: result.status }));
    },
    [getRendererPorts, setHasActiveDocument, setOpenedAsset, showToast],
  );

  const isSwitchingModeRef = useRef(false);

  /**
   * 安全切换编辑模式（如 WYSIWYG <-> 源码），先刷出未完成的按键输入并防止重入。
   */
  const switchMode = useCallback(
    async (mode: EditorMode) => {
      if (isSwitchingModeRef.current) {
        return;
      }
      const access = getRendererPorts();
      if (access.status !== "available") {
        showToast(t("toasts.switchModeFailed"));
        return;
      }

      isSwitchingModeRef.current = true;
      try {
        access.ports.flushPendingEdits?.();

        const result = switchEditorModeSafely(runtime.document, mode, {
          operationId: createDesktopOperationId("mode"),
          renderer: access.ports.mode,
          origin: { kind: "command", commandId: "view.toggleSource" },
        });
        showToast(result.ok ? null : result.message);
      } finally {
        isSwitchingModeRef.current = false;
      }
    },
    [getRendererPorts, showToast],
  );

  /**
   * 全量替换当前文档模型（打开新文档时调用）。
   */
  const replaceDocument = useCallback(
    (document: MarkdownDocumentFile | null) => {
      if (!document) {
        return;
      }

      runtime.document.replaceDocument(
        {
          markdown: document.markdown,
          savedMarkdown: document.markdown,
          filePath: document.filePath,
        },
        { kind: "command", commandId: "file.open" },
      );
      showToast(null);
      setOpenedAsset(null);
      setHasActiveDocument(true);
      rememberRecentDocument(document);
    },
    [rememberRecentDocument, setHasActiveDocument, setOpenedAsset, showToast],
  );

  /**
   * 重置并初始化一个空白未命名的 Markdown 文档。
   */
  const startBlankDocument = useCallback(() => {
    runtime.document.replaceDocument(
      { markdown: "", savedMarkdown: "", filePath: null },
      { kind: "command", commandId: "file.new" },
    );
    showToast(null);
    setOpenedAsset(null);
    setHasActiveDocument(true);
  }, [setHasActiveDocument, setOpenedAsset, showToast]);

  /**
   * 执行当前文档的保存或另存为流水线。
   *
   * @param forceDialog 是否强制弹出“另存为”对话框（默认为 false）
   * @returns 是否成功完成保存且文档处于干净状态（clean/verified）
   */
  const saveDocument = useCallback(
    async (forceDialog = false): Promise<boolean> => {
      let savedCurrentDocument = false;
      const access = getRendererPorts();
      if (access.status === "available") {
        access.ports.flushPendingEdits?.();
      }
      await runFileAction(
        forceDialog ? "正在另存为" : "正在保存",
        async () => {
          const execution = await executeDocumentSave(runtime.document, fileService, forceDialog);
          const { checkpoint, outcome, previousPath, settlement } = execution;
          const feedback = getSaveFeedback(outcome, settlement);
          if (feedback) {
            showToast(feedback);
          }

          const latest = runtime.document.getSnapshot();
          savedCurrentDocument =
            latest.documentGeneration === checkpoint.documentGeneration &&
            latest.persistenceStatus.kind === "verified" &&
            !latest.isDirty;

          const authoritativePath = latest.filePath;
          if (
            authoritativePath &&
            (settlement.status === "applied" || settlement.status === "promoted")
          ) {
            rememberRecentPath(authoritativePath);
            if (
              shouldRefreshFolderAfterSave({
                previousPath,
                savedPath: authoritativePath,
              })
            ) {
              await refreshFolderForDocumentPath(authoritativePath);
            }
          }
        },
        { feedback: "quiet" },
      );
      return savedCurrentDocument;
    },
    [
      fileService,
      getRendererPorts,
      refreshFolderForDocumentPath,
      rememberRecentPath,
      runFileAction,
      showToast,
    ],
  );

  /**
   * 确保当前未保存的修改已得到妥善处理（引导保存、确认放弃、或取消操作）。
   *
   * @param description 弹窗提示的自定义描述
   * @returns 若允许继续关闭或切换文档返回 true；若用户点击取消则返回 false
   */
  const ensureDiscardAllowed = useCallback(
    async (description?: string) => {
      const current = runtime.document.getSnapshot();
      const requiresProtection = isDiscardProtectionRequired(current);
      if (!requiresProtection) {
        return true;
      }

      const choice = await requestConfirmation({
        title:
          current.persistenceStatus.kind === "verification-required"
            ? t("dialogs.saveUnconfirmedTitle")
            : t("dialogs.unsavedTitle"),
        description:
          description ??
          (current.persistenceStatus.kind === "verification-required"
            ? t("dialogs.saveUnconfirmedDesc")
            : t("dialogs.saveDiscardDesc")),
        confirmLabel: t("dialogs.saveAndContinue"),
        secondaryLabel: t("dialogs.dontSave"),
      });

      if (choice === "secondary") {
        return true;
      }
      if (choice !== "confirm") {
        return false;
      }

      await saveDocument(false);
      const latest = runtime.document.getSnapshot();
      return !latest.isDirty && latest.persistenceStatus.kind === "verified";
    },
    [requestConfirmation, saveDocument],
  );

  /**
   * 新建文档（附带未保存防丢保护）。
   */
  const createNewDocument = useCallback(async () => {
    if (!(await ensureDiscardAllowed())) {
      return;
    }

    const nextDocument = fileService.newDocument("");
    runtime.document.replaceDocument(
      {
        markdown: nextDocument.markdown,
        savedMarkdown: nextDocument.markdown,
        filePath: nextDocument.filePath,
      },
      { kind: "command", commandId: "file.new" },
    );
    showToast(null);
    setOpenedAsset(null);
    setHasActiveDocument(true);
  }, [ensureDiscardAllowed, fileService, setHasActiveDocument, setOpenedAsset, showToast]);

  /**
   * 弹出系统文件选择框打开 Markdown 文档。
   */
  const openDocument = useCallback(async () => {
    if (!(await ensureDiscardAllowed())) {
      return;
    }

    await runFileAction("正在打开", async () => {
      const document = await fileService.openDocument();
      replaceDocument(document);
      if (document) {
        await refreshFolderForDocumentPath(document.filePath);
      }
    });
  }, [
    ensureDiscardAllowed,
    fileService,
    refreshFolderForDocumentPath,
    replaceDocument,
    runFileAction,
  ]);

  /**
   * 打开指定路径的最近文件。
   */
  const openRecentFile = useCallback(
    async (filePath: string) => {
      if (!(await ensureDiscardAllowed())) {
        return;
      }

      await runFileAction("正在打开", async () => {
        try {
          const document = await fileService.openDocumentAtPath(filePath);
          replaceDocument(document);
          await refreshFolderForDocumentPath(document.filePath);
        } catch (error) {
          await recentFilesStore.remove(filePath);
          throw error;
        }
      });
    },
    [
      ensureDiscardAllowed,
      fileService,
      refreshFolderForDocumentPath,
      replaceDocument,
      runFileAction,
    ],
  );

  /**
   * 打开最近文档提示。
   */
  const openRecentDocument = useCallback(async () => {
    const recentFiles = recentFilesStore.list();
    showToast(
      recentFiles.length === 0 ? t("toasts.noRecentFiles") : t("toasts.chooseFromRecentMenu"),
    );
  }, [showToast]);

  /**
   * 打开工作空间根文件夹，并自动打开其中第一个 Markdown 文件。
   */
  const openFolder = useCallback(async () => {
    if (!(await ensureDiscardAllowed())) {
      return;
    }

    await runFileAction("正在打开文件夹", async () => {
      const openedFolder = await fileService.openFolder();
      if (!openedFolder) {
        return;
      }
      const firstMarkdownPath = findFirstMarkdownPath(openedFolder.tree);
      const firstDocument = firstMarkdownPath
        ? await fileService.openDocumentAtPath(firstMarkdownPath)
        : null;
      showOpenedFolder(openedFolder);
      if (firstDocument) {
        replaceDocument(firstDocument);
      } else {
        startBlankDocument();
      }
    });
  }, [
    ensureDiscardAllowed,
    fileService,
    replaceDocument,
    runFileAction,
    showOpenedFolder,
    startBlankDocument,
  ]);

  /**
   * 从侧边栏文件树中单击打开文档。
   */
  const openDocumentFromTree = useCallback(
    async (filePath: string) => {
      if (!(await ensureDiscardAllowed())) {
        return;
      }

      await runFileAction("正在打开", async () => {
        const document = await fileService.openDocumentAtPath(filePath);
        replaceDocument(document);
        await refreshFolderForDocumentPath(document.filePath);
      });
    },
    [
      ensureDiscardAllowed,
      fileService,
      refreshFolderForDocumentPath,
      replaceDocument,
      runFileAction,
    ],
  );

  return {
    applyProgrammaticMarkdown,
    switchMode,
    replaceDocument,
    saveDocument,
    ensureDiscardAllowed,
    createNewDocument,
    openDocument,
    openRecentFile,
    openRecentDocument,
    openFolder,
    openDocumentFromTree,
  };
}

export type DocumentActionsController = ReturnType<typeof useDocumentActionsController>;
