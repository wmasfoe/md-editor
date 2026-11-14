// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  ExternalPluginCard,
  type ExternalPluginCardProps,
} from "../../src/components/settings/ExternalPluginCard";
import type { StoredPlugin } from "../../src/app/plugins/storage";

vi.mock("@md-editor/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
function props(): ExternalPluginCardProps {
  return {
    plugin: {
      id: "author.tool",
      enabled: true,
      keymapOverrides: {},
      current: {
        package: { manifest: { name: "Tool", version: "1" } },
        source: { owner: "author", repo: "tool" },
      },
    } as unknown as StoredPlugin,
    status: { id: "author.tool", status: "active" },
    keymaps: [
      {
        id: "author.tool.insert",
        pluginId: "author.tool",
        title: "Insert text",
        key: "Mod-i",
        legacyIds: [],
        effectiveKey: null,
      },
    ],
    shortcutErrors: {},
    updateMessage: undefined,
    busy: false,
    onToggle: vi.fn(),
    onCheckUpdates: vi.fn(),
    onRollback: vi.fn(),
    onRemove: vi.fn(),
    onShortcutCommit: vi.fn(),
    onSettingChange: vi.fn(),
  };
}
it("shows suggestions separately from the empty binding and clears an existing binding", () => {
  const initial = props();
  act(() => root.render(createElement(ExternalPluginCard, initial)));
  const input = container.querySelector(
    'input[type="text"], input:not([type])',
  ) as HTMLInputElement;
  expect(input.value).toBe("");
  expect(container.textContent).toContain("pluginPreview.shortcutSuggestedMod-i");
  const bound = {
    ...initial,
    plugin: { ...initial.plugin, keymapOverrides: { "author.tool.insert": "Mod-j" } },
  };
  act(() => root.render(createElement(ExternalPluginCard, bound)));
  expect(input.value).toBe("Mod-j");
  const clear = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === "pluginPreview.shortcutClear",
  )!;
  act(() => clear.click());
  expect(initial.onShortcutCommit).toHaveBeenCalledWith(initial.keymaps[0], "");
  expect(input.value).toBe("");
});
it("keeps removed command bindings visible for cleanup", () => {
  const initial = props();
  initial.plugin = { ...initial.plugin, keymapOverrides: { "author.tool.removed": "Mod-x" } };
  act(() => root.render(createElement(ExternalPluginCard, initial)));
  expect(container.textContent).toContain("pluginPreview.shortcutUnavailable");
  const inputs = [...container.querySelectorAll("input")];
  expect(inputs.some((input) => input.value === "Mod-x")).toBe(true);
});
