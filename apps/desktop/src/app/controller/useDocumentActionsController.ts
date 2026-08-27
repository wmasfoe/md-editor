import { useCallback, type Dispatch, type SetStateAction } from "react";
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
import type { OpenedAsset } from "../../types";
import { findFirstMarkdownPath } from "../files/file-tree-mutations";
import { runtime } from "../runtime/editor-runtime";
import { recentFilesStore } from "./recent-files-store";
import { shouldRefreshFolderAfterSave } from "./save-folder-refresh";
import { executeDocumentSave, getSaveFeedback, isDiscardProtectionRequired } from "./document-save";

interface UseDocumentActionsControllerOptions {
  readonly fileService: RuntimeFileService;
  readonly getRendererPorts: EditorUiActionsContextValue["getRendererPorts"];
  readonly refreshFolderForDocumentPath: (documentPath: string) => Promise<void>;
  readonly requestConfirmation: (confirmation: ConfirmationState) => Promise<ConfirmationChoice>;
  readonly runFileAction: RunFileAction;
  readonly setHasActiveDocument: Dispatch<SetStateAction<boolean>>;
  readonly setOpenedAsset: Dispatch<SetStateAction<OpenedAsset | null>>;
  readonly showOpenedFolder: (folder: MarkdownFolder) => void;
  readonly showToast: (message: string | null) => void;
}

let nextDesktopOperationSequence = 1;

function createDesktopOperationId(kind: "external-edit" | "mode"): string {
  const sequence = nextDesktopOperationSequence;
  nextDesktopOperationSequence += 1;
  return `desktop:${kind}:${sequence}`;
}

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
  const rememberRecentPath = useCallback(
    (filePath: string) => {
      const fileName = filePath.split("/").pop() || "Untitled";
      void recentFilesStore.add({ path: filePath, name: fileName }).catch((error: unknown) => {
        showToast(error instanceof Error ? error.message : "最近文件保存失败。");
      });
    },
    [showToast],
  );

  const rememberRecentDocument = useCallback(
    (document: MarkdownDocumentFile) => rememberRecentPath(document.filePath),
    [rememberRecentPath],
  );

  const applyProgrammaticMarkdown = useCallback(
    (markdown: string) => {
      const access = getRendererPorts();
      if (access.status !== "available") {
        showToast("编辑器尚未准备好，无法应用这次修改。");
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

      showToast(`编辑器未能应用修改：${result.status}。`);
    },
    [getRendererPorts, setHasActiveDocument, setOpenedAsset, showToast],
  );

  const switchMode = useCallback(
    async (mode: EditorMode) => {
      const access = getRendererPorts();
      if (access.status !== "available") {
        showToast("编辑器尚未准备好，无法切换模式。");
        return;
      }

      const result = switchEditorModeSafely(runtime.document, mode, {
        operationId: createDesktopOperationId("mode"),
        renderer: access.ports.mode,
        origin: { kind: "command", commandId: "view.toggleSource" },
      });
      showToast(result.ok ? null : result.message);
    },
    [getRendererPorts, showToast],
  );

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

  const startBlankDocument = useCallback(() => {
    runtime.document.replaceDocument(
      { markdown: "", savedMarkdown: "", filePath: null },
      { kind: "command", commandId: "file.new" },
    );
    showToast(null);
    setOpenedAsset(null);
    setHasActiveDocument(true);
  }, [setHasActiveDocument, setOpenedAsset, showToast]);

  const saveDocument = useCallback(
    async (forceDialog = false): Promise<boolean> => {
      let savedCurrentDocument = false;
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
    [fileService, refreshFolderForDocumentPath, rememberRecentPath, runFileAction, showToast],
  );

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
            ? "保存结果仍需确认"
            : "保存当前文档的更改？",
        description:
          description ??
          (current.persistenceStatus.kind === "verification-required"
            ? "上一次保存结果无法确认。请再次保存并确认成功，或明确放弃后再继续。"
            : "继续后将切换到其他文档。你可以先保存，或放弃尚未保存的更改。"),
        confirmLabel: "保存并继续",
        secondaryLabel: "不保存",
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

  const openRecentDocument = useCallback(async () => {
    const recentFiles = recentFilesStore.list();
    showToast(
      recentFiles.length === 0 ? "没有最近打开的文件" : "请从“最近文件”菜单中选择要打开的文件。",
    );
  }, [showToast]);

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
