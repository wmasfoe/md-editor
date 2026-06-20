import { listenToDesktopMenuActions } from "../../desktop/menu-events";
import { matchesRuntimeKeymap } from "../../lib/keyboard";
import type { KeyboardShortcut } from "../../types";
import { runtime } from "../runtime/editor-runtime";

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

    // Handle dynamic recent file menu items
    if (action.startsWith('md-editor:open-recent:')) {
      const index = parseInt(action.split(':')[2], 10);
      console.log('[Recent File] Opening index:', index);

      // Emit a custom event that the controller can listen to
      window.dispatchEvent(new CustomEvent('open-recent-file-by-index', {
        detail: { index }
      }));
      return;
    }

    // Handle clear recent files
    if (action === 'md-editor:clear-recent') {
      window.dispatchEvent(new CustomEvent('clear-recent-files'));
      return;
    }

    // Handle "No Recent Files" (disabled item, do nothing)
    if (action === 'md-editor:no-recent') {
      return;
    }

    const commandId = MENU_COMMANDS[action];
    console.log('[Command ID]', commandId);
    if (commandId) {
      void dispatchCommand(commandId);
    } else {
      console.warn('[Menu Event] No command mapped for action:', action);
    }
  });
}
