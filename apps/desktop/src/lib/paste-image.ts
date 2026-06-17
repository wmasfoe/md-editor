import { appendImageMarkdown } from "@md-editor/file-system";
import type { MarkdownDocumentFile } from "@md-editor/file-system";
import { fileService } from "../desktop/file-service";
import { savePastedImage } from "../desktop/file-adapter";
import { runtime } from "../app/editor-runtime";
import type { PastedImageInput } from "../types";

export interface PasteImageRuntime {
  readonly replaceDocument: (document: MarkdownDocumentFile | null) => void;
  readonly runFileAction: (label: string, action: () => Promise<void> | void) => Promise<void>;
  readonly applyMarkdown: (markdown: string) => void;
  readonly afterSaveImage?: (documentPath: string) => Promise<void> | void;
}

export function getPastedImage(data: DataTransfer): PastedImageInput | null {
  for (const item of Array.from(data.items)) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file) {
        return {
          file,
          mimeType: item.type || file.type
        };
      }
    }
  }

  return null;
}

export async function pasteImageInput(image: PastedImageInput, runtimeActions: PasteImageRuntime) {
  await runtimeActions.runFileAction("正在粘贴图片", async () => {
    let current = runtime.document.getSnapshot();

    // Image assets live next to a saved Markdown file. Untitled documents must
    // be saved first so the backend can derive a stable assets/ directory.
    if (!current.filePath) {
      const saved = await fileService.saveDocumentAs({
        filePath: null,
        markdown: current.markdown
      });
      if (!saved) {
        return;
      }
      runtimeActions.replaceDocument(saved);
      current = runtime.document.getSnapshot();
    }

    if (!current.filePath) {
      throw new Error("Save the document before pasting images.");
    }

    const pasted = await savePastedImage(current.filePath, image);
    const nextMarkdown = appendImageMarkdown(current.markdown, pasted.markdownPath);

    // The asset is already on disk, but the Markdown reference is still an
    // unsaved document edit. Keep dirty state until the user saves the note.
    runtimeActions.applyMarkdown(nextMarkdown);
    await runtimeActions.afterSaveImage?.(current.filePath);
  });
}
