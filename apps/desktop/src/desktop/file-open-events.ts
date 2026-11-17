import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { safeUnlisten } from "./safe-unlisten";

export const FILE_OPEN_EVENT = "md-editor-file-open";

/** Connect OS open requests to the editor only after its document actions exist. */
export function listenToDesktopFileOpens(
  openFile: (path: string) => Promise<void>,
  onError: (error: unknown) => void,
): (() => void) | undefined {
  if (!isTauri()) return undefined;

  let disposed = false;
  let ready = false;
  let draining = false;
  let requested = false;
  let unlisten: (() => void) | undefined;

  const drain = async () => {
    requested = true;
    if (!ready || disposed || draining) return;
    draining = true;
    try {
      do {
        requested = false;
        while (true) {
          if (disposed) return;
          const path = await invoke<string | null>("take_pending_file_open");
          if (path === null || disposed) break;
          try {
            // Await the normal open action, including any unsaved-document dialog.
            // Multiple double clicks must not race to replace the active document.
            await openFile(path);
          } catch (error) {
            onError(error);
          }
        }
      } while (requested);
    } catch (error) {
      if (!disposed) onError(error);
    } finally {
      draining = false;
    }
  };

  // Subscribe before pulling the native queue: cold-start requests are retained
  // there, and requests arriving during registration cannot fall into a gap.
  void listen(FILE_OPEN_EVENT, () => void drain())
    .then((dispose) => {
      if (disposed) {
        safeUnlisten(dispose);
        return;
      }
      unlisten = dispose;
      ready = true;
      void drain();
    })
    .catch((error: unknown) => {
      if (!disposed) onError(error);
    });

  return () => {
    disposed = true;
    safeUnlisten(unlisten);
    unlisten = undefined;
  };
}
