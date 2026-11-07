import { useTranslation } from "@md-editor/i18n";
import { useCallback, useEffect, useState } from "react";
import {
  createPluginPreviewUrl,
  downloadPlugin,
  getPluginCatalog,
} from "@md-editor/plugin-host/github";
import { emit, listen } from "@tauri-apps/api/event";
import type { PluginStatus } from "@md-editor/plugin-host";
import { isTauri } from "@tauri-apps/api/core";
import { openExternalTarget } from "../../desktop/link-service";
import {
  listenForPluginChanges,
  loadPlugins,
  removePlugin,
  savePlugin,
  type PluginStatusEvent,
  type StoredPlugin,
} from "../../app/plugins/storage";

/** Each install is explicitly selected and trusted by the user before its code is stored. */
export function ExternalPluginSettings() {
  const { t } = useTranslation();
  const [source, setSource] = useState("");
  const [catalog, setCatalog] = useState<Awaited<ReturnType<typeof getPluginCatalog>> | null>(null);
  const [plugins, setPlugins] = useState<StoredPlugin[]>([]);
  const [statuses, setStatuses] = useState<readonly PluginStatus[]>([]);
  const [keymaps, setKeymaps] = useState<PluginStatusEvent["keymaps"]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [updateMessages, setUpdateMessages] = useState<Record<string, string>>({});
  const refresh = useCallback(() => {
    void loadPlugins()
      .then(setPlugins)
      .catch((e) => setError(String(e)));
  }, []);
  useEffect(() => {
    let closed = false;
    let stop: (() => void) | undefined;
    void listenForPluginChanges(refresh).then((fn) => {
      if (closed) fn();
      else {
        stop = fn;
        refresh();
      }
    });
    return () => {
      closed = true;
      stop?.();
    };
  }, [refresh]);
  useEffect(() => {
    if (!isTauri()) return;
    let closed = false;
    let stop: (() => void) | undefined;
    void listen<PluginStatusEvent>("inkpoint:plugin-status", (event) => {
      setStatuses(event.payload.statuses);
      setKeymaps(event.payload.keymaps);
    })
      .then((fn) => {
        if (closed) fn();
        else {
          stop = fn;
          void emit("inkpoint:plugin-status-request").catch((cause: unknown) => {
            setError(cause instanceof Error ? cause.message : String(cause));
          });
        }
      })
      .catch((cause: unknown) => {
        if (!closed) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      closed = true;
      stop?.();
    };
  }, []);
  const perform = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await action();
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="mt-6 grid gap-3" aria-labelledby="external-plugins-title">
      <div>
        <h2 id="external-plugins-title" className="text-sm font-semibold">
          {t("pluginPreview.externalTitle")}
        </h2>
        <p className="text-xs text-[var(--theme-muted)]">{t("pluginPreview.trust")}</p>
      </div>
      {!isTauri() ? (
        <p>{t("pluginPreview.desktopOnly")}</p>
      ) : (
        <>
          <div className="flex gap-2">
            <label className="sr-only" htmlFor="plugin-repository">
              {t("pluginPreview.source")}
            </label>
            <input
              id="plugin-repository"
              className="min-w-0 flex-1 rounded border border-[var(--theme-border)] bg-transparent px-2 py-1"
              placeholder={t("pluginPreview.sourcePlaceholder")}
              value={source}
              onChange={(e) => setSource(e.target.value)}
            />
            <button
              disabled={busy || !source.trim()}
              onClick={() => void perform(async () => setCatalog(await getPluginCatalog(source)))}
            >
              {t("pluginPreview.showPlugins")}
            </button>
          </div>
          {catalog && (
            <div className="grid gap-2">
              {catalog.plugins.map((entry) => (
                <div
                  key={entry.id}
                  className="rounded border border-[var(--theme-border)] p-3 text-sm"
                >
                  <strong>{entry.name}</strong> · {entry.version}
                  <p>{entry.description}</p>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void perform(async () => {
                        const version = await downloadPlugin(catalog, entry.id);
                        const existing = plugins.find((p) => p.id === entry.id);
                        if (
                          existing &&
                          (existing.current.source.owner.toLowerCase() !==
                            version.source.owner.toLowerCase() ||
                            existing.current.source.repo.toLowerCase() !==
                              version.source.repo.toLowerCase())
                        )
                          throw new Error(t("pluginPreview.otherRepository"));
                        if (existing?.current.source.sha256 === version.source.sha256) {
                          setUpdateMessages((messages) => ({
                            ...messages,
                            [entry.id]: t("pluginPreview.currentVersion"),
                          }));
                          return;
                        }
                        await savePlugin(
                          existing
                            ? { ...existing, pending: version }
                            : {
                                id: entry.id,
                                revision: 0,
                                enabled: true,
                                settings: {},
                                keymapOverrides: {},
                                current: version,
                                previous: null,
                                pending: null,
                              },
                        );
                      })
                    }
                  >
                    {plugins.some((p) => p.id === entry.id)
                      ? t("pluginPreview.downloadUpdate")
                      : t("pluginPreview.install")}
                  </button>
                  <button
                    disabled={busy}
                    className="ml-3"
                    onClick={() =>
                      void perform(async () => {
                        const version = await downloadPlugin(catalog, entry.id);
                        await openExternalTarget(createPluginPreviewUrl(version.source));
                      })
                    }
                  >
                    {t("pluginPreview.onlinePreview")}
                  </button>
                </div>
              ))}
            </div>
          )}
          {plugins.length > 0 && (
            <button
              disabled={busy}
              className="justify-self-start"
              onClick={() =>
                void perform(async () => {
                  for (const plugin of plugins) await savePlugin({ ...plugin, enabled: false });
                })
              }
            >
              {t("pluginPreview.disableAll")}
            </button>
          )}
          {plugins.map((plugin) => (
            <div
              key={plugin.id}
              className="grid gap-2 rounded border border-[var(--theme-border)] p-3 text-sm"
            >
              <div>
                <strong>{plugin.current.package.manifest.name}</strong> ·{" "}
                {plugin.current.package.manifest.version}{" "}
                <span className="text-[var(--theme-muted)]">
                  {plugin.current.source.owner}/{plugin.current.source.repo}
                  {statuses.find((status) => status.id === plugin.id)?.status === "active" &&
                    ` · ${t("pluginPreview.active")}`}
                  {statuses.find((status) => status.id === plugin.id)?.status === "loading" &&
                    ` · ${t("pluginPreview.loading")}`}
                  {statuses.find((status) => status.id === plugin.id)?.status === "error" && (
                    <span role="alert">
                      {" "}
                      · {t("pluginPreview.failed")}：
                      {statuses.find((status) => status.id === plugin.id)?.error ??
                        t("pluginPreview.unknown")}
                    </span>
                  )}
                </span>
              </div>
              <div className="flex flex-wrap gap-3">
                <label>
                  <input
                    type="checkbox"
                    checked={plugin.enabled}
                    disabled={busy}
                    onChange={(e) =>
                      void perform(() => savePlugin({ ...plugin, enabled: e.target.checked }))
                    }
                  />{" "}
                  {t("pluginPreview.enabled")}
                </label>
                <button
                  disabled={busy}
                  onClick={() =>
                    void perform(async () => {
                      const latest = await getPluginCatalog(
                        `${plugin.current.source.owner}/${plugin.current.source.repo}`,
                      );
                      if (!latest.plugins.some((entry) => entry.id === plugin.id)) {
                        setUpdateMessages((messages) => ({
                          ...messages,
                          [plugin.id]: t("pluginPreview.notListed"),
                        }));
                        return;
                      }
                      const version = await downloadPlugin(latest, plugin.id);
                      if (version.source.sha256 === plugin.current.source.sha256) {
                        setUpdateMessages((messages) => ({
                          ...messages,
                          [plugin.id]: t("pluginPreview.currentVersion"),
                        }));
                        return;
                      }
                      await savePlugin({ ...plugin, pending: version });
                      setUpdateMessages((messages) => ({
                        ...messages,
                        [plugin.id]: t("pluginPreview.updateDownloaded"),
                      }));
                    })
                  }
                >
                  {t("pluginPreview.checkUpdates")}
                </button>
                <button
                  disabled={busy || !plugin.previous}
                  onClick={() =>
                    void perform(() =>
                      savePlugin({
                        ...plugin,
                        current: plugin.previous!,
                        previous: plugin.current,
                        pending: null,
                      }),
                    )
                  }
                >
                  {t("pluginPreview.rollback")}
                </button>
                <button
                  disabled={busy}
                  onClick={() => void perform(() => removePlugin(plugin.id, plugin.revision))}
                >
                  {t("pluginPreview.remove")}
                </button>
                {plugin.pending && <span>{t("pluginPreview.pending")}</span>}
                {updateMessages[plugin.id] && (
                  <span role="status">{updateMessages[plugin.id]}</span>
                )}
              </div>
              {keymaps
                .filter((keymap) => keymap.pluginId === plugin.id)
                .map((keymap) => (
                  <label key={keymap.id} className="flex items-center gap-2">
                    {t("pluginPreview.shortcut")} {keymap.id}
                    <input
                      defaultValue={plugin.keymapOverrides?.[keymap.id] ?? keymap.key}
                      onBlur={(event) =>
                        void perform(() =>
                          savePlugin({
                            ...plugin,
                            keymapOverrides: {
                              ...plugin.keymapOverrides,
                              [keymap.id]: event.target.value || keymap.key,
                            },
                          }),
                        )
                      }
                    />
                  </label>
                ))}
              {Object.entries(plugin.current.package.settings ?? {}).map(([key, definition]) => (
                <label key={key} className="flex items-center gap-2">
                  {definition.label}
                  {definition.type === "boolean" ? (
                    <input
                      type="checkbox"
                      checked={Boolean(plugin.settings[key] ?? definition.default)}
                      onChange={(e) =>
                        void perform(() =>
                          savePlugin({
                            ...plugin,
                            settings: { ...plugin.settings, [key]: e.target.checked },
                          }),
                        )
                      }
                    />
                  ) : definition.type === "enum" ? (
                    <select
                      value={String(plugin.settings[key] ?? definition.default)}
                      onChange={(e) =>
                        void perform(() =>
                          savePlugin({
                            ...plugin,
                            settings: { ...plugin.settings, [key]: e.target.value },
                          }),
                        )
                      }
                    >
                      {definition.values.map((value) => (
                        <option key={value}>{value}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type={definition.type === "number" ? "number" : "text"}
                      defaultValue={String(plugin.settings[key] ?? definition.default)}
                      onBlur={(e) =>
                        void perform(() =>
                          savePlugin({
                            ...plugin,
                            settings: {
                              ...plugin.settings,
                              [key]:
                                definition.type === "number"
                                  ? Number(e.target.value)
                                  : e.target.value,
                            },
                          }),
                        )
                      }
                    />
                  )}
                </label>
              ))}
            </div>
          ))}
        </>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
    </section>
  );
}
