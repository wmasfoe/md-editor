import { matchesRuntimeKeymap } from "@md-editor/editor-ui";

export interface WebShortcutHandlers {
  readonly onToggleMode: () => void;
  readonly onToggleOutline: () => void;
  readonly onOpenSettings: () => void;
  readonly onSave: () => void;
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
 * @returns 是否命中并处理了快捷键
 */
export function handleWebKeyboardEvent(
  event: KeyboardEvent,
  handlers: WebShortcutHandlers,
): boolean {
  // 如果用户正在输入框/文本域中键入，且在设置弹窗中，跳过全局拦截（避免拦截输入）
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

  // 1. Mod-/ : 切换源码 / 所见即所得模式
  if (matchesRuntimeKeymap(event, "Mod-/")) {
    event.preventDefault?.();
    handlers.onToggleMode();
    return true;
  }

  // 2. Mod-Shift-B : 切换大纲抽屉展开/折叠
  if (matchesRuntimeKeymap(event, "Mod-Shift-B")) {
    event.preventDefault?.();
    handlers.onToggleOutline();
    return true;
  }

  // 3. Mod-, : 打开设置
  if (matchesRuntimeKeymap(event, "Mod-,")) {
    event.preventDefault?.();
    handlers.onOpenSettings();
    return true;
  }

  // 4. Mod-s : 导出 / 保存当前 Markdown
  if (matchesRuntimeKeymap(event, "Mod-s")) {
    event.preventDefault?.();
    handlers.onSave();
    return true;
  }

  // 5. Mod-Shift-A 或 Mod-j : 触发 AI 续写
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
