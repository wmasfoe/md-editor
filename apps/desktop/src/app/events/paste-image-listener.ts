import { getPastedImage, pasteImageInput, type PasteImageRuntime } from "../../lib/paste-image";

export function bindPasteImageListener(runtimeActions: PasteImageRuntime) {
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
