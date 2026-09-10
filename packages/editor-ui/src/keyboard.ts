export type OperatingSystem = "mac" | "windows" | "linux" | "other";

export function getOperatingSystem(): OperatingSystem {
  if (typeof navigator === "undefined") {
    return "other";
  }
  const platform = (navigator.platform || "").toLowerCase();
  const userAgent = (navigator.userAgent || "").toLowerCase();

  if (platform.includes("mac") || userAgent.includes("mac")) {
    return "mac";
  }
  if (platform.includes("win") || userAgent.includes("win")) {
    return "windows";
  }
  if (platform.includes("linux") || userAgent.includes("linux")) {
    return "linux";
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
