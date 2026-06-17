import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export const MENU_ACTION_EVENT = "md-editor-menu-action";

export function listenToDesktopMenuActions(handler: (action: string) => void): (() => void) | undefined {
  let unlisten: (() => void) | undefined;

  if (!isTauri()) {
    return undefined;
  }

  // Tauri resolves listener registration asynchronously. Keep a stable cleanup
  // closure so React can unmount safely even if registration finishes later.
  void listen<string>(MENU_ACTION_EVENT, (event) => {
    handler(event.payload);
  }).then((dispose) => {
    unlisten = dispose;
  });

  return () => {
    unlisten?.();
  };
}
