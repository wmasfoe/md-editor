import {
  useCallback,
  useEffect,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type { DocumentState } from "@md-editor/core";
import type { CodeMirrorEditorPorts } from "@md-editor/editor";
import {
  appendImageMarkdown,
  imageAltTextFromFileName,
  type MarkdownFolder,
} from "@md-editor/file-system";
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
  const handleSaveDocument = useCallback(async (): Promise<boolean> => {
    const current = docState.getSnapshot();
    let targetPath = current.filePath;

    if (!targetPath) {
      if (typeof window === "undefined" || !window.utools) {
        showToast("当前环境不支持文件保存窗口");
        return false;
      }
      const chosen = window.utools.showSaveDialog({
        title: "保存 Markdown 文档",
        defaultPath: "未命名.md",
        filters: [{ name: "Markdown", extensions: ["md", "markdown", "mdx"] }],
        buttonLabel: "保存",
      });
      if (!chosen) {
        return false;
      }
      targetPath = chosen;
    }

    if (window.inkpointNodeBridge) {
      const destination = current.filePath
        ? ({ kind: "current-path" as const, path: current.filePath } as const)
        : ({ kind: "prompt" as const, suggestedPath: targetPath } as const);
      const checkpoint = docState.beginSave(destination);

      try {
        window.inkpointNodeBridge.writeFile(targetPath, checkpoint.markdownLf);
        docState.settleSave(checkpoint, {
          status: "succeeded",
          commit: "committed",
          filePath: targetPath,
          warnings: [],
        });
        saveLastOpenedFile(targetPath);

        const activeFolder = folderRef.current;
        if (activeFolder && targetPath.startsWith(activeFolder.rootPath)) {
          try {
            const updated = window.inkpointNodeBridge.scanFolder(activeFolder.rootPath);
            setFolder(updated);
          } catch {
            // 忽略
          }
        }

        return true;
      } catch (err) {
        docState.settleSave(checkpoint, {
          status: "failed",
          commit: "not-committed",
          phase: "temp-write",
          errorCode: err instanceof Error ? err.message : String(err),
        });
        showToast(`保存失败: ${err instanceof Error ? err.message : String(err)}`);
        return false;
      }
    }
    return false;
  }, [docState, folderRef, setFolder, showToast]);

  useEffect(() => {
    const timer = setTimeout(() => {
      const current = docState.getSnapshot();
      if (current.filePath && current.isDirty && window.inkpointNodeBridge) {
        const checkpoint = docState.beginSave({
          kind: "current-path",
          path: current.filePath,
        });
        try {
          window.inkpointNodeBridge.writeFile(current.filePath, checkpoint.markdownLf);
          docState.settleSave(checkpoint, {
            status: "succeeded",
            commit: "committed",
            filePath: current.filePath,
            warnings: [],
          });
        } catch (err) {
          docState.settleSave(checkpoint, {
            status: "failed",
            commit: "not-committed",
            phase: "temp-write",
            errorCode: err instanceof Error ? err.message : String(err),
          });
          console.error("自动保存文件失败:", err);
        }
      }
    }, 600);

    return () => clearTimeout(timer);
  }, [docState, markdown]);

  const handleNewFile = useCallback(() => {
    const current = docState.getSnapshot();
    if (current.filePath && current.isDirty && window.inkpointNodeBridge) {
      try {
        window.inkpointNodeBridge.writeFile(current.filePath, current.markdown);
      } catch {
        // 忽略
      }
    }
    docState.replaceDocument(
      {
        markdown: "",
        savedMarkdown: "",
        filePath: null,
        mode: docState.getSnapshot().mode,
      },
      { kind: "command", commandId: "file.new" },
    );
    clearLastOpenedFile();
    setMode("file");
  }, [docState, setMode]);

  const handleInsertImageFile = useCallback(
    async (file: File) => {
      let current = docState.getSnapshot();
      const altText = imageAltTextFromFileName(file.name) || "image";

      if (!current.filePath) {
        const saved = await handleSaveDocument();
        if (!saved) {
          showToast("请先保存文档再插入本地图片");
          return;
        }
        current = docState.getSnapshot();
      }

      if (!current.filePath || !window.inkpointNodeBridge?.savePastedImage) {
        showToast("当前环境不支持保存本地图片");
        return;
      }

      try {
        const buffer = await file.arrayBuffer();
        const res = window.inkpointNodeBridge.savePastedImage(
          current.filePath,
          file.type || "image/png",
          buffer,
          file.name,
        );

        const targetSrc = res.markdownPath;
        const cursorPos = rendererPorts?.getSelectionSnapshot().head;
        const tag = `![${altText}](${targetSrc})`;
        let nextMarkdown: string;
        let nextCursorPos: number;
        if (
          cursorPos !== undefined &&
          cursorPos !== null &&
          cursorPos >= 0 &&
          cursorPos <= current.markdown.length
        ) {
          const before = current.markdown.slice(0, cursorPos);
          const after = current.markdown.slice(cursorPos);
          const needsPrefixNewline = before.length > 0 && !before.endsWith("\n");
          const needsSuffixNewline = after.length > 0 && !after.startsWith("\n");
          const insertedText = `${needsPrefixNewline ? "\n\n" : ""}${tag}${needsSuffixNewline ? "\n\n" : ""}`;
          nextMarkdown = `${before}${insertedText}${after}`;
          nextCursorPos = before.length + insertedText.length;
        } else {
          nextMarkdown = appendImageMarkdown(current.markdown, targetSrc, altText);
          nextCursorPos = nextMarkdown.length;
        }

        if (rendererPorts) {
          const editResult = rendererPorts.applyExternalEdit({
            operationId: `utools:insert-image:${Date.now()}`,
            markdown: nextMarkdown,
            expectedGeneration: current.documentGeneration,
            expectedContentRevision: current.contentRevision,
            selection: "preserve-offset-clamped",
          });

          if (
            editResult.status === "applied" ||
            editResult.status === "noop" ||
            editResult.status === "queued-composition"
          ) {
            rendererPorts.setSelection(nextCursorPos, nextCursorPos);
            rendererPorts.focus();
          } else {
            docState.replaceDocument(
              {
                markdown: nextMarkdown,
                savedMarkdown: current.savedMarkdown,
                filePath: current.filePath,
                mode: current.mode,
                replaceIntent: "same",
              },
              { kind: "command", commandId: "utools.insertImageFallback" },
            );
          }
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
