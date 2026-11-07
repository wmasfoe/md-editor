import { describe, expect, it, vi } from "vitest";
import { createCommandRegistry, createKeymapRegistry, type CommandContext } from "../src/index.ts";

describe("dynamic plugin registrations", () => {
  it("removes commands from dispatch and palette and keeps later registrations", async () => {
    const registry = createCommandRegistry();
    const run = vi.fn();
    const entry = {
      id: "personal.insert",
      title: "Insert",
      placement: ["command-palette"] as const,
      run,
    };
    const first = registry.register(entry);
    first.dispose();
    first.dispose();
    expect(registry.listByPlacement("command-palette")).toEqual([]);
    expect(await registry.dispatch(entry.id, {} as CommandContext)).toBe(false);
    registry.register(entry);
    first.dispose();
    expect(await registry.dispatch(entry.id, {} as CommandContext)).toBe(true);
    expect(run).toHaveBeenCalledOnce();
    expect(registry.unregister(entry.id)).toBe(true);
    expect(registry.unregister(entry.id)).toBe(false);
  });

  it("releases key conflicts and prevents stale handles from removing replacement bindings", () => {
    const registry = createKeymapRegistry();
    const entry = { id: "personal.insert", key: "Mod-Alt-i", commandId: "personal.insert" };
    const first = registry.register(entry);
    expect(() => registry.register({ ...entry, id: "other" })).toThrow("Ambiguous");
    expect(registry.unregister(entry.id)).toBe(true);
    registry.register(entry);
    first.dispose();
    expect(registry.list()).toEqual([entry]);
    expect(registry.unregister(entry.id)).toBe(true);
    registry.register({ ...entry, id: "other" }).dispose();
    expect(registry.list()).toEqual([]);
  });
});

describe("keymap validation and conflict lookup", () => {
  it("accepts the shortcut shapes the runtime matcher understands", async () => {
    const { validateKeymapKey } = await import("../src/index.ts");
    const valid = ["Mod-s", "Mod-Shift-A", "Mod-Alt-ArrowUp", "Shift-Alt-F", "Mod-,"];
    expect(valid.map((key) => [key, validateKeymapKey(key)])).toEqual(
      valid.map((key) => [key, null]),
    );
  });

  it("rejects malformed shortcuts with a reason", async () => {
    const { validateKeymapKey } = await import("../src/index.ts");
    for (const key of [
      "",
      " Mod-s",
      "Mod-s ",
      "Mod-",
      "Ctrl-s",
      "Mod-Mod-s",
      "Mod-Shift",
      "-",
      "Mod--",
    ]) {
      // 把输入一并放进断言值，失败时能看出是哪一个格式没被拒绝。
      expect({ key, reason: validateKeymapKey(key) }).toEqual({ key, reason: expect.any(String) });
    }
  });

  it("finds the binding that already owns a key, scoped by `when`", () => {
    const registry = createKeymapRegistry();
    registry.register({ id: "a.one", key: "Mod-Alt-i", commandId: "a.one" });
    registry.register({ id: "a.two", key: "Mod-Alt-j", commandId: "a.two", when: "editor" });
    expect(registry.findConflict("Mod-Alt-i")?.id).toBe("a.one");
    expect(registry.findConflict("Mod-Alt-z")).toBeUndefined();
    expect(registry.findConflict("Mod-Alt-j")).toBeUndefined();
    expect(registry.findConflict("Mod-Alt-j", "editor")?.id).toBe("a.two");
  });
});

describe("keymap registry version", () => {
  it("changes only when registrations actually change", () => {
    const registry = createKeymapRegistry();
    const start = registry.version;
    const handle = registry.register({ id: "a.one", key: "Mod-Alt-i", commandId: "a.one" });
    const afterRegister = registry.version;
    expect(afterRegister).toBeGreaterThan(start);
    expect(() => registry.register({ id: "a.two", key: "Mod-Alt-i", commandId: "a.two" })).toThrow(
      "Ambiguous key binding: Mod-Alt-i",
    );
    expect(registry.version).toBe(afterRegister);
    handle.dispose();
    const afterDispose = registry.version;
    expect(afterDispose).toBeGreaterThan(afterRegister);
    handle.dispose();
    expect(registry.unregister("a.one")).toBe(false);
    expect(registry.version).toBe(afterDispose);
  });
});
