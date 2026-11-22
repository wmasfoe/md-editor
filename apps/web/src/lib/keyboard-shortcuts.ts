import { createBuiltInKeymaps } from "@md-editor/core";
import { matchesRuntimeKeymap } from "@md-editor/app-ui";

export interface WebShortcutHandlers {
  readonly onToggleMode: () => void;
  readonly onToggleSidebar: () => void;
  readonly onOpenSettings: () => void;
  readonly onSave: () => void;
  /**
   * 导出 HTML。键位是本应用自有的（core 只注册 `file.exportHtml` 命令、不绑默认键），
   * 因此下面是 web 专用 chord，不在 core 的默认表里。
   */
  readonly onExport?: () => void;
  readonly onNewDocument?: () => void;
  readonly onOpenDocument?: () => void;
  readonly onOpenFolder?: () => void;
  readonly onTriggerAi: () => void;
  readonly onCloseOverlay: () => void;
}

export interface KeyboardEventTarget {
  addEventListener(type: string, listener: (event: KeyboardEvent) => void, options?: unknown): void;
  removeEventListener(
    type: string,
    listener: (event: KeyboardEvent) => void,
    options?: unknown,
  ): void;
}

/**
 * 宿主（web 窗口）自己的键位表 = core 内建表里**不归编辑器**的那些。
 *
 * 此前本文件在 if-chain 里硬编码了 10 个 chord，其中 `Mod-b` 被用于"切换侧边栏"，
 * 与格式化表的"加粗"直接冲突 —— 于是同一个 ⌘B 在 web 是侧边栏、在 desktop 是加粗。
 * 现在 chord 一律从 core 取，两侧不可能再各自发明。
 */
const HOST_KEYMAPS = createBuiltInKeymaps().filter((keymap) => keymap.owner !== "editor");

/** 取内建命令的默认 chord；id 不存在时抛错，避免静默绑定到空串。 */
function chordOf(id: string): string {
  const keymap = HOST_KEYMAPS.find((candidate) => candidate.id === id);
  if (!keymap) {
    throw new Error(`[web/shortcuts] Unknown built-in keymap id: ${id}`);
  }
  return keymap.key;
}

/** web 自有（不在 core 默认表里）的键位。 */
const WEB_ONLY_SHORTCUTS = {
  /** 导出 HTML：core 的 `file.exportHtml` 只注册命令，没有默认键位。 */
  exportHtml: "Mod-Shift-S",
  /** AI 续写的单手备用键（与 desktop 对齐，见 defaults 里的说明）。 */
  continueWritingAlias: "Mod-j",
} as const;

/**
 * 纯事件处理函数：根据键盘事件匹配内建键位并调用对应回调。
 * 与桌面端共用 core 的键位表（`Mod` = Mac Command / Win Ctrl）。
 */
export function handleWebKeyboardEvent(
  event: KeyboardEvent,
  handlers: WebShortcutHandlers,
): boolean {
  const target = event.target as HTMLElement | null;
  const isEditingInput =
    target &&
    (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);

  if (event.key === "Escape") {
    handlers.onCloseOverlay();
    return true;
  }

  if (isEditingInput && target.closest?.("[data-settings-dialog='true']")) {
    return false;
  }

  // 1. 保存 / 导出
  if (matchesRuntimeKeymap(event, chordOf("file.save"))) {
    event.preventDefault?.();
    handlers.onSave();
    return true;
  }
  if (handlers.onExport && matchesRuntimeKeymap(event, WEB_ONLY_SHORTCUTS.exportHtml)) {
    event.preventDefault?.();
    handlers.onExport();
    return true;
  }

  // 2. 侧边栏（文件树 / 大纲）：core 把它归为宿主语义，编辑器不会抢这个 chord
  if (matchesRuntimeKeymap(event, chordOf("view.toggleSidebarPrimary"))) {
    event.preventDefault?.();
    handlers.onToggleSidebar();
    return true;
  }

  // 3. 切换源码 / 所见即所得
  if (matchesRuntimeKeymap(event, chordOf("view.toggleSource"))) {
    event.preventDefault?.();
    handlers.onToggleMode();
    return true;
  }

  // 4. 新建 / 打开 / 打开文件夹
  if (handlers.onNewDocument && matchesRuntimeKeymap(event, chordOf("file.new"))) {
    event.preventDefault?.();
    handlers.onNewDocument();
    return true;
  }
  if (handlers.onOpenFolder && matchesRuntimeKeymap(event, chordOf("file.openFolder"))) {
    event.preventDefault?.();
    handlers.onOpenFolder();
    return true;
  }
  if (handlers.onOpenDocument && matchesRuntimeKeymap(event, chordOf("file.open"))) {
    event.preventDefault?.();
    handlers.onOpenDocument();
    return true;
  }

  // 5. 偏好设置
  if (matchesRuntimeKeymap(event, chordOf("settings.open"))) {
    event.preventDefault?.();
    handlers.onOpenSettings();
    return true;
  }

  // 6. AI 续写
  if (
    matchesRuntimeKeymap(event, chordOf("ai.continueWriting")) ||
    matchesRuntimeKeymap(event, WEB_ONLY_SHORTCUTS.continueWritingAlias)
  ) {
    event.preventDefault?.();
    handlers.onTriggerAi();
    return true;
  }

  return false;
}

/**
 * 绑定全局键盘快捷键监听
 */
export function bindWebKeyboardShortcuts(
  handlers: WebShortcutHandlers,
  target?: KeyboardEventTarget,
): () => void {
  const win = target ?? (typeof window !== "undefined" ? window : null);
  if (!win) {
    return () => {};
  }

  const listener = (event: KeyboardEvent) => {
    handleWebKeyboardEvent(event, handlers);
  };

  win.addEventListener("keydown", listener, { capture: true });
  return () => win.removeEventListener("keydown", listener, { capture: true });
}
