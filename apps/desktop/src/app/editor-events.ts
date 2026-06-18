import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listenToDesktopMenuActions } from "../desktop/menu-events";
import { matchesRuntimeKeymap } from "../lib/keyboard";
import type { KeyboardShortcut } from "../types";
import { runtime } from "./editor-runtime";

export type DesktopCommandDispatcher = (id: string) => Promise<void>;

const MENU_COMMANDS: Record<string, string> = {
  "md-editor:new": "file.new",
  "md-editor:open": "file.open",
  "md-editor:open-recent": "file.openRecent",
  "md-editor:open-folder": "file.openFolder",
  "md-editor:save": "file.save",
  "md-editor:save-as": "file.saveAs",
  "md-editor:mode-wysiwyg": "view.showWysiwyg",
  "md-editor:toggle-source": "view.toggleSource",
  "md-editor:toggle-sidebar-primary": "view.toggleSidebarPrimary"
};

export function createRuntimeKeyboardShortcuts(dispatchCommand: DesktopCommandDispatcher) {
  return runtime.keymaps.list().map(
    (keymap): KeyboardShortcut => ({
      matches: (event) => matchesRuntimeKeymap(event, keymap.key),
      run: () => {
        void dispatchCommand(keymap.commandId);
      }
    })
  );
}

export function bindRuntimeKeyboardShortcuts(dispatchCommand: DesktopCommandDispatcher) {
  // Keymaps come from editor-core so menu actions, app commands, and keyboard
  // shortcuts stay on the same command IDs instead of drifting independently.
  const shortcuts = createRuntimeKeyboardShortcuts(dispatchCommand);

  const listener = (event: KeyboardEvent) => {
    const shortcut = shortcuts.find((candidate) => candidate.matches(event));
    if (!shortcut) {
      return;
    }

    event.preventDefault();
    shortcut.run(event);
  };

  window.addEventListener("keydown", listener, { capture: true });
  return () => window.removeEventListener("keydown", listener, { capture: true });
}

export function bindDesktopMenuCommands(dispatchCommand: DesktopCommandDispatcher) {
  return listenToDesktopMenuActions((action) => {
    console.log('[Menu Event]', action);
    const commandId = MENU_COMMANDS[action];
    console.log('[Command ID]', commandId);
    if (commandId) {
      void dispatchCommand(commandId);
    } else {
      console.warn('[Menu Event] No command mapped for action:', action);
    }
  });
}

export function bindBrowserDirtyDocumentGuard() {
  const listener = (event: BeforeUnloadEvent) => {
    if (!runtime.document.getSnapshot().isDirty) {
      return;
    }

    event.preventDefault();
    event.returnValue = "";
  };

  window.addEventListener("beforeunload", listener);
  return () => window.removeEventListener("beforeunload", listener);
}

export function bindTauriCloseGuard() {
  let unlisten: (() => void) | undefined;

  if (!isTauri()) {
    return undefined;
  }

  void getCurrentWindow()
    .onCloseRequested((event) => {
      if (!runtime.document.getSnapshot().isDirty) {
        return;
      }

      const confirmed = window.confirm("Current document has unsaved changes. Close anyway?");
      if (!confirmed) {
        event.preventDefault();
      }
    })
    .then((dispose) => {
      unlisten = dispose;
    });

  return () => {
    unlisten?.();
  };
}
