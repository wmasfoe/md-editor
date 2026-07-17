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
        ["retained", "removed-disabled", "typed-unsupported"].includes(entry.s1Disposition),
      ),
    ).toBe(true);
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
