import {
  appendImageMarkdown,
  defaultAssetsDirectoryForDocument,
  imageAltTextFromFileName,
} from "@md-editor/file-system";
import { createLocalAssetsImageStorageProvider } from "../desktop/file-adapter";
import { runtime } from "../app/runtime/editor-runtime";
import type { PastedImageInput } from "../types";

const imageStorageProvider = createLocalAssetsImageStorageProvider();

export interface PasteImageRuntime {
  readonly ensureDocumentSaved: () => Promise<boolean>;
  readonly runFileAction: (label: string, action: () => Promise<void> | void) => Promise<void>;
  readonly applyMarkdown: (markdown: string) => void;
  readonly getCursorPosition?: () => number | null;
  readonly afterSaveImage?: (documentPath: string) => Promise<void> | void;
  readonly assetsDirectory?: string;
  readonly storageProvider?: {
    save(input: {
      bytes: Uint8Array;
      mimeType: string;
      context: { documentPath: string; defaultAssetsDir: string; preferredName?: string };
    }): Promise<{ src: string; targetPath: string }>;
  };
}

export function getPastedImage(data: DataTransfer): PastedImageInput | null {
  for (const item of Array.from(data.items)) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file) {
        return {
          file,
          mimeType: item.type || file.type,
          preferredName: file.name,
        };
      }
    }
  }

  return null;
}

export function getDroppedImage(data: DataTransfer): PastedImageInput | null {
  for (const file of Array.from(data.files)) {
    if (file.type.startsWith("image/")) {
      return {
        file,
        mimeType: file.type,
        preferredName: file.name,
      };
    }
  }

  return null;
}

export async function pasteImageInput(
  image: PastedImageInput,
  runtimeActions: PasteImageRuntime,
  label = "正在粘贴图片",
) {
  await runtimeActions.runFileAction(label, async () => {
    let current = runtime.document.getSnapshot();

    // 图片资源依赖已保存 Markdown 的目录；未命名文档需要先另存为，后端才能计算稳定目录。
    if (!current.filePath) {
      if (!(await runtimeActions.ensureDocumentSaved())) {
        return;
      }
      current = runtime.document.getSnapshot();
    }

    if (!current.filePath) {
      throw new Error("Save the document before pasting images.");
    }

    const provider = runtimeActions.storageProvider ?? imageStorageProvider;
    const savedImage = await provider.save({
      bytes: new Uint8Array(await image.file.arrayBuffer()),
      mimeType: image.mimeType,
      context: {
        documentPath: current.filePath,
        defaultAssetsDir:
          runtimeActions.assetsDirectory ?? defaultAssetsDirectoryForDocument(current.filePath),
        preferredName: image.preferredName,
      },
    });

    const altText = imageAltTextFromFileName(image.preferredName);
    const imageTag = `![${altText}](${savedImage.src})`;
    const cursorPos = runtimeActions.getCursorPosition?.();

    let nextMarkdown: string;
    if (
      cursorPos !== undefined &&
      cursorPos !== null &&
      cursorPos >= 0 &&
      cursorPos <= current.markdown.length
    ) {
      const before = current.markdown.slice(0, cursorPos);
      const after = current.markdown.slice(cursorPos);
      nextMarkdown = `${before}${imageTag}${after}`;
    } else {
      nextMarkdown = appendImageMarkdown(current.markdown, savedImage.src, altText);
    }

    // 图片文件已经落盘，但 Markdown 引用仍是未保存编辑；保持 dirty 状态直到用户保存文档。
    runtimeActions.applyMarkdown(nextMarkdown);
    await runtimeActions.afterSaveImage?.(current.filePath);
  });
}
