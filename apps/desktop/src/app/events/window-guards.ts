import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { runtime } from "../runtime/editor-runtime";

function preventDirtyDocumentUnload(event: BeforeUnloadEvent) {
  if (!runtime.document.getSnapshot().isDirty) {
    return;
  }

  event.preventDefault();
  event.returnValue = "";
}

export function bindBrowserDirtyDocumentGuard() {
  window.addEventListener("beforeunload", preventDirtyDocumentUnload);
  return () => window.removeEventListener("beforeunload", preventDirtyDocumentUnload);
}

export function bindTauriCloseGuard(confirmClose: () => Promise<boolean>) {
  let unlisten: (() => void) | undefined;

  if (!isTauri()) {
    return undefined;
  }

  void getCurrentWindow()
    .onCloseRequested((event) => {
      if (!runtime.document.getSnapshot().isDirty) {
        return;
      }

      // Native close events must be cancelled synchronously. Resume with a
      // direct destroy only after the app-level dialog resolves.
      event.preventDefault();
      void confirmClose().then((allowed) => {
        if (allowed) {
          void getCurrentWindow().destroy();
        }
      });
    })
    .then((dispose) => {
      unlisten = dispose;
    });

  return () => {
    unlisten?.();
  };
}
