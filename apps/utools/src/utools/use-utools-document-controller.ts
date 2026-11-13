import {
  useCallback,
  useEffect,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import {
  executeDocumentSave,
  isDiscardProtectionRequired,
  type DocumentState,
} from "@md-editor/core";
import type { CodeMirrorEditorPorts } from "@md-editor/editor";
import { imageAltTextFromFileName, type MarkdownFolder } from "@md-editor/file-system";
import { clearLastOpenedFile, saveLastOpenedFile } from "./db-storage";
import type { EditorMode } from "./types";

export interface UseUtoolsDocumentControllerOptions {
  readonly docState: DocumentState;
  readonly markdown: string;
  readonly setMode: Dispatch<SetStateAction<EditorMode>>;
  readonly setFolder: Dispatch<SetStateAction<MarkdownFolder | null>>;
  readonly folderRef: MutableRefObject<MarkdownFolder | null>;
  readonly rendererPorts: CodeMirrorEditorPorts | null;
  readonly showToast: (msg: string | null) => void;
}

export function useUtoolsDocumentController({
  docState,
  markdown,
  setMode,
  setFolder,
  folderRef,
  rendererPorts,
  showToast,
}: UseUtoolsDocumentControllerOptions) {
  const saveDocument = useCallback(
    async (intent: "manual" | "automatic"): Promise<boolean> => {
      const bridge = window.inkpointNodeBridge;
      if (!bridge) {
        if (intent === "manual") showToast("当前环境不支持文件保存");
        return false;
      }
      // Autosave persists the published snapshot without committing an active table/IME edit.
      if (intent === "manual") rendererPorts?.flushPendingEdits();
      const execution = await executeDocumentSave(docState, (checkpoint) => {
        const destination = checkpoint.destination;
        const targetPath =
          destination.kind === "current-path"
            ? destination.path
            : window.utools?.showSaveDialog({
                title: "保存 Markdown 文档",
                defaultPath: destination.suggestedPath ?? "未命名.md",
                filters: [{ name: "Markdown", extensions: ["md", "markdown", "mdx"] }],
                buttonLabel: "保存",
              });
        if (!targetPath)
          return {
            status: "cancelled",
            commit: "not-committed",
            phase: "dialog",
            reason: "dialog-cancelled",
          };
        bridge.writeFile(targetPath, checkpoint.markdownLf);
        return { status: "succeeded", commit: "committed", filePath: targetPath, warnings: [] };
      });
      const { outcome, checkpoint } = execution;
      if (outcome.status === "failed" || outcome.status === "indeterminate") {
        if (intent === "manual") showToast(`保存失败或结果无法确认: ${outcome.errorCode}`);
        return false;
      }
      const latest = docState.getSnapshot();
      if (
        latest.documentGeneration !== checkpoint.documentGeneration ||
        isDiscardProtectionRequired(latest)
      )
        return false;
      if (outcome.status !== "succeeded") return false;
      saveLastOpenedFile(outcome.filePath);
      const activeFolder = folderRef.current;
      if (activeFolder && outcome.filePath.startsWith(activeFolder.rootPath)) {
        try {
          setFolder(bridge.scanFolder(activeFolder.rootPath));
        } catch (error) {
          // A tree refresh failure must not turn an already committed save into a failed write.
          console.warn("保存后刷新目录失败", error);
        }
      }
      return true;
    },
    [docState, folderRef, rendererPorts, setFolder, showToast],
  );

  const handleSaveDocument = useCallback(() => saveDocument("manual"), [saveDocument]);

  useEffect(() => {
    const timer = setTimeout(() => {
      const current = docState.getSnapshot();
      if (current.filePath && current.isDirty) void saveDocument("automatic");
    }, 600);
    return () => clearTimeout(timer);
  }, [docState, markdown, saveDocument]);

  const handleNewFile = useCallback(async () => {
    rendererPorts?.flushPendingEdits();
    const current = docState.getSnapshot();
    if (isDiscardProtectionRequired(current) && !(await handleSaveDocument())) return;
    // A save may have completed after another action already switched documents.
    if (docState.getSnapshot().documentGeneration !== current.documentGeneration) return;
    docState.replaceDocument(
      { markdown: "", savedMarkdown: "", filePath: null, mode: docState.getSnapshot().mode },
      { kind: "command", commandId: "file.new" },
    );
    clearLastOpenedFile();
    setMode("file");
  }, [docState, handleSaveDocument, rendererPorts, setMode]);

  const handleInsertImageFile = useCallback(
    async (file: File) => {
      if (!rendererPorts) {
        showToast("编辑器尚未就绪，请稍后重新插入图片。");
        return;
      }
      let current = docState.getSnapshot();
      const generation = current.documentGeneration;
      const altText = imageAltTextFromFileName(file.name) || "image";

      if (!current.filePath) {
        const saved = await handleSaveDocument();
        if (!saved) {
          showToast("请先保存文档再插入本地图片");
          return;
        }
        current = docState.getSnapshot();
        if (current.documentGeneration !== generation) return;
      }

      if (!current.filePath || !window.inkpointNodeBridge?.savePastedImage) {
        showToast("当前环境不支持保存本地图片");
        return;
      }

      const insertImage = rendererPorts.prepareImageInsertion({ layout: "block" });
      try {
        const buffer = await file.arrayBuffer();
        const res = window.inkpointNodeBridge.savePastedImage(
          current.filePath,
          file.type || "image/png",
          buffer,
          file.name,
        );

        const result = insertImage({ src: res.markdownPath, alt: altText });
        if (
          result.status !== "applied" &&
          result.status !== "noop" &&
          result.status !== "queued-composition"
        ) {
          showToast("文档已变化或编辑器暂不可用，请重新插入图片。");
        }
      } catch (err) {
        showToast(`插入图片失败: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [docState, handleSaveDocument, rendererPorts, showToast],
  );

  return {
    handleSaveDocument,
    handleNewFile,
    handleInsertImageFile,
  };
}
