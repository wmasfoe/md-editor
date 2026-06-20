import { getDroppedImage, pasteImageInput, type PasteImageRuntime } from "../../lib/paste-image";

export function bindDropImageListener(runtimeActions: PasteImageRuntime) {
  const handleDragOver = (event: DragEvent) => {
    if (!event.dataTransfer || !hasImageFile(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  };

  const handleDrop = (event: DragEvent) => {
    if (!event.dataTransfer) {
      return;
    }

    const image = getDroppedImage(event.dataTransfer);
    if (!image) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    void pasteImageInput(image, runtimeActions, "正在导入图片");
  };

  window.addEventListener("dragover", handleDragOver, true);
  window.addEventListener("drop", handleDrop, true);

  return () => {
    window.removeEventListener("dragover", handleDragOver, true);
    window.removeEventListener("drop", handleDrop, true);
  };
}

function hasImageFile(data: DataTransfer): boolean {
  return Array.from(data.items).some((item) => item.kind === "file" && item.type.startsWith("image/"));
}
