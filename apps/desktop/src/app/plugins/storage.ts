import { invoke, isTauri } from "@tauri-apps/api/core";
import type { PluginPackage, PluginSettingValue } from "@md-editor/plugin-sdk";
import {
  validatePluginPackage,
  type PluginStatus,
  type PluginCommandBinding,
} from "@md-editor/plugin-host";
import type { PluginSource } from "@md-editor/plugin-host/github";

export interface PluginStatusEvent {
  readonly statuses: readonly PluginStatus[];
  readonly keymaps: readonly PluginCommandBinding[];
  readonly occupiedKeys: readonly { readonly id: string; readonly key: string }[];
}

/**
 * 内存中的插件版本。`package` 由 `raw` 解析而来，只用于界面展示和比对；
 * 原生存储只持久化 `source` 与 `raw`，见 `toStoredVersion`。
 */
export interface PluginVersion {
  readonly source: PluginSource;
  readonly package: PluginPackage;
  readonly raw: string;
}

/** 原生存储中的版本形态：不含可由 `raw` 推导的 `package`，避免同一份内容存两遍。 */
interface PersistedVersion {
  readonly source: PluginSource;
  readonly raw: string;
}
type PersistedPlugin = Omit<StoredPlugin, "current" | "previous" | "pending"> & {
  readonly current: PersistedVersion;
  readonly previous: PersistedVersion | null;
  readonly pending: PersistedVersion | null;
};

function toStoredVersion({ source, raw }: PluginVersion): PersistedVersion {
  return { source, raw };
}

/**
 * 解析存储里的原始字节。这里只做结构校验以便界面展示；执行前 `verifyStoredPlugin`
 * 仍会重新核对摘要与清单，解析成功不代表可以执行。
 */
function fromStoredVersion(version: PersistedVersion): PluginVersion {
  return { ...version, package: validatePluginPackage(JSON.parse(version.raw)) };
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
/** 本地副本无法解析的插件。单独列出，供设置页提示并移除，不阻塞其他插件加载。 */
export interface UnreadablePlugin {
  readonly id: string;
  readonly revision: number;
  readonly error: string;
}

/**
 * 读取全部插件。任一插件的本地副本损坏时只把它归入 `unreadable`，其余插件照常返回，
 * 否则一份坏数据会让所有外部插件都无法加载，用户也无法在设置页里移除它。
 */
export async function loadPluginState(): Promise<{
  plugins: StoredPlugin[];
  unreadable: UnreadablePlugin[];
}> {
  if (!isTauri()) return { plugins: [], unreadable: [] };
  const persisted = await invoke<PersistedPlugin[]>("load_external_plugins");
  const plugins: StoredPlugin[] = [];
  const unreadable: UnreadablePlugin[] = [];
  for (const plugin of persisted) {
    try {
      plugins.push({
        ...plugin,
        current: fromStoredVersion(plugin.current),
        // 旧版本损坏只影响回退，不应让当前可用的版本也失效。
        previous: plugin.previous && tryFromStoredVersion(plugin.previous),
        pending: plugin.pending && tryFromStoredVersion(plugin.pending),
      });
    } catch (error) {
      unreadable.push({
        id: plugin.id,
        revision: plugin.revision,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { plugins, unreadable };
}

function tryFromStoredVersion(version: PersistedVersion): PluginVersion | null {
  try {
    return fromStoredVersion(version);
  } catch {
    return null;
  }
}

export async function loadPlugins(): Promise<StoredPlugin[]> {
  return (await loadPluginState()).plugins;
}
export async function savePlugin(plugin: StoredPlugin): Promise<void> {
  const persisted: PersistedPlugin = {
    ...plugin,
    current: toStoredVersion(plugin.current),
    previous: plugin.previous && toStoredVersion(plugin.previous),
    pending: plugin.pending && toStoredVersion(plugin.pending),
  };
  await invoke("save_external_plugin", { plugin: persisted });
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
