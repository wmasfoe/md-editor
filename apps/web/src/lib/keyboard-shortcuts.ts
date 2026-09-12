import { matchesRuntimeKeymap } from "@md-editor/editor-ui";

export interface WebShortcutHandlers {
  readonly onToggleMode: () => void;
  readonly onToggleSidebar: () => void;
  readonly onToggleOutline: () => void;
  readonly onOpenSettings: () => void;
  readonly onSave: () => void;
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
 * 纯事件处理函数：根据键盘事件匹配预定快捷键并调用对应回调
 * 与桌面端快捷键体系保持一致（Mod = Mac Command / Win Ctrl）
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

  // 1. Mod-s : 保存文档
  if (matchesRuntimeKeymap(event, "Mod-s")) {
    event.preventDefault?.();
    handlers.onSave();
    return true;
  }

  // 2. Mod-Shift-S : 导出/另存为
  if (matchesRuntimeKeymap(event, "Mod-Shift-S") && handlers.onExport) {
    event.preventDefault?.();
    handlers.onExport();
    return true;
  }

  // 3. Mod-b 或 Mod-\ : 切换侧边栏展开/折叠
  if (matchesRuntimeKeymap(event, "Mod-b") || matchesRuntimeKeymap(event, "Mod-\\")) {
    event.preventDefault?.();
    handlers.onToggleSidebar();
    return true;
  }

  // 4. Mod-Shift-B : 切换大纲
  if (matchesRuntimeKeymap(event, "Mod-Shift-B")) {
    event.preventDefault?.();
    handlers.onToggleOutline();
    return true;
  }

  // 5. Mod-/ : 切换源码 / 所见即所得模式
  if (matchesRuntimeKeymap(event, "Mod-/")) {
    event.preventDefault?.();
    handlers.onToggleMode();
    return true;
  }

  // 6. Mod-n : 新建文档
  if (matchesRuntimeKeymap(event, "Mod-n") && handlers.onNewDocument) {
    event.preventDefault?.();
    handlers.onNewDocument();
    return true;
  }

  // 7. Mod-Shift-O : 打开文件夹
  if (matchesRuntimeKeymap(event, "Mod-Shift-O") && handlers.onOpenFolder) {
    event.preventDefault?.();
    handlers.onOpenFolder();
    return true;
  }

  // 8. Mod-o : 打开文件
  if (matchesRuntimeKeymap(event, "Mod-o") && handlers.onOpenDocument) {
    event.preventDefault?.();
    handlers.onOpenDocument();
    return true;
  }

  // 9. Mod-, : 打开偏好设置
  if (matchesRuntimeKeymap(event, "Mod-,")) {
    event.preventDefault?.();
    handlers.onOpenSettings();
    return true;
  }

  // 10. Mod-Shift-A 或 Mod-j : 触发 AI 续写
  if (matchesRuntimeKeymap(event, "Mod-Shift-A") || matchesRuntimeKeymap(event, "Mod-j")) {
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
