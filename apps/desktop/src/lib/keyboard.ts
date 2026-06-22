function isPrimaryShortcut(event: KeyboardEvent) {
  return event.metaKey || event.ctrlKey;
}

export function matchesRuntimeKeymap(event: KeyboardEvent, keymap: string): boolean {
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

  if (key === "/") {
    return event.key === "/" || event.code === "Slash";
  }
  if (key === "space") {
    return event.key === " " || event.code === "Space";
  }

  return event.key.toLowerCase() === key;
}
