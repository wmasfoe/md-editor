import { describe, expect, it, vi } from "vitest";
import {
  bindRuntimeKeyboardShortcuts,
  createRuntimeKeyboardShortcuts,
} from "../src/app/events/command-bindings";
import { runtime } from "../src/app/runtime/editor-runtime";
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

  it("打开文件夹绑定 Mod-Alt-O，Mod-Shift-O 仍是有序列表", () => {
    const dispatched: string[] = [];
    const shortcuts = createRuntimeKeyboardShortcuts(async (id) => {
      dispatched.push(id);
    }, createDefaultSettings());

    const openFolder = shortcuts.find((shortcut) =>
      shortcut.matches(createKeyEvent({ altKey: true, shiftKey: false, key: "o", code: "KeyO" })),
    );
    expect(openFolder).toBeDefined();
    openFolder!.run(createKeyEvent({ altKey: true, key: "o", code: "KeyO" }));
    expect(dispatched).toContain("file.openFolder");

    dispatched.length = 0;
    const orderedList = shortcuts.find((shortcut) =>
      shortcut.matches(createKeyEvent({ altKey: false, shiftKey: true, key: "O", code: "KeyO" })),
    );
    expect(orderedList).toBeDefined();
    orderedList!.run(createKeyEvent({ shiftKey: true, key: "O", code: "KeyO" }));
    expect(dispatched).toEqual(["format.orderedList"]);
  });

  it("bindRuntimeKeyboardShortcuts 不会在普通 input/textarea 输入框内拦截 format.* 快捷键", () => {
    const originalWindow = globalThis.window;
    const originalDocument = globalThis.document;

    const mockListeners: Array<(event: KeyboardEvent) => void> = [];
    (globalThis as unknown as { window: unknown }).window = {
      addEventListener: (_type: string, listener: (event: KeyboardEvent) => void) => {
        mockListeners.push(listener);
      },
      removeEventListener: () => {},
    };
    (globalThis as unknown as { document: unknown }).document = {
      activeElement: null,
    };

    const dispatched: string[] = [];
    const defaultSettings = createDefaultSettings();
    const unbind = bindRuntimeKeyboardShortcuts(async (id: string) => {
      dispatched.push(id);
    }, defaultSettings);

    expect(mockListeners.length).toBe(1);
    const listener = mockListeners[0];

    // 1. 在普通 input 输入框中按 Mod-B
    let inputPrevented = false;
    const inputTarget = {
      tagName: "INPUT",
      closest: () => null,
      isContentEditable: false,
    };
    const inputEvent = createKeyEvent({
      metaKey: true,
      key: "b",
      code: "KeyB",
      target: inputTarget as unknown as EventTarget,
      preventDefault: () => {
        inputPrevented = true;
      },
    });

    listener(inputEvent);
    expect(inputPrevented).toBe(false);
    expect(dispatched).toHaveLength(0);

    // 2. 在 .cm-editor 内容区域中按 Mod-B
    let editorPrevented = false;
    const editorTarget = {
      tagName: "DIV",
      closest: (sel: string) => (sel === ".cm-editor" ? editorTarget : null),
      isContentEditable: true,
    };
    const editorEvent = createKeyEvent({
      metaKey: true,
      key: "b",
      code: "KeyB",
      target: editorTarget as unknown as EventTarget,
      preventDefault: () => {
        editorPrevented = true;
      },
    });

    listener(editorEvent);
    expect(editorPrevented).toBe(true);
    expect(dispatched).toContain("format.bold");

    // 3. 编辑器内部的搜索框（位于 .cm-editor，但不是正文）不能被格式化快捷键拦截
    let searchPrevented = false;
    const searchTarget = {
      tagName: "INPUT",
      className: "cm-search-input",
      isContentEditable: false,
      closest: (sel: string) => (sel === ".cm-editor" ? searchTarget : null),
    };
    const searchEvent = createKeyEvent({
      metaKey: true,
      key: "b",
      code: "KeyB",
      target: searchTarget as unknown as EventTarget,
      preventDefault: () => {
        searchPrevented = true;
      },
    });
    listener(searchEvent);
    expect(searchPrevented).toBe(false);

    // 4. textarea 与编辑器外的 contenteditable 同样不拦截
    let textareaPrevented = false;
    const textareaEvent = createKeyEvent({
      metaKey: true,
      key: "i",
      code: "KeyI",
      target: {
        tagName: "TEXTAREA",
        isContentEditable: false,
        closest: () => null,
      } as unknown as EventTarget,
      preventDefault: () => {
        textareaPrevented = true;
      },
    });
    listener(textareaEvent);
    expect(textareaPrevented).toBe(false);

    let foreignEditablePrevented = false;
    const foreignEditableEvent = createKeyEvent({
      metaKey: true,
      key: "e",
      code: "KeyE",
      target: {
        tagName: "DIV",
        isContentEditable: true,
        closest: () => null,
      } as unknown as EventTarget,
      preventDefault: () => {
        foreignEditablePrevented = true;
      },
    });
    listener(foreignEditableEvent);
    expect(foreignEditablePrevented).toBe(false);
    expect(dispatched).toEqual(["format.bold"]);

    unbind();
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
  });

  it("bindRuntimeKeyboardShortcuts 只在快捷键注册变化后重建匹配表，并能识别运行中新增的插件快捷键", () => {
    const originalWindow = globalThis.window;
    const listeners: Array<(event: KeyboardEvent) => void> = [];
    (globalThis as unknown as { window: unknown }).window = {
      addEventListener: (_type: string, listener: (event: KeyboardEvent) => void) => {
        listeners.push(listener);
      },
      removeEventListener: () => {},
    };
    const listSpy = vi.spyOn(runtime.keymaps, "list");
    const dispatched: string[] = [];
    const unbind = bindRuntimeKeyboardShortcuts(async (id: string) => {
      dispatched.push(id);
    }, createDefaultSettings());
    const press = (key: string) =>
      listeners[0]!(
        createKeyEvent({
          metaKey: true,
          altKey: true,
          key,
          code: `Key${key.toUpperCase()}`,
          target: { tagName: "DIV", closest: () => null } as unknown as EventTarget,
          preventDefault: () => {},
        }),
      );
    try {
      press("q");
      press("q");
      press("q");
      // 三次按键只建一次表：createRuntimeKeyboardShortcuts 每次建表调用两次 list()。
      expect(listSpy).toHaveBeenCalledTimes(2);
      expect(dispatched).toEqual([]);

      const registration = runtime.keymaps.register({
        id: "author.test.key",
        key: "Mod-Alt-q",
        commandId: "author.test.command",
      });
      press("q");
      expect(dispatched).toEqual(["author.test.command"]);
      expect(listSpy).toHaveBeenCalledTimes(4);

      registration.dispose();
      press("q");
      expect(dispatched).toEqual(["author.test.command"]);
    } finally {
      unbind();
      listSpy.mockRestore();
      (globalThis as unknown as { window: unknown }).window = originalWindow;
    }
  });
});
