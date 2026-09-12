import { useEffect } from "react";
import type { CodeMirrorEditorPorts } from "@md-editor/editor-ui";
import { appendImageMarkdown, imageAltTextFromFileName } from "@md-editor/file-system";
import { webFileSystem } from "./web-file-system";

export interface UseImagePasteOptions {
  ports: CodeMirrorEditorPorts | null;
  currentMarkdown: string;
  onUpdateMarkdown: (nextMarkdown: string) => void;
  showToast: (message: string) => void;
}

/**
 * 监听全局图片剪贴板复制粘贴 (paste) 与文件拖拽 (drop) 事件。
 * - 已打开本地工作区时：自动保存为本地 ./assets/ 目录文件并插入相对路径；
 * - 纯临时草稿时：自动转为 Base64 Data URL 内联图片；
 * - 优先在当前光标或选区处插入，无光标时追加至末尾。
 */
export function useImagePaste({
  ports,
  currentMarkdown,
  onUpdateMarkdown,
  showToast,
}: UseImagePasteOptions) {
  useEffect(() => {
    const handleImageFile = async (file: File) => {
      try {
        showToast("正在处理图片...");
        const bytes = new Uint8Array(await file.arrayBuffer());
        const mimeType = file.type || "image/png";
        const altText = imageAltTextFromFileName(file.name);

        const { src, isLocalDisk } = await webFileSystem.saveAssetImage(bytes, mimeType, file.name);

        const imageTag = `![${altText}](${src})`;

        // 计算光标插入位置
        let nextMarkdown: string;
        const selection = ports?.getSelectionSnapshot();

        if (selection && selection.from >= 0 && selection.from <= currentMarkdown.length) {
          const from = selection.from;
          const to = selection.to;
          nextMarkdown = `${currentMarkdown.slice(0, from)}${imageTag}${currentMarkdown.slice(to)}`;
        } else {
          nextMarkdown = appendImageMarkdown(currentMarkdown, src, altText);
        }

        onUpdateMarkdown(nextMarkdown);
        showToast(isLocalDisk ? "图片已落盘至本地 assets/ 目录" : "图片已成功插入文档");
      } catch (err) {
        console.error("Failed to process image paste:", err);
        showToast("图片插入失败");
      }
    };

    const onPaste = (event: ClipboardEvent) => {
      const items = event.clipboardData?.items;
      if (!items) {
        return;
      }

      for (const item of Array.from(items)) {
        if (item.kind === "file" && item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) {
            event.preventDefault();
            event.stopPropagation();
            void handleImageFile(file);
            return;
          }
        }
      }
    };

    const onDragOver = (event: DragEvent) => {
      // 若拖拽的是图片文件，呈现放置指针
      if (event.dataTransfer?.types.includes("Files")) {
        event.preventDefault();
      }
    };

    const onDrop = (event: DragEvent) => {
      const files = event.dataTransfer?.files;
      if (!files || files.length === 0) {
        return;
      }

      for (const file of Array.from(files)) {
        if (file.type.startsWith("image/")) {
          event.preventDefault();
          event.stopPropagation();
          void handleImageFile(file);
          return;
        }
      }
    };

    window.addEventListener("paste", onPaste, true);
    window.addEventListener("dragover", onDragOver, false);
    window.addEventListener("drop", onDrop, false);

    return () => {
      window.removeEventListener("paste", onPaste, true);
      window.removeEventListener("dragover", onDragOver, false);
      window.removeEventListener("drop", onDrop, false);
    };
  }, [ports, currentMarkdown, onUpdateMarkdown, showToast]);
}
