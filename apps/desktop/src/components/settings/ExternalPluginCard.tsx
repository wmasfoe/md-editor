import { PuzzlePieceIcon } from "@heroicons/react/24/outline";
import { useTranslation } from "@md-editor/i18n";
import type { PluginStatus } from "@md-editor/plugin-host";
import type { PluginSettingValue } from "@md-editor/plugin-sdk";
import {
  PluginCard,
  PluginToggle,
  pluginBadgeClassName,
  pluginCodeChipClassName,
  settingsDangerTextButtonClassName,
  settingsErrorNoticeClassName,
  settingsFieldLabelClassName,
  settingsInputClassName,
  settingsTextButtonClassName,
  type PluginToggleTone,
} from "@md-editor/app-ui/settings";
import type { PluginStatusEvent, StoredPlugin } from "../../app/plugins/storage";

type PluginKeymapStatus = PluginStatusEvent["keymaps"][number];

export interface ExternalPluginCardProps {
  readonly plugin: StoredPlugin;
  /** 主窗口回传的运行状态；设置页单独打开、主窗口尚未回传时为空。 */
  readonly status: PluginStatus | undefined;
  /** 当前插件贡献的快捷键（已按 pluginId 过滤）。 */
  readonly keymaps: readonly PluginKeymapStatus[];
  /** 快捷键输入框的本地格式错误，按 keymap id 记录。 */
  readonly shortcutErrors: Readonly<Record<string, string>>;
  /** 检查更新等操作的结果提示。 */
  readonly updateMessage: string | undefined;
  readonly busy: boolean;
  readonly onToggle: (enabled: boolean) => void;
  readonly onCheckUpdates: () => void;
  readonly onRollback: () => void;
  readonly onRemove: () => void;
  /** 失焦时提交快捷键覆盖；格式校验与冲突判断由调用方负责。 */
  readonly onShortcutCommit: (keymap: PluginKeymapStatus, value: string) => void;
  readonly onSettingChange: (key: string, value: PluginSettingValue) => void;
}

/** 字段行：左侧标签、右侧控件，与其他设置面板的表单行同一栅格。 */
const fieldRowClassName =
  "grid grid-cols-[minmax(120px,160px)_minmax(0,1fr)] items-center gap-3 max-[760px]:grid-cols-1";

const checkboxClassName =
  "size-4 rounded border-[var(--theme-border)] accent-[var(--theme-primary)]";

/**
 * 已安装外部插件的卡片。外框与内置插件共用 `PluginCard`，
 * 卡片只负责展示与收集输入，存储和更新流程由 `ExternalPluginSettings` 处理。
 */
export function ExternalPluginCard({
  plugin,
  status,
  keymaps,
  shortcutErrors,
  updateMessage,
  busy,
  onToggle,
  onCheckUpdates,
  onRollback,
  onRemove,
  onShortcutCommit,
  onSettingChange,
}: ExternalPluginCardProps) {
  const { t } = useTranslation();
  const { manifest } = plugin.current.package;
  const { source } = plugin.current;
  const settingEntries = Object.entries(plugin.current.package.settings ?? {});
  const toggle = resolveToggleState(plugin.enabled, status);

  return (
    <PluginCard
      icon={<PuzzlePieceIcon className="size-4 text-[var(--theme-muted)]" aria-hidden="true" />}
      title={manifest.name}
      dimmed={!plugin.enabled}
      badges={<span className={pluginBadgeClassName}>{manifest.version}</span>}
      description={manifest.description}
      meta={
        <span className={pluginCodeChipClassName}>
          {source.owner}/{source.repo}
        </span>
      }
      trailing={
        <PluginToggle
          checked={plugin.enabled}
          disabled={busy}
          onChange={onToggle}
          ariaLabel={t("settings.plugins.toggleAria", { name: manifest.name })}
          statusLabel={t(toggle.labelKey)}
          tone={toggle.tone}
        />
      }
    >
      {plugin.enabled && status?.status === "error" && (
        <p role="alert" className={`m-0 ${settingsErrorNoticeClassName}`}>
          {t("pluginPreview.failed")}：{status.error ?? t("pluginPreview.unknown")}
        </p>
      )}

      <div className="-ml-2 flex flex-wrap items-center gap-1">
        <button
          type="button"
          className={settingsTextButtonClassName}
          disabled={busy}
          onClick={onCheckUpdates}
        >
          {t("pluginPreview.checkUpdates")}
        </button>
        <button
          type="button"
          className={settingsTextButtonClassName}
          disabled={busy || !plugin.previous}
          onClick={onRollback}
        >
          {t("pluginPreview.rollback")}
        </button>
        <button
          type="button"
          className={settingsDangerTextButtonClassName}
          disabled={busy}
          onClick={onRemove}
        >
          {t("pluginPreview.remove")}
        </button>
        {(plugin.pending || updateMessage) && (
          <span role="status" className="ml-1 text-xs text-[var(--theme-muted)]">
            {updateMessage ?? t("pluginPreview.pending")}
          </span>
        )}
      </div>

      {(keymaps.length > 0 || settingEntries.length > 0) && (
        <div className="grid gap-2 border-t border-[var(--theme-border)] pt-2.5">
          {keymaps.map((keymap) => (
            <ShortcutField
              key={keymap.id}
              keymap={keymap}
              value={plugin.keymapOverrides?.[keymap.id] ?? keymap.key}
              localError={shortcutErrors[keymap.id]}
              onCommit={(value) => onShortcutCommit(keymap, value)}
            />
          ))}
          {settingEntries.map(([key, definition]) => (
            <label key={key} className={fieldRowClassName}>
              <span className={settingsFieldLabelClassName}>{definition.label}</span>
              {definition.type === "boolean" ? (
                <input
                  type="checkbox"
                  className={checkboxClassName}
                  checked={Boolean(plugin.settings[key] ?? definition.default)}
                  onChange={(e) => onSettingChange(key, e.target.checked)}
                />
              ) : definition.type === "enum" ? (
                <select
                  className={settingsInputClassName}
                  value={String(plugin.settings[key] ?? definition.default)}
                  onChange={(e) => onSettingChange(key, e.target.value)}
                >
                  {definition.values.map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
              ) : (
                <input
                  className={settingsInputClassName}
                  type={definition.type === "number" ? "number" : "text"}
                  defaultValue={String(plugin.settings[key] ?? definition.default)}
                  onBlur={(e) =>
                    onSettingChange(
                      key,
                      definition.type === "number" ? Number(e.target.value) : e.target.value,
                    )
                  }
                />
              )}
            </label>
          ))}
        </div>
      )}
    </PluginCard>
  );
}

function ShortcutField({
  keymap,
  value,
  localError,
  onCommit,
}: {
  readonly keymap: PluginKeymapStatus;
  readonly value: string;
  readonly localError: string | undefined;
  readonly onCommit: (value: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="grid gap-1">
      <label className={fieldRowClassName}>
        <span className="min-w-0">
          <span className={settingsFieldLabelClassName}>{t("pluginPreview.shortcut")}</span>
          <small className="block overflow-hidden text-ellipsis whitespace-nowrap text-xs text-[var(--theme-muted)]">
            {keymap.id}
          </small>
        </span>
        <input
          className={settingsInputClassName}
          defaultValue={value}
          aria-invalid={Boolean(localError || keymap.overrideError)}
          onBlur={(event) => onCommit(event.target.value.trim() || keymap.key)}
        />
      </label>
      {localError && (
        <span role="alert" className="text-xs text-[var(--theme-danger-text)]">
          {t("pluginPreview.shortcutInvalid")}
          {localError}
        </span>
      )}
      {!localError && keymap.overrideError && (
        <span role="alert" className="text-xs text-[var(--theme-danger-text)]">
          {keymap.overrideError.kind === "conflict"
            ? t("pluginPreview.shortcutConflict")
            : t("pluginPreview.shortcutInvalid")}
          {keymap.overrideError.message}
          {keymap.effectiveKey
            ? ` · ${t("pluginPreview.shortcutFallback")}${keymap.effectiveKey}`
            : ` · ${t("pluginPreview.shortcutDisabled")}`}
        </span>
      )}
    </div>
  );
}

/** 把「用户开关 + 主窗口运行状态」合成卡片右上角状态文字的 i18n key 与色调。 */
type ToggleLabelKey =
  | "settings.plugins.disabledStatus"
  | "settings.plugins.enabledStatus"
  | "pluginPreview.loading"
  | "pluginPreview.failed";

function resolveToggleState(
  enabled: boolean,
  status: PluginStatus | undefined,
): { readonly labelKey: ToggleLabelKey; readonly tone: PluginToggleTone } {
  if (!enabled) return { labelKey: "settings.plugins.disabledStatus", tone: "disabled" };
  if (status?.status === "loading") return { labelKey: "pluginPreview.loading", tone: "pending" };
  if (status?.status === "error") return { labelKey: "pluginPreview.failed", tone: "danger" };
  return { labelKey: "settings.plugins.enabledStatus", tone: "enabled" };
}
