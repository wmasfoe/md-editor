import type { MarkdownDocumentFile } from "@md-editor/file-system";
import { getPastedImage, pasteImageInput } from "../../lib/paste-image";

export interface PasteImageListenerRuntime {
  readonly replaceDocument: (document: MarkdownDocumentFile | null) => void;
  readonly runFileAction: (label: string, action: () => Promise<void> | void) => Promise<void>;
  readonly applyMarkdown: (markdown: string) => void;
  readonly afterSaveImage?: (documentPath: string) => Promise<void> | void;
}

export function bindPasteImageListener(runtimeActions: PasteImageListenerRuntime) {
  const listener = (event: ClipboardEvent) => {
    if (!event.clipboardData) {
      return;
    }

    const image = getPastedImage(event.clipboardData);
    if (!image) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    void pasteImageInput(image, runtimeActions);
  };

  window.addEventListener("paste", listener, true);
  return () => window.removeEventListener("paste", listener, true);
}
