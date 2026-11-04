import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { safeUnlisten } from "./safe-unlisten";

export const MENU_ACTION_EVENT = "md-editor-menu-action";

function listenToDesktopEvent<T>(
  eventName: string,
  handler: (payload: T) => void,
): (() => void) | undefined {
  let unlisten: (() => void | Promise<void>) | undefined;
  let disposed = false;

  if (!isTauri()) {
    return undefined;
  }

  // Tauri resolves listener registration asynchronously. Keep a stable cleanup
  // closure so React can unmount safely even if registration finishes later.
  void listen<T>(eventName, (event) => {
    handler(event.payload);
  })
    .then((dispose) => {
      if (disposed) {
        safeUnlisten(dispose);
        return;
      }
      unlisten = dispose;
    })
    .catch((err: unknown) => {
      console.debug(`[tauri] listen to event ${eventName} failed:`, err);
    });

  return () => {
    disposed = true;
    const fn = unlisten;
    unlisten = undefined;
    safeUnlisten(fn);
  };
}

export function listenToDesktopMenuActions(
  handler: (action: string) => void,
): (() => void) | undefined {
  return listenToDesktopEvent(MENU_ACTION_EVENT, handler);
}
