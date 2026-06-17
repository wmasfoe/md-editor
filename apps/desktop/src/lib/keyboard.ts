function isPrimaryShortcut(event: KeyboardEvent) {
  return (event.metaKey || event.ctrlKey) && !event.altKey;
}

export function matchesRuntimeKeymap(event: KeyboardEvent, keymap: string): boolean {
  const parts = keymap.split("-");
  const key = parts.at(-1)?.toLowerCase();
  const wantsMod = parts.includes("Mod");
  const wantsShift = parts.includes("Shift");

  if (wantsMod && !isPrimaryShortcut(event)) {
    return false;
  }
  if (!wantsMod && (event.metaKey || event.ctrlKey)) {
    return false;
  }
  if (event.shiftKey !== wantsShift) {
    return false;
  }

  if (key === "/") {
    return event.key === "/" || event.code === "Slash";
  }

  return event.key.toLowerCase() === key;
}
