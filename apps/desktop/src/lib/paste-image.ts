import type { CodeMirrorEditorPorts } from "@md-editor/editor";
import {
  imageAltTextFromFileName,
  resolveAssetsDirectoryForDocument,
} from "@md-editor/file-system";
import { checkPathExists, createLocalAssetsImageStorageProvider } from "../desktop/file-adapter";
import type { ConfirmationChoice, ConfirmationState } from "@md-editor/app-ui";
import { runtime } from "../app/runtime/editor-runtime";
import type { PastedImageInput } from "../types";

const imageStorageProvider = createLocalAssetsImageStorageProvider();

export interface PasteImageRuntime {
  readonly ensureDocumentSaved: () => Promise<boolean>;
  readonly runFileAction: (label: string, action: () => Promise<void> | void) => Promise<void>;
  readonly prepareImageInsertion: CodeMirrorEditorPorts["prepareImageInsertion"];
  readonly afterSaveImage?: (documentPath: string) => Promise<void> | void;
  readonly assetsDirectory?: string;
  readonly requestConfirmation?: (state: ConfirmationState) => Promise<ConfirmationChoice>;
  readonly checkDirectoryExists?: (path: string) => Promise<boolean>;
  readonly storageProvider?: {
    save(input: {
      bytes: Uint8Array;
      mimeType: string;
      context: { documentPath: string; defaultAssetsDir: string; preferredName?: string };
    }): Promise<{ src: string; targetPath?: string }>;
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
    const generation = current.documentGeneration;

    // 图片资源依赖已保存 Markdown 的目录；未命名文档需要先另存为，后端才能计算稳定目录。
    if (!current.filePath) {
      if (!(await runtimeActions.ensureDocumentSaved())) {
        return;
      }
      current = runtime.document.getSnapshot();
      if (current.documentGeneration !== generation) return;
    }

    if (!current.filePath) {
      throw new Error("Save the document before pasting images.");
    }

    const insertImage = runtimeActions.prepareImageInsertion();
    const pattern = runtimeActions.assetsDirectory ?? "assets";
    const resolved = resolveAssetsDirectoryForDocument(current.filePath, pattern);
    const targetDir = resolved.assetsDirectory;

    const existsChecker = runtimeActions.checkDirectoryExists ?? checkPathExists;
    const exists = await existsChecker(targetDir);
    if (!exists) {
      if (runtimeActions.requestConfirmation) {
        const choice = await runtimeActions.requestConfirmation({
          title: "创建目录",
          description: `尝试将新插入的图片复制到目录 ${targetDir}。但该目录不存在，是否立即创建？`,
          confirmLabel: "立即创建",
        });
        if (choice !== "confirm") {
          return;
        }
      }
    }

    const provider = runtimeActions.storageProvider ?? imageStorageProvider;
    const savedImage = await provider.save({
      bytes: new Uint8Array(await image.file.arrayBuffer()),
      mimeType: image.mimeType,
      context: {
        documentPath: current.filePath,
        defaultAssetsDir: pattern,
        preferredName: image.preferredName,
      },
    });

    const result = insertImage({
      src: savedImage.src,
      alt: imageAltTextFromFileName(image.preferredName),
    });
    if (
      result.status !== "applied" &&
      result.status !== "noop" &&
      result.status !== "queued-composition"
    ) {
      throw new Error("文档已变化或编辑器暂不可用，请重新插入图片。");
    }
    await runtimeActions.afterSaveImage?.(current.filePath);
  });
}
