import { invoke, isTauri } from "@tauri-apps/api/core";
import type { PluginPackage, PluginSettingValue } from "@md-editor/plugin-sdk";
import type { PluginStatus } from "@md-editor/plugin-host";
import type { PluginSource } from "@md-editor/plugin-host/github";

export interface PluginStatusEvent {
  readonly statuses: readonly PluginStatus[];
  readonly keymaps: readonly {
    readonly id: string;
    readonly key: string;
    readonly pluginId: string;
  }[];
}

export interface PluginVersion {
  readonly source: PluginSource;
  readonly package: PluginPackage;
  readonly raw: string;
}
export interface StoredPlugin {
  readonly id: string;
  readonly revision: number;
  readonly enabled: boolean;
  readonly settings: Readonly<Record<string, PluginSettingValue>>;
  readonly keymapOverrides: Readonly<Record<string, string>>;
  readonly current: PluginVersion;
  readonly previous: PluginVersion | null;
  readonly pending: PluginVersion | null;
}

const EVENT = "inkpoint:external-plugins-changed";
export async function loadPlugins(): Promise<StoredPlugin[]> {
  return isTauri() ? invoke<StoredPlugin[]>("load_external_plugins") : [];
}
export async function savePlugin(plugin: StoredPlugin): Promise<void> {
  await invoke("save_external_plugin", { plugin });
  await notifyChange();
}
export async function removePlugin(id: string, revision: number): Promise<void> {
  await invoke("remove_external_plugin", { id, revision });
  await notifyChange();
}
async function notifyChange(): Promise<void> {
  if (isTauri()) {
    const { emit } = await import("@tauri-apps/api/event");
    await emit(EVENT);
  }
}
export async function listenForPluginChanges(callback: () => void): Promise<() => void> {
  if (!isTauri()) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  return listen(EVENT, callback);
}
