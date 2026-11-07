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
  "md-editor:toggle-source": "view.toggleSource",
  "md-editor:toggle-sidebar-primary": "view.toggleSidebarPrimary",
  "md-editor:toggle-focus-mode": "view.toggleFocusMode",
  "md-editor:toggle-typewriter-mode": "view.toggleTypewriterMode",
  "md-editor:insert-table": "table.insert",
};

export function createRuntimeKeyboardShortcuts(
  dispatchCommand: DesktopCommandDispatcher,
  settings: AppSettings,
) {
  const customKeymaps = new Map(settings.shortcuts.map((shortcut) => [shortcut.id, shortcut.key]));

  const shortcuts = runtime.keymaps.list().map((keymap): KeyboardShortcut => ({
    commandId: keymap.commandId,
    matches: (event) => matchesRuntimeKeymap(event, customKeymaps.get(keymap.id) ?? keymap.key),
    run: () => {
      void dispatchCommand(keymap.commandId);
    },
  }));

  // 绑定设置中配置的自定义快捷键（覆盖 format.*、editor.find、editor.replace 等编辑器能力）
  const registeredCommandIds = new Set(runtime.keymaps.list().map((k) => k.id));
  for (const shortcut of settings.shortcuts) {
    if (!registeredCommandIds.has(shortcut.id) && shortcut.key) {
      shortcuts.push({
        commandId: shortcut.commandId,
        matches: (event) => matchesRuntimeKeymap(event, shortcut.key),
        run: () => {
          void dispatchCommand(shortcut.commandId);
        },
      });
    }
  }

  // 兼容 Mod-j 备用续写快捷键（对齐 Web 端与设计规范，支持单手盲操）
  shortcuts.push({
    commandId: "ai.continueWriting",
    matches: (event) => matchesRuntimeKeymap(event, "Mod-j"),
    run: () => {
      void dispatchCommand("ai.continueWriting");
    },
  });

  return shortcuts;
}

export function bindRuntimeKeyboardShortcuts(
  dispatchCommand: DesktopCommandDispatcher,
  settings: AppSettings,
) {
  // keymap 来自 editor-core，菜单、命令和快捷键共享同一组 command id，避免各自漂移。
  const listener = (event: KeyboardEvent) => {
    if (isSettingsShortcutCaptureTarget(event.target)) {
      return;
    }

    const shortcut = createRuntimeKeyboardShortcuts(dispatchCommand, settings).find((candidate) =>
      candidate.matches(event),
    );
    if (!shortcut) {
      return;
    }

    // 格式化快捷键只作用于编辑器正文。设置字段、搜索框、重命名框即使落在
    // `.cm-editor` 内部（搜索面板）也不能被 capture 监听 preventDefault。
    if (shortcut.commandId?.startsWith("format.")) {
      if (isFormattingShortcutBlockedTarget(event.target)) {
        return;
      }
      const target = event.target as HTMLElement | null;
      const isInsideEditor = Boolean(target?.closest?.(".cm-editor"));
      const isEditorActive = Boolean(
        typeof document !== "undefined" && document.activeElement?.closest?.(".cm-editor"),
      );
      if (!isInsideEditor && !isEditorActive) {
        return;
      }
    }

    event.preventDefault();
    shortcut.run(event);
  };

  window.addEventListener("keydown", listener, { capture: true });
  return () => window.removeEventListener("keydown", listener, { capture: true });
}

interface ShortcutEventTarget {
  tagName?: string;
  isContentEditable?: boolean;
  closest?: (selector: string) => unknown;
}

/**
 * 文本入口（input / textarea / select，以及编辑器以外的 contenteditable）
 * 不接收 format.*。`.cm-content` 是编辑器正文，仍然接收。
 * 不能用 `isContentEditable === false` 判断：那会把所有非可编辑节点都当成输入框。
 */
function isFormattingShortcutBlockedTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== "object") {
    return false;
  }
  const element = target as ShortcutEventTarget;
  if (element.closest?.(".cm-content")) {
    return false;
  }
  const tag = element.tagName?.toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
    return true;
  }
  if (element.isContentEditable === true && !element.closest?.(".cm-editor")) {
    return true;
  }
  return false;
}

function isSettingsShortcutCaptureTarget(target: EventTarget | null): boolean {
  if (typeof Element !== "undefined" && target instanceof Element) {
    return Boolean(target.closest('[data-settings-shortcut-input="true"]'));
  }
  if (
    target &&
    "closest" in target &&
    typeof (target as { closest?: unknown }).closest === "function"
  ) {
    return Boolean(
      (target as unknown as { closest: (s: string) => unknown }).closest(
        '[data-settings-shortcut-input="true"]',
      ),
    );
  }
  return false;
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
