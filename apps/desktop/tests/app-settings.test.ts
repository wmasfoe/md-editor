import { describe, expect, it } from "vitest";
import {
  createDefaultSettings,
  normalizeShortcutKey,
  shortcutKeyFromKeyboardEvent,
  validateAssetsDirectory
} from "../src/app/settings/app-settings";

describe("app settings", () => {
  it("keeps the default settings aligned with editable shortcuts", () => {
    const settings = createDefaultSettings();

    expect(settings.assetsDirectory).toBe("assets");
    expect(settings.ai.features).toEqual({
      continuation: false,
      editing: true
    });
    expect(settings.shortcuts.map((shortcut) => shortcut.id)).toEqual([
      "view.toggleSource",
      "view.toggleSidebarPrimary",
      "settings.open",
      "mdx.openComponentMenu",
      "ai.continueWriting"
    ]);
  });

  it("normalizes product-facing shortcut text to runtime keymaps", () => {
    expect(normalizeShortcutKey("Command+Shift+B")).toBe("Mod-Shift-B");
    expect(normalizeShortcutKey("Ctrl+/")).toBe("Mod-/");
    expect(normalizeShortcutKey("Command+Option+Space")).toBe("Mod-Alt-Space");
    expect(normalizeShortcutKey("Mod-Shift-B")).toBe("Mod-Shift-B");
  });

  it("rejects shortcuts without a primary modifier", () => {
    expect(normalizeShortcutKey("Shift+B")).toBeNull();
    expect(normalizeShortcutKey("Command")).toBeNull();
  });

  it("captures shortcut combinations from keyboard events", () => {
    expect(
      shortcutKeyFromKeyboardEvent({
        altKey: false,
        code: "KeyB",
        ctrlKey: false,
        key: "b",
        metaKey: true,
        shiftKey: true
      } as KeyboardEvent)
    ).toBe("Mod-Shift-B");
    expect(
      shortcutKeyFromKeyboardEvent({
        altKey: false,
        code: "Slash",
        ctrlKey: true,
        key: "/",
        metaKey: false,
        shiftKey: false
      } as KeyboardEvent)
    ).toBe("Mod-/");
  });

  it("keeps custom asset directories inside the markdown folder", () => {
    expect(validateAssetsDirectory("images/posts")).toBe("images/posts");
    expect(validateAssetsDirectory("./assets")).toBe("assets");
    expect(validateAssetsDirectory("../outside")).toBeNull();
    expect(validateAssetsDirectory("/tmp/assets")).toBeNull();
  });
});
