// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoredPlugin } from "../../../src/app/plugins/storage";
import type { CodeMirrorEditorPorts } from "@md-editor/editor-ui";

const state = vi.hoisted(() => ({
  records: [] as unknown[],
  listener: undefined as (() => void) | undefined,
  commands: new Map<string, { run(): unknown }>(),
  keymaps: new Map<string, unknown>(),
}));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false, invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ emit: vi.fn(), listen: vi.fn() }));
vi.mock("../../../src/app/plugins/storage", () => ({
  loadPlugins: async () => structuredClone(state.records),
  savePlugin: async (plugin: StoredPlugin) => {
    const current = (state.records as StoredPlugin[]).find((item) => item.id === plugin.id);
    if (!current || current.revision !== plugin.revision) throw new Error("Stale plugin revision");
    state.records = (state.records as StoredPlugin[]).map((item) =>
      item.id === plugin.id ? { ...plugin, revision: plugin.revision + 1 } : item,
    );
  },
  listenForPluginChanges: async (listener: () => void) => {
    state.listener = listener;
    return () => {
      state.listener = undefined;
    };
  },
}));
vi.mock("../../../src/app/runtime/editor-runtime", () => ({
  runtime: {
    document: {
      getSnapshot: () => ({ markdown: "before", documentGeneration: 2, contentRevision: 3 }),
    },
    commands: {
      register(command: { id: string; run(): unknown }) {
        state.commands.set(command.id, command);
        return { dispose: () => state.commands.delete(command.id) };
      },
    },
    keymaps: {
      register(keymap: { id: string }) {
        state.keymaps.set(keymap.id, keymap);
        return { dispose: () => state.keymaps.delete(keymap.id) };
      },
    },
  },
}));
import { useExternalPlugins } from "../../../src/app/plugins/use-external-plugins";

async function record(id: string, updateSettings = false): Promise<StoredPlugin> {
  const pkg = {
    manifest: { id, name: id, version: "1", description: "test", apiVersion: 1 as const },
    code: `export default { activate(context) {
      context.commands.register({ id: context.manifest.id + '.command', title: 'Command', async run() {
        ${updateSettings ? "await context.settings.update({ enabled: true }); await context.settings.update({ enabled: false });" : ""}
        globalThis.pluginObservation = { settings: context.settings.get(), snapshot: context.editor.getSnapshot() };
        return context.editor.applyEdit({ markdown: 'after', expectedGeneration: 2, expectedContentRevision: 3 });
      }});
      context.keymaps.register({ id: context.manifest.id + '.key', key: 'Mod-Shift-9', commandId: context.manifest.id + '.command' });
    } }`,
    examples: [],
    settings: { enabled: { type: "boolean" as const, label: "Enabled", default: false } },
  };
  const raw = JSON.stringify(pkg);
  const digest = await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  const sha256 = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return {
    id,
    revision: 1,
    enabled: true,
    settings: { enabled: false },
    keymapOverrides: {},
    current: {
      package: pkg,
      raw,
      source: {
        owner: "author",
        repo: "plugins",
        releaseId: 1,
        tag: "v1",
        assetId: 2,
        pluginId: id,
        sha256,
      },
    },
    previous: null,
    pending: null,
  };
}

describe("desktop external plugin lifecycle", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  const edits: unknown[] = [];
  beforeEach(() => {
    state.records = [];
    state.commands.clear();
    state.keymaps.clear();
    edits.length = 0;
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("crypto", webcrypto);
    // Node imports data URLs; the application uses blob URLs in a real browser.
    vi.stubGlobal(
      "Blob",
      class {
        constructor(public parts: string[]) {}
      },
    );
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: (blob: { parts: string[] }) =>
        `data:text/javascript,${encodeURIComponent(blob.parts.join(""))}`,
    });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: () => {} });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    Reflect.deleteProperty(URL, "createObjectURL");
    Reflect.deleteProperty(URL, "revokeObjectURL");
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  it("loads independent contributions, synchronizes settings, applies edits, and cleans up on disable and removal", async () => {
    state.records = [await record("author.one"), await record("author.two")];
    const ports = {
      getSelectionSnapshot: () => ({ anchor: 1, head: 4 }),
      applyExternalEdit: (request: unknown) => {
        edits.push(request);
        return { status: "applied" };
      },
    } as unknown as CodeMirrorEditorPorts;
    function Harness() {
      useExternalPlugins(ports);
      return null;
    }
    await act(async () => {
      root.render(createElement(Harness));
    });
    await vi.waitFor(() => expect(state.commands.size).toBe(2));
    expect(state.keymaps.size).toBe(2);
    state.records = (state.records as StoredPlugin[]).map((item) =>
      item.id === "author.two" ? { ...item, settings: { enabled: true } } : item,
    );
    await act(async () => {
      state.listener?.();
    });
    await vi.waitFor(async () => {
      await state.commands.get("author.two.command")!.run();
      expect(
        (globalThis as unknown as { pluginObservation: { settings: { enabled: boolean } } })
          .pluginObservation.settings.enabled,
      ).toBe(true);
    });
    expect(
      (globalThis as unknown as { pluginObservation: { snapshot: unknown } }).pluginObservation
        .snapshot,
    ).toEqual({
      markdown: "before",
      selection: { anchor: 1, head: 4 },
      documentGeneration: 2,
      contentRevision: 3,
    });
    expect(edits.at(-1)).toMatchObject({
      markdown: "after",
      expectedGeneration: 2,
      expectedContentRevision: 3,
      selection: "preserve-offset-clamped",
    });
    state.records = (state.records as StoredPlugin[]).map((item) =>
      item.id === "author.one" ? { ...item, enabled: false } : item,
    );
    await act(async () => {
      state.listener?.();
    });
    await vi.waitFor(() => expect(state.commands.has("author.one.command")).toBe(false));
    expect(state.commands.has("author.two.command")).toBe(true);
    expect(state.keymaps.has("author.one.key")).toBe(false);
    state.records = (state.records as StoredPlugin[]).map((item) =>
      item.id === "author.one" ? { ...item, settings: { enabled: true } } : item,
    );
    await act(async () => {
      state.listener?.();
    });
    expect(state.commands.has("author.one.command")).toBe(false);
    expect(state.commands.has("author.two.command")).toBe(true);
    state.records = [];
    await act(async () => {
      state.listener?.();
    });
    await vi.waitFor(() => expect(state.commands.size).toBe(0));
    expect(state.keymaps.size).toBe(0);
  });

  it("persists consecutive SDK settings updates before storage events arrive", async () => {
    state.records = [await record("author.settings", true)];
    const ports = {
      getSelectionSnapshot: () => ({ anchor: 0, head: 0 }),
      applyExternalEdit: () => ({ status: "applied" }),
    } as unknown as CodeMirrorEditorPorts;
    function Harness() {
      useExternalPlugins(ports);
      return null;
    }
    await act(async () => root.render(createElement(Harness)));
    await vi.waitFor(() => expect(state.commands.size).toBe(1));
    // No storage event is delivered between these writes, as can happen across windows.
    await state.commands.get("author.settings.command")!.run();
    expect(state.records[0]).toMatchObject({ revision: 3, settings: { enabled: false } });
  });
});
