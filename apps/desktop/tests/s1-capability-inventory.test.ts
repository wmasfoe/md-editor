import { describe, expect, it } from "vitest";
import {
  S1_CAPABILITY_INVENTORY,
  S1_REMOVED_COMMAND_IDS,
  S1_REGISTERED_COMMAND_IDS,
  getS1CapabilityInventory,
} from "../src/app/s1-capability-inventory";
import { runtime } from "../src/app/runtime/editor-runtime";

describe("S1 capability inventory", () => {
  it("covers every command currently registered by the desktop runtime", () => {
    const runtimeCommandIds = runtime.commands
      .list()
      .map((command) => command.id)
      .toSorted();
    const inventoryCommandIds = S1_CAPABILITY_INVENTORY.filter((entry) => entry.kind === "command")
      .map((entry) => entry.id)
      .toSorted();

    expect(runtimeCommandIds).toEqual(S1_REGISTERED_COMMAND_IDS.toSorted());
    expect(inventoryCommandIds).toEqual(
      [...S1_REGISTERED_COMMAND_IDS, ...S1_REMOVED_COMMAND_IDS].toSorted(),
    );
  });

  it("assigns one explicit S1 disposition to every unique capability", () => {
    const ids = S1_CAPABILITY_INVENTORY.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(
      S1_CAPABILITY_INVENTORY.every((entry) =>
        // new-capability：S1 基线之后新增（D-3 块操作 / D-2 视图模式）——
        // “retained” 暗示基线已存在，对新能力是失实来源（code-review LOW）
        ["retained", "removed-disabled", "typed-unsupported", "new-capability"].includes(
          entry.s1Disposition,
        ),
      ),
    ).toBe(true);
  });

  /**
   * 账本自证不变量：登记为 `typed-unsupported` 的命令，必须真的不在 runtime 里注册。
   *
   * 反之，只要命令能在 `runtime.commands.list()` 里查到，就说明宿主提供了 action，
   * 它不可能“只返回 typed unsupported”。历史漂移正是这个矛盾：三个命令既在 registry 里
   * 可派发，又被登记为 typed-unsupported，账本因而说谎。
   */
  it("never marks a runtime-registered command as typed-unsupported", () => {
    const runtimeIds = new Set(runtime.commands.list().map((command) => command.id));
    const lying = S1_CAPABILITY_INVENTORY.filter(
      (entry) => entry.s1Disposition === "typed-unsupported" && runtimeIds.has(entry.id),
    ).map((entry) => entry.id);
    expect(lying).toEqual([]);
  });

  /**
   * 反向不变量：登记为 `removed-disabled` 的命令，不得仍然可派发。
   * 否则“已移除”的审计记录会与真实注册表冲突。
   */
  it("never leaves a removed-disabled command registered in the runtime", () => {
    const runtimeIds = new Set(runtime.commands.list().map((command) => command.id));
    const stale = S1_CAPABILITY_INVENTORY.filter(
      (entry) =>
        entry.kind === "command" &&
        entry.s1Disposition === "removed-disabled" &&
        runtimeIds.has(entry.id),
    ).map((entry) => entry.id);
    expect(stale).toEqual([]);
  });

  it("removes baseline formatting no-ops without losing their immutable audit record", () => {
    const snapshot = getS1CapabilityInventory();
    const removedEntries = snapshot.filter((entry) => entry.id.startsWith("format."));
    expect(removedEntries.map((entry) => entry.id).toSorted()).toEqual(
      [...S1_REMOVED_COMMAND_IDS].toSorted(),
    );
    expect(
      removedEntries.every(
        (entry) =>
          entry.baseline === "silent-noop-blocker" && entry.s1Disposition === "removed-disabled",
      ),
    ).toBe(true);
    expect(runtime.commands.list().some((command) => command.id.startsWith("format."))).toBe(false);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot[0])).toBe(true);
    expect(snapshot).not.toBe(S1_CAPABILITY_INVENTORY);
  });
});
