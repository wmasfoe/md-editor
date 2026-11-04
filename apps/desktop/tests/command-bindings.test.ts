import { describe, expect, it } from "vitest";
import { createRuntimeKeyboardShortcuts } from "../src/app/events/command-bindings";
import { createDefaultSettings } from "../src/app/settings/persistence/storage";

function createKeyEvent(overrides: Partial<KeyboardEvent>): KeyboardEvent {
  return {
    altKey: false,
    ctrlKey: false,
    metaKey: true,
    shiftKey: false,
    key: "s",
    code: "KeyS",
    isComposing: false,
    ...overrides,
  } as KeyboardEvent;
}

describe("createRuntimeKeyboardShortcuts", () => {
  it("默认能够匹配 format.strikethrough 快捷键 (Mod-Shift-S)", async () => {
    const dispatched: string[] = [];
    const defaultSettings = createDefaultSettings();
    const shortcuts = createRuntimeKeyboardShortcuts(async (id) => {
      dispatched.push(id);
    }, defaultSettings);

    const event = createKeyEvent({ shiftKey: true, key: "S", code: "KeyS" });
    const match = shortcuts.find((s) => s.matches(event));
    expect(match).toBeDefined();

    match!.run(event);
    expect(dispatched).toContain("format.strikethrough");
  });

  it("当用户在设置中自定义更改删除线快捷键后，能够按自定义键生效", async () => {
    const dispatched: string[] = [];
    const defaultSettings = createDefaultSettings();
    const customSettings = {
      ...defaultSettings,
      shortcuts: defaultSettings.shortcuts.map((s) =>
        s.id === "format.strikethrough" ? { ...s, key: "Mod-Shift-X" } : s,
      ),
    };

    const shortcuts = createRuntimeKeyboardShortcuts(async (id) => {
      dispatched.push(id);
    }, customSettings);

    // 旧快捷键 Mod-Shift-S 不再匹配删除线
    const oldEvent = createKeyEvent({ shiftKey: true, key: "S", code: "KeyS" });
    const oldMatch = shortcuts.find((s) => s.matches(oldEvent));
    if (oldMatch) {
      oldMatch.run(oldEvent);
    }
    expect(dispatched).not.toContain("format.strikethrough");

    // 新快捷键 Mod-Shift-X 正确匹配删除线并触发
    const newEvent = createKeyEvent({ shiftKey: true, key: "X", code: "KeyX" });
    const newMatch = shortcuts.find((s) => s.matches(newEvent));
    expect(newMatch).toBeDefined();

    newMatch!.run(newEvent);
    expect(dispatched).toContain("format.strikethrough");
  });
});
