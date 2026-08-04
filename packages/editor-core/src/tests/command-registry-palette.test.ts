import { describe, expect, it } from "vitest";
import { createCommandRegistry, type CommandContext, type CommandDescriptor } from "../index.ts";

function createContext(): CommandContext {
  return {} as CommandContext;
}

function command(id: string, overrides: Partial<CommandDescriptor> = {}): CommandDescriptor {
  return {
    id,
    title: id,
    run: () => undefined,
    ...overrides,
  };
}

describe("G007 command registry palette 查询", () => {
  it("C1: listByPlacement 只返回声明了该 placement 的命令", () => {
    const registry = createCommandRegistry();
    registry.register(command("cmd.palette", { placement: ["command-palette"] }));
    registry.register(command("cmd.both", { placement: ["toolbar", "command-palette"] }));
    registry.register(command("cmd.none"));

    const palette = registry.listByPlacement("command-palette");
    expect(palette.map((c) => c.id).toSorted()).toEqual(["cmd.both", "cmd.palette"]);
    expect(registry.listByPlacement("toolbar").map((c) => c.id)).toEqual(["cmd.both"]);
    expect(registry.listByPlacement("editor-menu")).toEqual([]);
  });

  it("C2: listAvailable 按 when 过滤(true 保留,false 与异常剔除)", () => {
    const registry = createCommandRegistry();
    registry.register(command("cmd.true", { placement: ["command-palette"], when: () => true }));
    registry.register(command("cmd.false", { placement: ["command-palette"], when: () => false }));
    registry.register(
      command("cmd.throws", {
        placement: ["command-palette"],
        when: () => {
          throw new Error("boom");
        },
      }),
    );
    registry.register(command("cmd.undefined", { placement: ["command-palette"] }));

    const available = registry.listAvailable(createContext());
    expect(available.map((c) => c.id).toSorted()).toEqual(["cmd.true", "cmd.undefined"]);
  });

  it("C2b: placement 过滤 + when 组合", () => {
    const registry = createCommandRegistry();
    registry.register(
      command("cmd.palette.only", { placement: ["command-palette"], when: () => true }),
    );
    registry.register(command("cmd.toolbar.only", { placement: ["toolbar"], when: () => true }));

    const palette = registry.listAvailable(createContext(), "command-palette");
    expect(palette.map((c) => c.id)).toEqual(["cmd.palette.only"]);
  });

  it("C3: 排序按 group 分组、组内按 title 排序", () => {
    const registry = createCommandRegistry();
    registry.register(
      command("cmd.z", { title: "Zulu", group: "Group B", placement: ["command-palette"] }),
    );
    registry.register(
      command("cmd.a", { title: "Alpha", group: "Group A", placement: ["command-palette"] }),
    );
    registry.register(
      command("cmd.b", { title: "Beta", group: "Group A", placement: ["command-palette"] }),
    );

    const available = registry.listAvailable(createContext(), "command-palette");
    const groups = [...new Set(available.map((c) => c.group ?? ""))];
    expect(groups).toEqual(["Group A", "Group B"]);
    // 组内按 title 排序
    const groupA = available.filter((c) => c.group === "Group A").map((c) => c.title);
    expect(groupA).toEqual(["Alpha", "Beta"]);
  });

  it("C6: 无 placement 的命令不进入任何 UI 查询", () => {
    const registry = createCommandRegistry();
    registry.register(command("cmd.hidden"));
    expect(registry.listAvailable(createContext(), "command-palette")).toEqual([]);
    expect(registry.listAvailable(createContext())).toEqual([]);
  });
});
