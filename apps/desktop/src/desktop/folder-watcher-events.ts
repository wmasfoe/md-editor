import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { safeUnlisten } from "./safe-unlisten";

export const FOLDER_CHANGED_EVENT = "md-editor-folder-changed";

export function listenToFolderChanged(handler: () => void): (() => void) | undefined {
  let unlisten: (() => void | Promise<void>) | undefined;
  let disposed = false;

  if (!isTauri()) {
    return undefined;
  }

  void listen(FOLDER_CHANGED_EVENT, () => {
    handler();
  })
    .then((dispose) => {
      if (disposed) {
        safeUnlisten(dispose);
        return;
      }
      unlisten = dispose;
    })
    .catch((err: unknown) => {
      console.debug("[tauri] listen to folder changed failed:", err);
    });

  return () => {
    disposed = true;
    const fn = unlisten;
    unlisten = undefined;
    safeUnlisten(fn);
  };
}
