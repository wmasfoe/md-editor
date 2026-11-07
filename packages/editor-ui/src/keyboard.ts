export type OperatingSystem = "mac" | "windows" | "linux" | "other";

export function getOperatingSystem(): OperatingSystem {
  if (typeof navigator !== "undefined") {
    const userAgentDataPlatform =
      // @ts-expect-error userAgentData is experimental in standard lib DOM
      typeof navigator.userAgentData?.platform === "string"
        ? // @ts-expect-error userAgentData is experimental in standard lib DOM
          (navigator.userAgentData.platform as string).toLowerCase()
        : "";
    const platform = (navigator.platform || "").toLowerCase();
    const userAgent = (navigator.userAgent || "").toLowerCase();

    if (
      platform.includes("win") ||
      userAgent.includes("win") ||
      userAgentDataPlatform.includes("win")
    ) {
      return "windows";
    }
    if (
      platform.includes("mac") ||
      userAgent.includes("mac") ||
      userAgentDataPlatform.includes("mac")
    ) {
      return "mac";
    }
    if (
      platform.includes("linux") ||
      userAgent.includes("linux") ||
      userAgentDataPlatform.includes("linux")
    ) {
      return "linux";
    }
  }

  if (typeof process !== "undefined" && typeof process.platform === "string") {
    if (process.platform === "win32") {
      return "windows";
    }
    if (process.platform === "darwin") {
      return "mac";
    }
    if (process.platform === "linux") {
      return "linux";
    }
  }

  return "other";
}

export function isMacPlatform(): boolean {
  return getOperatingSystem() === "mac";
}

export function isWindowsPlatform(): boolean {
  return getOperatingSystem() === "windows";
}

export function isLinuxPlatform(): boolean {
  return getOperatingSystem() === "linux";
}

/** 把 keymap 里的修饰键名映射为各平台的展示符号 */
const MAC_KEY_SYMBOLS: Readonly<Record<string, string>> = {
  Mod: "⌘",
  Ctrl: "⌃",
  Alt: "⌥",
  Shift: "⇧",
};
const OTHER_KEY_LABELS: Readonly<Record<string, string>> = {
  Mod: "Ctrl",
  Ctrl: "Ctrl",
  Alt: "Alt",
  Shift: "Shift",
};

/** 命名主键的展示符号；未列出的主键（字母、数字、标点）按大写原样展示 */
const NAMED_KEY_SYMBOLS: Readonly<Record<string, string>> = {
  Backspace: "⌫",
  Delete: "⌦",
  Enter: "↵",
  Tab: "⇥",
  Escape: "Esc",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
};

/** macOS 修饰键展示顺序：⌃ ⌥ ⇧ ⌘；非修饰键返回 -1 */
const MAC_MODIFIER_ORDER = ["⌃", "⌥", "⇧", "⌘"];
function macModifierRank(value: string): number {
  return MAC_MODIFIER_ORDER.indexOf(value);
}

/**
 * 把 keymap 字符串（如 `Mod-Shift-B`）拆成可渲染为 keycap 的按键片段。
 * macOS 使用 ⌘⇧⌥⌃ 符号；其他平台使用 Ctrl/Alt/Shift 文字。
 * 修饰键之外的最后一段视为主键，单字母统一大写展示。
 */
export function formatKeymapParts(
  keymap: string,
  platform: OperatingSystem = getOperatingSystem(),
): readonly string[] {
  const segments = keymap.split("-").filter((segment) => segment.length > 0);
  // 主键本身可能就是 "-"（如 `Mod--`）：split 后末尾为空串，这里补回
  if (keymap.endsWith("--")) {
    segments.push("-");
  }
  const symbols = platform === "mac" ? MAC_KEY_SYMBOLS : OTHER_KEY_LABELS;
  const ordered = segments.map(
    (segment) => symbols[segment] ?? NAMED_KEY_SYMBOLS[segment] ?? segment.toUpperCase(),
  );
  if (platform !== "mac") {
    return ordered;
  }
  // macOS 惯例顺序：⌃ ⌥ ⇧ ⌘ 再接主键
  const modifiers = ordered
    .filter((value) => macModifierRank(value) >= 0)
    .toSorted((left, right) => macModifierRank(left) - macModifierRank(right));
  const keys = ordered.filter((value) => macModifierRank(value) < 0);
  return [...modifiers, ...keys];
}

function isPrimaryShortcut(event: KeyboardEvent) {
  return event.metaKey || event.ctrlKey;
}

export function isComposingKeyboardEvent(
  event: Pick<KeyboardEvent, "isComposing" | "keyCode">,
): boolean {
  return event.isComposing || event.keyCode === 229;
}

export function matchesRuntimeKeymap(event: KeyboardEvent, keymap: string): boolean {
  if (isComposingKeyboardEvent(event)) {
    return false;
  }

  const parts = keymap.split("-");
  const key = parts.at(-1)?.toLowerCase();
  const wantsMod = parts.includes("Mod");
  const wantsShift = parts.includes("Shift");
  const wantsAlt = parts.includes("Alt");

  if (wantsMod && !isPrimaryShortcut(event)) {
    return false;
  }
  if (!wantsMod && (event.metaKey || event.ctrlKey)) {
    return false;
  }
  if (event.shiftKey !== wantsShift) {
    return false;
  }
  if (event.altKey !== wantsAlt) {
    return false;
  }

  if (!key) {
    return false;
  }

  if (key === "/") {
    return event.key === "/" || event.code === "Slash";
  }
  if (key === "space") {
    return event.key === " " || event.code === "Space";
  }
  if (key === ",") {
    return event.key === "," || event.code === "Comma";
  }
  if (key === ".") {
    return event.key === "." || event.code === "Period";
  }

  // 物理键位优先比对：解决 macOS 下按住 Option/Alt 时输入字母产生变体字符（如 t -> †）导致 event.key 无法匹配的问题
  if (/^[a-z]$/i.test(key) && event.code) {
    if (event.code.toLowerCase() === `key${key}`) {
      return true;
    }
  }

  // 数字物理键位比对：解决 macOS 下按住 Option/Alt 时输入数字产生 ¡、™ 等字符的问题
  if (/^[0-9]$/.test(key) && event.code) {
    if (event.code === `Digit${key}` || event.code === `Numpad${key}`) {
      return true;
    }
  }

  return event.key.toLowerCase() === key;
}
