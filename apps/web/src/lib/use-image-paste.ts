import { useEffect } from "react";
import type { CodeMirrorEditorPorts } from "@md-editor/editor";
import { imageAltTextFromFileName } from "@md-editor/file-system";
import { webFileSystem } from "./web-file-system";

export interface UseImagePasteOptions {
  ports: CodeMirrorEditorPorts | null;
  showToast: (message: string) => void;
}

/**
 * 监听全局图片剪贴板复制粘贴 (paste) 与文件拖拽 (drop) 事件。
 * - 已打开本地工作区时：自动保存为本地 ./assets/ 目录文件并插入相对路径；
 * - 纯临时草稿时：自动转为 Base64 Data URL 内联图片；
 * - 由编辑器在存储前捕获选区，存储完成后校验版本并插入图片。
 */
export function useImagePaste({ ports, showToast }: UseImagePasteOptions) {
  useEffect(() => {
    const handleImageFile = async (file: File) => {
      if (!ports) {
        showToast("编辑器尚未就绪，请稍后重新插入图片。");
        return;
      }
      const insertImage = ports.prepareImageInsertion();
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const mimeType = file.type || "image/png";
        const altText = imageAltTextFromFileName(file.name);

        const { src } = await webFileSystem.saveAssetImage(bytes, mimeType, file.name);

        const result = insertImage({ src, alt: altText });
        if (
          result.status !== "applied" &&
          result.status !== "noop" &&
          result.status !== "queued-composition"
        ) {
          showToast("文档已变化或编辑器暂不可用，请重新插入图片。");
        }
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
  }, [ports, showToast]);
}
