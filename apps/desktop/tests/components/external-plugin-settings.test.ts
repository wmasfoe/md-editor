// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { ExternalPluginCardProps } from "../../src/components/settings/ExternalPluginCard";
import type { PluginStatusEvent, StoredPlugin } from "../../src/app/plugins/storage";

const state = vi.hoisted(() => ({
  plugin: null as StoredPlugin | null,
  card: null as ExternalPluginCardProps | null,
  onStatus: undefined as ((event: { payload: PluginStatusEvent }) => void) | undefined,
  save: vi.fn(),
}));
vi.mock("@md-editor/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn(async () => {}),
  listen: vi.fn(async (name: string, callback: typeof state.onStatus) => {
    if (name === "inkpoint:plugin-status") state.onStatus = callback;
    return () => {};
  }),
}));
vi.mock("../../src/app/plugins/storage", () => ({
  loadPluginState: async () => ({ plugins: [state.plugin], unreadable: [] }),
  listenForPluginChanges: async () => () => {},
  savePlugin: async (plugin: StoredPlugin) => {
    state.save(plugin);
    state.plugin = plugin;
  },
  removePlugin: vi.fn(),
}));
vi.mock("../../src/components/settings/ExternalPluginCard", () => ({
  ExternalPluginCard: (props: ExternalPluginCardProps) => {
    state.card = props;
    return null;
  },
}));
vi.mock("../../src/components/settings/PluginInstallConfirmDialog", () => ({
  PluginInstallConfirmDialog: () => null,
}));
import { ExternalPluginSettings } from "../../src/components/settings/ExternalPluginSettings";

let cleanup: (() => void) | undefined;
afterEach(() => {
  cleanup?.();
  state.save.mockClear();
  vi.unstubAllGlobals();
});
it("rejects occupied keys before saving, migrates legacy bindings, and allows clearing", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.plugin = {
    id: "author.tool",
    enabled: true,
    keymapOverrides: { "author.tool.key": "Mod-i" },
    current: {
      package: { manifest: { name: "Tool", version: "1" } },
      source: { owner: "author", repo: "tool" },
    },
  } as unknown as StoredPlugin;
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  cleanup = () => {
    act(() => root.unmount());
    container.remove();
  };
  await act(async () => root.render(createElement(ExternalPluginSettings)));
  const command = {
    id: "author.tool.insert",
    pluginId: "author.tool",
    title: "Insert",
    key: "Mod-j",
    legacyIds: ["author.tool.key"],
    effectiveKey: "Mod-i",
  };
  await act(async () =>
    state.onStatus?.({
      payload: {
        statuses: [{ id: "author.tool", status: "active" }],
        keymaps: [command],
        occupiedKeys: [
          { id: "builtin.save", key: "Mod-s" },
          { id: command.id, key: "Mod-i" },
        ],
      },
    }),
  );
  await act(async () => state.card!.onShortcutCommit(command, "Mod-s"));
  expect(state.save).not.toHaveBeenCalled();
  expect(state.card!.shortcutErrors[command.id]).toContain("builtin.save");
  await act(async () => state.card!.onShortcutCommit(command, "Ctrl-x"));
  expect(state.save).not.toHaveBeenCalled();
  await act(async () => state.card!.onShortcutCommit(command, "Mod-k"));
  expect(state.plugin!.keymapOverrides).toEqual({ [command.id]: "Mod-k" });
  await act(async () => state.card!.onShortcutCommit(command, ""));
  expect(state.plugin!.keymapOverrides).toEqual({});
});
