/**
 * @fileoverview 快捷键键位解析、规范化与跨平台标签渲染 (Shortcut Keys)
 *
 * 处理 Mod-Shift-F 与系统修饰键（Command, Option, Ctrl, Shift）在 Mac/Windows/Linux
 * 平台上的展示顺序与键位事件捕获映射。
 */

import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  getOperatingSystem,
  isComposingKeyboardEvent,
  type OperatingSystem,
} from "../../../lib/keyboard";

/**
 * 将内部快捷键字符串转换为面向用户界面的本土化标签
 *
 * 例如在 macOS 上 "Mod-Shift-S" -> "Command+Shift+S"
 * 在 Windows/Linux 上 -> "Ctrl+Shift+S"
 *
 * @param key 内部快捷键标识
 * @param os 目标操作系统平台，缺省为当前运行系统
 */
export function keyboardShortcutLabel(
  key: string,
  os: OperatingSystem = getOperatingSystem(),
): string {
  if (!key) return "";

  const parts = key
    .split(/[-+]/u)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return "";

  const rawKeyName = parts.at(-1)!;
  const keyName = normalizeKeyName(rawKeyName);
  const modParts = parts.slice(0, -1).map((p) => p.toLowerCase());

  const hasMod = modParts.includes("mod");
  const hasCommand = modParts.includes("cmd") || modParts.includes("command");
  const hasCtrl = modParts.includes("ctrl") || modParts.includes("control");
  const hasAlt = modParts.includes("alt") || modParts.includes("option");
  const hasShift = modParts.includes("shift");
  const hasWin =
    modParts.includes("win") || modParts.includes("meta") || modParts.includes("super");

  const ordered: string[] = [];

  if (os === "mac") {
    // macOS 规范顺序：Control -> Option -> Command -> Shift
    if (hasCtrl) ordered.push("Control");
    if (hasAlt) ordered.push("Option");
    if (hasMod || hasCommand) ordered.push("Command");
    if (hasShift) ordered.push("Shift");
  } else if (os === "windows") {
    // Windows 规范顺序：Ctrl -> Win -> Alt -> Shift
    if (hasMod || hasCtrl) ordered.push("Ctrl");
    if (hasWin) ordered.push("Win");
    if (hasAlt) ordered.push("Alt");
    if (hasShift) ordered.push("Shift");
  } else {
    // Linux 规范顺序：Ctrl -> Super -> Alt -> Shift
    if (hasMod || hasCtrl) ordered.push("Ctrl");
    if (hasWin) ordered.push("Super");
    if (hasAlt) ordered.push("Alt");
    if (hasShift) ordered.push("Shift");
  }

  if (ordered.length === 0 && parts.length > 1) {
    return parts
      .map((part) => {
        const lower = part.toLowerCase();
        if (lower === "mod") return os === "mac" ? "Command" : "Ctrl";
        if (lower === "alt" || lower === "option") return os === "mac" ? "Option" : "Alt";
        if (lower === "ctrl" || lower === "control") return os === "mac" ? "Control" : "Ctrl";
        if (lower === "win" || lower === "meta" || lower === "super") {
          if (os === "mac") return "Command";
          if (os === "windows") return "Win";
          return "Super";
        }
        return part;
      })
      .join("+");
  }

  return [...ordered, keyName].join("+");
}

/**
 * 从原生或 React 键盘事件中捕获并格式化为标准内部快捷键字符串
 * 处于输入法 IME 组合阶段时安全返回 null
 */
export function shortcutKeyFromKeyboardEvent(
  event: KeyboardEvent | ReactKeyboardEvent,
): string | null {
  const nativeEvent = "nativeEvent" in event ? event.nativeEvent : event;
  if (isComposingKeyboardEvent(nativeEvent)) {
    return null;
  }

  if (isModifierKey(event.key)) {
    return null;
  }

  const key = normalizeKeyboardEventKey(event);
  if (!key) {
    return null;
  }

  return [
    event.metaKey || event.ctrlKey ? "Mod" : null,
    event.shiftKey ? "Shift" : null,
    event.altKey ? "Alt" : null,
    key,
  ]
    .filter(Boolean)
    .join("-");
}

/**
 * 将用户自定义输入的快捷键字符串规范化为标准内部格式
 */
export function normalizeShortcutKey(input: string): string | null {
  // 用户输入面向产品文案（如 Option+Command+T），内部统一成 keymap 格式（如 Mod-Shift-B）
  const internalKey = normalizeInternalShortcutKey(input);
  if (internalKey) {
    return internalKey;
  }

  const parts = input
    .trim()
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 0) {
    return null;
  }

  let wantsMod = false;
  let wantsShift = false;
  let wantsAlt = false;
  let key: string | null = null;

  for (const rawPart of parts) {
    const part = rawPart.toLowerCase();
    if (
      part === "cmd" ||
      part === "command" ||
      part === "ctrl" ||
      part === "control" ||
      part === "mod" ||
      part === "win" ||
      part === "super"
    ) {
      wantsMod = true;
      continue;
    }
    if (part === "shift") {
      wantsShift = true;
      continue;
    }
    if (part === "alt" || part === "option") {
      wantsAlt = true;
      continue;
    }
    if (key) {
      return null;
    }
    key = normalizeKeyName(rawPart);
  }

  if (!wantsMod || !key) {
    return null;
  }

  return ["Mod", wantsShift ? "Shift" : null, wantsAlt ? "Alt" : null, key]
    .filter(Boolean)
    .join("-");
}

function normalizeInternalShortcutKey(input: string): string | null {
  const parts = input.trim().split("-").filter(Boolean);
  if (parts[0]?.toLowerCase() !== "mod" || parts.length < 2) {
    return null;
  }

  const modifiers = parts.slice(1, -1);
  const normalizedModifiers: string[] = [];
  for (const modifier of modifiers) {
    const lower = modifier.toLowerCase();
    if (lower === "shift") {
      normalizedModifiers.push("Shift");
    } else if (lower === "alt" || lower === "option") {
      normalizedModifiers.push("Alt");
    } else {
      return null;
    }
  }

  return ["Mod", ...normalizedModifiers, normalizeKeyName(parts.at(-1) ?? "")].join("-");
}

function normalizeKeyName(key: string): string {
  if (key === "/") {
    return "/";
  }

  const lower = key.toLowerCase();
  if (lower === "space") {
    return "Space";
  }
  if (lower.length === 1) {
    return lower.toUpperCase();
  }

  return key.slice(0, 1).toUpperCase() + key.slice(1);
}

function normalizeKeyboardEventKey(event: KeyboardEvent | ReactKeyboardEvent): string | null {
  if (event.key === " ") {
    return "Space";
  }
  if (event.key === "/") {
    return "/";
  }
  if (event.key === ",") {
    return ",";
  }
  if (/^Key[A-Z]$/u.test(event.code)) {
    return event.code.slice(3);
  }
  if (/^Digit\d$/u.test(event.code)) {
    return event.code.slice(5);
  }
  if (event.key.length === 1) {
    return normalizeKeyName(event.key);
  }
  if (
    /^F\d{1,2}$/u.test(event.key) ||
    event.key === "Escape" ||
    event.key === "Enter" ||
    event.key === "Tab"
  ) {
    return event.key;
  }

  return null;
}

function isModifierKey(key: string): boolean {
  return key === "Meta" || key === "Control" || key === "Shift" || key === "Alt";
}
