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
