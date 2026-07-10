import { FILE_TREE_MENU_ACTION_PREFIX } from "../../desktop/file-tree-context-menu";
import { listenToDesktopMenuActions } from "../../desktop/menu-events";
import { matchesRuntimeKeymap } from "../../lib/keyboard";
import type { KeyboardShortcut } from "../../types";
import type { AppSettings } from "../settings/app-settings";
import { runtime } from "../runtime/editor-runtime";

export type DesktopCommandDispatcher = (id: string) => Promise<void>;

const MENU_COMMANDS: Record<string, string> = {
  "md-editor:new": "file.new",
  "md-editor:open": "file.open",
  "md-editor:open-recent": "file.openRecent",
  "md-editor:open-folder": "file.openFolder",
  "md-editor:save": "file.save",
  "md-editor:save-as": "file.saveAs",
  "md-editor:settings": "settings.open",
  "md-editor:mode-wysiwyg": "view.showWysiwyg",
  "md-editor:toggle-source": "view.toggleSource",
  "md-editor:toggle-sidebar-primary": "view.toggleSidebarPrimary",
};

export function createRuntimeKeyboardShortcuts(
  dispatchCommand: DesktopCommandDispatcher,
  settings: AppSettings,
) {
  const customKeymaps = new Map(settings.shortcuts.map((shortcut) => [shortcut.id, shortcut.key]));

  return runtime.keymaps.list().map((keymap): KeyboardShortcut => ({
    matches: (event) => matchesRuntimeKeymap(event, customKeymaps.get(keymap.id) ?? keymap.key),
    run: () => {
      void dispatchCommand(keymap.commandId);
    },
  }));
}

export function bindRuntimeKeyboardShortcuts(
  dispatchCommand: DesktopCommandDispatcher,
  settings: AppSettings,
) {
  // keymap 来自 editor-core，菜单、命令和快捷键共享同一组 command id，避免各自漂移。
  const shortcuts = createRuntimeKeyboardShortcuts(dispatchCommand, settings);

  const listener = (event: KeyboardEvent) => {
    if (isSettingsShortcutCaptureTarget(event.target)) {
      return;
    }

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

function isSettingsShortcutCaptureTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    Boolean(target.closest('[data-settings-shortcut-input="true"]'))
  );
}

export function bindDesktopMenuCommands(dispatchCommand: DesktopCommandDispatcher) {
  return listenToDesktopMenuActions((action) => {
    if (action.startsWith(FILE_TREE_MENU_ACTION_PREFIX)) {
      return;
    }

    // 处理动态生成的最近文件菜单项。
    if (action.startsWith("md-editor:open-recent:")) {
      const index = parseInt(action.split(":")[2], 10);

      // 转成 controller 可以监听的浏览器事件。
      window.dispatchEvent(
        new CustomEvent("open-recent-file-by-index", {
          detail: { index },
        }),
      );
      return;
    }

    // 处理清空最近文件菜单项。
    if (action === "md-editor:clear-recent") {
      window.dispatchEvent(new CustomEvent("clear-recent-files"));
      return;
    }

    // “没有最近文件”只是占位项，不触发命令。
    if (action === "md-editor:no-recent") {
      return;
    }

    const commandId = MENU_COMMANDS[action];
    if (commandId) {
      void dispatchCommand(commandId);
    } else {
      console.warn("[Menu Event] No command mapped for action:", action);
    }
  });
}
