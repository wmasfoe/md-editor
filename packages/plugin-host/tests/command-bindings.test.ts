import { describe, expect, it, vi } from "vitest";
import { createPluginCommandBindings } from "../src/index.ts";

function setup(bindings: Record<string, Record<string, string>> = {}) {
  const failures = { register: false, settings: false };
  const commands = new Map<string, unknown>();
  const keys = new Map<string, { id: string; key: string; commandId: string }>();
  const registry = createPluginCommandBindings({
    commands: {
      register(command) {
        commands.set(command.id, command);
        return {
          dispose: () => {
            commands.delete(command.id);
          },
        };
      },
    },
    keymaps: {
      register(keymap) {
        if (failures.register) throw new Error("Keymap already registered");
        keys.set(keymap.id, keymap);
        return {
          dispose: () => {
            keys.delete(keymap.id);
          },
        };
      },
      findConflict: (key) => [...keys.values()].find((item) => item.key === key),
    },
    getBindings: (id) => {
      if (failures.settings) throw new Error("Settings unavailable");
      return bindings[id] ?? {};
    },
    validateKey: (key) => (key === "invalid" ? "Invalid key" : null),
    onChange: vi.fn(),
  });
  return { registry, commands, keys, failures };
}
const command = { id: "author.tool.insert", title: "Insert", description: "Insert text", run() {} };

describe("user-owned plugin command bindings", () => {
  it("exposes every command but never binds a suggestion automatically", () => {
    const { registry, keys, commands } = setup();
    registry.commands.register({ ...command, suggestedKey: "Mod-i" }, "author.tool");
    registry.keymaps.register(
      { id: "author.tool.key", commandId: command.id, key: "Mod-j" },
      "author.tool",
    );
    expect(commands.has(command.id)).toBe(true);
    expect(keys.size).toBe(0);
    expect(registry.getStatuses()).toMatchObject([
      { id: command.id, title: "Insert", key: "Mod-i", effectiveKey: null },
    ]);
  });

  it("binds a command without a keymap declaration, restores it and cleans up on disable", () => {
    const { registry, keys } = setup({ "author.tool": { [command.id]: "Mod-i" } });
    const active = registry.commands.register(command, "author.tool");
    expect(keys.get(command.id)?.key).toBe("Mod-i");
    active.dispose();
    expect(keys.size).toBe(0);
    expect(registry.getStatuses()).toEqual([]);
    registry.commands.register(command, "author.tool");
    expect(keys.get(command.id)?.key).toBe("Mod-i");
  });

  it("keeps conflicting or invalid bindings unbound without falling back to suggestions", () => {
    for (const key of ["Mod-s", "invalid"]) {
      const { registry, keys, commands } = setup({ "author.tool": { [command.id]: key } });
      keys.set("builtin.save", { id: "builtin.save", commandId: "builtin.save", key: "Mod-s" });
      registry.commands.register({ ...command, suggestedKey: "Mod-i" }, "author.tool");
      expect(keys.has(command.id)).toBe(false);
      expect(commands.has(command.id)).toBe(true);
      expect(registry.getStatuses()[0]).toMatchObject({
        effectiveKey: null,
        overrideError: { kind: key === "invalid" ? "invalid" : "conflict" },
      });
    }
  });

  it("uses the explicit host owner even when another plugin ID prefixes a command", () => {
    const { registry, keys } = setup({
      "author.tool": { "author.tool.insert.key": "Mod-i" },
      "author.tool.insert": { "author.tool.insert.key": "Mod-x" },
    });
    registry.commands.register(command, "author.tool");
    registry.keymaps.register(
      { id: "author.tool.insert.key", commandId: command.id, key: "Mod-j" },
      "author.tool",
    );
    expect(keys.get(command.id)?.key).toBe("Mod-i");
    expect(registry.getStatuses()[0].pluginId).toBe("author.tool");
  });

  it("isolates runtime registration failures and cleans up the declaration", () => {
    const { registry, failures, commands, keys } = setup({
      "author.tool": { "author.tool.key": "Mod-i" },
    });
    registry.commands.register(command, "author.tool");
    failures.register = true;
    const declaration = registry.keymaps.register(
      { id: "author.tool.key", commandId: command.id, key: "Mod-j" },
      "author.tool",
    );
    expect(commands.has(command.id)).toBe(true);
    expect(keys.size).toBe(0);
    expect(registry.getStatuses()[0]).toMatchObject({
      effectiveKey: null,
      overrideError: { kind: "registration", message: "Keymap already registered" },
    });
    declaration.dispose();
    expect(registry.getStatuses()[0]).toMatchObject({ key: "", legacyIds: [], effectiveKey: null });
  });

  it("rolls back a suggestion when refreshing fails unexpectedly", () => {
    const { registry, failures } = setup();
    registry.commands.register(command, "author.tool");
    failures.settings = true;
    expect(() =>
      registry.keymaps.register(
        { id: "author.tool.failed", commandId: command.id, key: "Mod-i" },
        "author.tool",
      ),
    ).toThrow("Settings unavailable");
    failures.settings = false;
    registry.keymaps.register(
      { id: "author.tool.good", commandId: command.id, key: "Mod-j" },
      "author.tool",
    );
    expect(registry.getStatuses()[0].legacyIds).toEqual(["author.tool.good"]);
  });

  it("supports legacy declaration order and lets an explicit clear override old bindings", () => {
    const bindings = { "author.tool": { "author.tool.key": "Mod-i" } as Record<string, string> };
    const { registry, keys } = setup(bindings);
    const suggestion = registry.keymaps.register(
      { id: "author.tool.key", commandId: command.id, key: "Mod-j" },
      "author.tool",
    );
    const active = registry.commands.register(command, "author.tool");
    expect(keys.get(command.id)?.key).toBe("Mod-i");
    active.dispose();
    bindings["author.tool"][command.id] = "";
    registry.commands.register(command, "author.tool");
    expect(keys.has(command.id)).toBe(false);
    suggestion.dispose();
    expect(registry.getStatuses()[0].key).toBe("");
  });
});
