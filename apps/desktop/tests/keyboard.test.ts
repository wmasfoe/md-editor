import { describe, expect, it } from "vitest";
import { matchesRuntimeKeymap } from "../src/lib/keyboard";

function keyboardEvent(overrides: Partial<KeyboardEvent>): KeyboardEvent {
  return {
    altKey: false,
    code: "KeyB",
    ctrlKey: false,
    key: "b",
    metaKey: true,
    shiftKey: true,
    ...overrides,
  } as KeyboardEvent;
}

describe("matchesRuntimeKeymap", () => {
  it("matches Shift+Command+B for the sidebar command", () => {
    expect(matchesRuntimeKeymap(keyboardEvent({}), "Mod-Shift-B")).toBe(true);
  });

  it("does not match the previous Shift+Command+1 shortcut", () => {
    expect(matchesRuntimeKeymap(keyboardEvent({ code: "Digit1", key: "1" }), "Mod-Shift-B")).toBe(
      false,
    );
  });

  it("matches shortcuts with Option when the keymap asks for Alt", () => {
    expect(matchesRuntimeKeymap(keyboardEvent({ altKey: true }), "Mod-Shift-Alt-B")).toBe(true);
    expect(matchesRuntimeKeymap(keyboardEvent({ altKey: false }), "Mod-Shift-Alt-B")).toBe(false);
  });

  it("matches the slash key by key or code", () => {
    expect(
      matchesRuntimeKeymap(keyboardEvent({ code: "Slash", key: "/", shiftKey: false }), "Mod-/"),
    ).toBe(true);
  });

  it("ignores shortcut matching while the IME is composing text", () => {
    expect(matchesRuntimeKeymap(keyboardEvent({ isComposing: true }), "Mod-Shift-B")).toBe(false);
    expect(matchesRuntimeKeymap(keyboardEvent({ keyCode: 229 }), "Mod-Shift-B")).toBe(false);
  });
});
