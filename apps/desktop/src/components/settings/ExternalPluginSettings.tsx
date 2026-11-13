import {
  ArrowTopRightOnSquareIcon,
  ExclamationTriangleIcon,
  PuzzlePieceIcon,
} from "@heroicons/react/24/outline";
import { validateKeymapKey } from "@md-editor/core";
import {
  PluginCard,
  pluginBadgeClassName,
  pluginCodeChipClassName,
  settingsDangerTextButtonClassName,
  settingsDescriptionClassName,
  settingsErrorNoticeClassName,
  settingsInputClassName,
  settingsModuleClassName,
  settingsPrimarySmallButtonClassName,
  settingsSectionTitleClassName,
  settingsSmallButtonClassName,
  settingsTextButtonClassName,
} from "@md-editor/app-ui/settings";
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
  loadPluginState,
  removePlugin,
  savePlugin,
  type PluginStatusEvent,
  type PluginVersion,
  type StoredPlugin,
  type UnreadablePlugin,
} from "../../app/plugins/storage";
import { PluginInstallConfirmDialog } from "./PluginInstallConfirmDialog";
import { ExternalPluginCard } from "./ExternalPluginCard";

/** 外部插件区内的分组小标题，与快捷键面板的分组标题一致。 */
const groupTitleClassName = "m-0 text-xs font-medium text-[var(--theme-muted)]";

/** Each install is explicitly selected and trusted by the user before its code is stored. */
export function ExternalPluginSettings() {
  const { t } = useTranslation();
  const [source, setSource] = useState("");
  const [catalog, setCatalog] = useState<Awaited<ReturnType<typeof getPluginCatalog>> | null>(null);
  const [plugins, setPlugins] = useState<StoredPlugin[]>([]);
  const [statuses, setStatuses] = useState<readonly PluginStatus[]>([]);
  const [keymaps, setKeymaps] = useState<PluginStatusEvent["keymaps"]>([]);
  const [occupiedKeys, setOccupiedKeys] = useState<PluginStatusEvent["occupiedKeys"]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [updateMessages, setUpdateMessages] = useState<Record<string, string>>({});
  // 已下载并校验、但尚未得到用户信任确认的首次安装。确认前不写入存储，也就不会执行。
  const [pendingInstall, setPendingInstall] = useState<PluginVersion | null>(null);
  // 快捷键输入框的本地格式错误，按 keymap id 记录；冲突由主窗口在真实注册表上判断后回传。
  const [shortcutErrors, setShortcutErrors] = useState<Record<string, string>>({});
  const [unreadable, setUnreadable] = useState<UnreadablePlugin[]>([]);
  const refresh = useCallback(() => {
    void loadPluginState()
      .then((state) => {
        setPlugins(state.plugins);
        setUnreadable(state.unreadable);
      })
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
      setOccupiedKeys(event.payload.occupiedKeys);
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
  const findExisting = (pluginId: string) => plugins.find((p) => p.id === pluginId);
  const setUpdateMessage = (pluginId: string, message: string) =>
    setUpdateMessages((messages) => ({ ...messages, [pluginId]: message }));

  /** 从目录安装或更新：首次安装进入信任确认，已安装的同仓库插件放入待生效版本。 */
  const installFromCatalog = (pluginId: string) =>
    void perform(async () => {
      if (!catalog) return;
      const version = await downloadPlugin(catalog, pluginId);
      const existing = findExisting(pluginId);
      if (
        existing &&
        (existing.current.source.owner.toLowerCase() !== version.source.owner.toLowerCase() ||
          existing.current.source.repo.toLowerCase() !== version.source.repo.toLowerCase())
      )
        throw new Error(t("pluginPreview.otherRepository"));
      if (existing?.current.source.sha256 === version.source.sha256) {
        setUpdateMessage(pluginId, t("pluginPreview.currentVersion"));
        return;
      }
      if (existing) {
        // 更新来自已信任的同一仓库，先放入待生效版本，下次启动才执行。
        await savePlugin({ ...existing, pending: version });
        return;
      }
      setPendingInstall(version);
    });

  const previewFromCatalog = (pluginId: string) =>
    void perform(async () => {
      if (!catalog) return;
      const version = await downloadPlugin(catalog, pluginId);
      await openExternalTarget(createPluginPreviewUrl(version.source));
    });

  const checkUpdates = (plugin: StoredPlugin) =>
    void perform(async () => {
      const latest = await getPluginCatalog(
        `${plugin.current.source.owner}/${plugin.current.source.repo}`,
      );
      if (!latest.plugins.some((entry) => entry.id === plugin.id)) {
        setUpdateMessage(plugin.id, t("pluginPreview.notListed"));
        return;
      }
      const version = await downloadPlugin(latest, plugin.id);
      if (version.source.sha256 === plugin.current.source.sha256) {
        setUpdateMessage(plugin.id, t("pluginPreview.currentVersion"));
        return;
      }
      await savePlugin({ ...plugin, pending: version });
      setUpdateMessage(plugin.id, t("pluginPreview.updateDownloaded"));
    });

  const commitShortcut = (
    plugin: StoredPlugin,
    keymap: PluginStatusEvent["keymaps"][number],
    value: string,
  ) => {
    // 独立设置窗口使用主窗口回传的占用快照预检；主窗口实际注册时仍会再次检查。
    const conflict = value
      ? occupiedKeys.find((item) => item.key === value && item.id !== keymap.id)
      : undefined;
    const formatError = value ? validateKeymapKey(value) : null;
    const invalid = formatError
      ? `${t("pluginPreview.shortcutInvalid")}${formatError}`
      : conflict
        ? `${t("pluginPreview.shortcutConflict")}${conflict.id}`
        : null;
    setShortcutErrors((errors) => {
      const next = { ...errors };
      if (invalid) next[keymap.id] = invalid;
      else delete next[keymap.id];
      return next;
    });
    if (invalid) return;
    const saved =
      plugin.keymapOverrides[keymap.id] ??
      keymap.legacyIds.map((id) => plugin.keymapOverrides[id]).find((key) => key !== undefined) ??
      "";
    if (value === saved) return;
    const overrides = { ...plugin.keymapOverrides };
    // Saving a command binding also migrates explicit choices from old keymap IDs.
    for (const id of keymap.legacyIds) delete overrides[id];
    if (value) overrides[keymap.id] = value;
    else delete overrides[keymap.id];
    if (JSON.stringify(overrides) === JSON.stringify(plugin.keymapOverrides)) return;
    void perform(() =>
      savePlugin({
        ...plugin,
        keymapOverrides: overrides,
      }),
    );
  };

  const hasInstalled = plugins.length > 0 || unreadable.length > 0;

  return (
    <section
      className={`${settingsModuleClassName} mt-4 grid gap-4`}
      aria-labelledby="external-plugins-title"
    >
      <div>
        <h2 id="external-plugins-title" className={settingsSectionTitleClassName}>
          {t("pluginPreview.externalTitle")}
        </h2>
        <p className={settingsDescriptionClassName}>{t("pluginPreview.trust")}</p>
      </div>
      {!isTauri() ? (
        <p className="m-0 rounded-lg border border-dashed border-[var(--theme-border-strong)] bg-[var(--theme-chrome)]/30 px-4 py-3 text-xs text-[var(--theme-muted)]">
          {t("pluginPreview.desktopOnly")}
        </p>
      ) : (
        <>
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (busy || !source.trim()) return;
              void perform(async () => setCatalog(await getPluginCatalog(source)));
            }}
          >
            <label className="sr-only" htmlFor="plugin-repository">
              {t("pluginPreview.source")}
            </label>
            <input
              id="plugin-repository"
              className={`${settingsInputClassName} min-w-0 flex-1`}
              placeholder={t("pluginPreview.sourcePlaceholder")}
              value={source}
              onChange={(e) => setSource(e.target.value)}
            />
            <button
              type="submit"
              className={settingsSmallButtonClassName}
              disabled={busy || !source.trim()}
            >
              {t("pluginPreview.showPlugins")}
            </button>
          </form>

          {catalog && (
            <div className="grid gap-2">
              <h3 className={groupTitleClassName}>
                {t("pluginPreview.catalogTitle")}
                <span className="ml-1.5 font-mono font-normal">
                  {catalog.owner}/{catalog.repo} · {catalog.tag}
                </span>
              </h3>
              {catalog.plugins.length === 0 ? (
                <p className="m-0 text-xs text-[var(--theme-muted)]">
                  {t("pluginPreview.catalogEmpty")}
                </p>
              ) : (
                <div className="grid gap-2.5">
                  {catalog.plugins.map((entry) => {
                    const installed = Boolean(findExisting(entry.id));
                    return (
                      <PluginCard
                        key={entry.id}
                        icon={
                          <PuzzlePieceIcon
                            className="size-4 text-[var(--theme-muted)]"
                            aria-hidden="true"
                          />
                        }
                        title={entry.name}
                        badges={
                          <>
                            <span className={pluginBadgeClassName}>{entry.version}</span>
                            {installed && (
                              <span className={pluginBadgeClassName}>
                                {t("pluginPreview.installedBadge")}
                              </span>
                            )}
                          </>
                        }
                        description={entry.description}
                        meta={<span className={pluginCodeChipClassName}>{entry.id}</span>}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            className={
                              installed
                                ? settingsSmallButtonClassName
                                : settingsPrimarySmallButtonClassName
                            }
                            disabled={busy}
                            onClick={() => installFromCatalog(entry.id)}
                          >
                            {installed
                              ? t("pluginPreview.downloadUpdate")
                              : t("pluginPreview.install")}
                          </button>
                          <button
                            type="button"
                            className={settingsTextButtonClassName}
                            disabled={busy}
                            onClick={() => previewFromCatalog(entry.id)}
                          >
                            {t("pluginPreview.onlinePreview")}
                            <ArrowTopRightOnSquareIcon className="size-3.5" aria-hidden="true" />
                          </button>
                          {updateMessages[entry.id] && (
                            <span role="status" className="text-xs text-[var(--theme-muted)]">
                              {updateMessages[entry.id]}
                            </span>
                          )}
                        </div>
                      </PluginCard>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {hasInstalled && (
            <div className="grid gap-2">
              <div className="flex items-center justify-between gap-3">
                <h3 className={groupTitleClassName}>{t("pluginPreview.installedTitle")}</h3>
                {plugins.some((plugin) => plugin.enabled) && (
                  <button
                    type="button"
                    className={settingsTextButtonClassName}
                    disabled={busy}
                    onClick={() =>
                      void perform(async () => {
                        for (const plugin of plugins)
                          await savePlugin({ ...plugin, enabled: false });
                      })
                    }
                  >
                    {t("pluginPreview.disableAll")}
                  </button>
                )}
              </div>
              <div className="grid gap-2.5">
                {unreadable.map((item) => (
                  <PluginCard
                    key={item.id}
                    icon={
                      <ExclamationTriangleIcon
                        className="size-4 text-[var(--theme-danger-text)]"
                        aria-hidden="true"
                      />
                    }
                    title={item.id}
                    description={
                      <span role="alert">
                        {t("pluginPreview.unreadable")}：{item.error}
                      </span>
                    }
                    trailing={
                      <button
                        type="button"
                        className={settingsDangerTextButtonClassName}
                        disabled={busy}
                        onClick={() => void perform(() => removePlugin(item.id, item.revision))}
                      >
                        {t("pluginPreview.remove")}
                      </button>
                    }
                  />
                ))}
                {plugins.map((plugin) => (
                  <ExternalPluginCard
                    key={plugin.id}
                    plugin={plugin}
                    status={statuses.find((status) => status.id === plugin.id)}
                    keymaps={keymaps.filter((keymap) => keymap.pluginId === plugin.id)}
                    shortcutErrors={shortcutErrors}
                    updateMessage={updateMessages[plugin.id]}
                    busy={busy}
                    onToggle={(enabled) => void perform(() => savePlugin({ ...plugin, enabled }))}
                    onCheckUpdates={() => checkUpdates(plugin)}
                    onRollback={() =>
                      void perform(() =>
                        savePlugin({
                          ...plugin,
                          current: plugin.previous!,
                          previous: plugin.current,
                          pending: null,
                        }),
                      )
                    }
                    onRemove={() => void perform(() => removePlugin(plugin.id, plugin.revision))}
                    onShortcutCommit={(keymap, value) => commitShortcut(plugin, keymap, value)}
                    onSettingChange={(key, value) =>
                      void perform(() =>
                        savePlugin({ ...plugin, settings: { ...plugin.settings, [key]: value } }),
                      )
                    }
                  />
                ))}
              </div>
            </div>
          )}
        </>
      )}
      {error && (
        <p role="alert" className={`m-0 ${settingsErrorNoticeClassName}`}>
          {error}
        </p>
      )}
      <PluginInstallConfirmDialog
        version={pendingInstall}
        busy={busy}
        onCancel={() => setPendingInstall(null)}
        onConfirm={() => {
          const version = pendingInstall;
          if (!version) return;
          void perform(async () => {
            await savePlugin({
              id: version.source.pluginId,
              revision: 0,
              enabled: true,
              settings: {},
              keymapOverrides: {},
              current: version,
              previous: null,
              pending: null,
            });
            setPendingInstall(null);
          });
        }}
      />
    </section>
  );
}
