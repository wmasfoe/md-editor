import { afterEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
  stored: [] as unknown[],
  saved: [] as unknown[],
}));
vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => true,
  invoke: vi.fn(async (command: string, args?: { plugin: unknown }) => {
    if (command === "load_external_plugins") return structuredClone(native.stored);
    if (command === "save_external_plugin") native.saved.push(structuredClone(args!.plugin));
    return undefined;
  }),
}));
vi.mock("@tauri-apps/api/event", () => ({ emit: vi.fn(), listen: vi.fn() }));

import { loadPluginState, savePlugin } from "../../../src/app/plugins/storage";

const source = (pluginId: string) => ({
  owner: "author",
  repo: "plugins",
  releaseId: 1,
  tag: "v1",
  assetId: 2,
  pluginId,
  sha256: "hash",
});
const raw = (id: string) =>
  JSON.stringify({
    manifest: { id, name: id, version: "1.0.0", description: "test", apiVersion: 1 },
    code: "export default {}",
    examples: [],
  });
const record = (id: string, current: { source: unknown; raw: string }) => ({
  id,
  revision: 1,
  enabled: true,
  settings: {},
  keymapOverrides: {},
  current,
  previous: null,
  pending: null,
});

afterEach(() => {
  native.stored = [];
  native.saved = [];
});

describe("external plugin storage", () => {
  it("derives the parsed package from raw bytes on load", async () => {
    native.stored = [
      record("author.one", { source: source("author.one"), raw: raw("author.one") }),
    ];
    const { plugins, unreadable } = await loadPluginState();
    expect(unreadable).toEqual([]);
    expect(plugins[0]?.current.package.manifest.id).toBe("author.one");
  });

  it("persists only source and raw bytes, never the parsed package", async () => {
    native.stored = [
      record("author.one", { source: source("author.one"), raw: raw("author.one") }),
    ];
    const [plugin] = (await loadPluginState()).plugins;
    await savePlugin({ ...plugin!, enabled: false });
    const saved = native.saved[0] as { current: Record<string, unknown> };
    expect(Object.keys(saved.current).toSorted()).toEqual(["raw", "source"]);
  });

  it("isolates a damaged copy so the other plugins still load", async () => {
    native.stored = [
      record("author.broken", { source: source("author.broken"), raw: "not json" }),
      record("author.ok", { source: source("author.ok"), raw: raw("author.ok") }),
    ];
    const { plugins, unreadable } = await loadPluginState();
    expect(plugins.map((plugin) => plugin.id)).toEqual(["author.ok"]);
    expect(unreadable).toEqual([{ id: "author.broken", revision: 1, error: expect.any(String) }]);
  });

  it("keeps the current version when only the rollback copy is damaged", async () => {
    native.stored = [
      {
        ...record("author.one", { source: source("author.one"), raw: raw("author.one") }),
        previous: { source: source("author.one"), raw: "not json" },
      },
    ];
    const { plugins, unreadable } = await loadPluginState();
    expect(unreadable).toEqual([]);
    expect(plugins[0]?.previous).toBeNull();
  });
});
