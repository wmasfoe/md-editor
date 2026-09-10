import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export const FOLDER_CHANGED_EVENT = "md-editor-folder-changed";

export function listenToFolderChanged(handler: () => void): (() => void) | undefined {
  let unlisten: (() => void) | undefined;
  let disposed = false;

  if (!isTauri()) {
    return undefined;
  }

  void listen(FOLDER_CHANGED_EVENT, () => {
    handler();
  }).then((dispose) => {
    if (disposed) {
      dispose();
      return;
    }
    unlisten = dispose;
  });

  return () => {
    disposed = true;
    unlisten?.();
    unlisten = undefined;
  };
}
