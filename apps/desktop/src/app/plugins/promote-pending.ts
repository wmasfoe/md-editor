import type { StoredPlugin } from "./storage";

/** Apply only each plugin's own queued version, and never during recovery startup. */
export async function promotePendingPlugins(
  plugins: readonly StoredPlugin[],
  safeStart: boolean,
  save: (plugin: StoredPlugin) => Promise<void>,
): Promise<void> {
  if (safeStart) return;
  for (const plugin of plugins) {
    if (plugin.pending) {
      await save({ ...plugin, previous: plugin.current, current: plugin.pending, pending: null });
    }
  }
}
