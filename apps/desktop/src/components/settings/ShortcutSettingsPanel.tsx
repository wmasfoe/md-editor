/**
 * @file ShortcutSettingsPanel.tsx
 * @module apps/desktop/components/settings/ShortcutSettingsPanel
 * @description
 * 快捷键配置面板组件（Shortcut Settings Panel）。
 *
 * 允许用户浏览系统内置与自定义按键绑定（Keybindings），
 * 点击输入框按下物理按键实时捕获新组合键，并支持单项一键重置为默认值。
 */

import type { KeyboardEvent } from "react";
import { useTranslation } from "@md-editor/i18n";
import type { AppSettings } from "../../app/settings/app-settings";
import {
  keyboardShortcutLabel,
  shortcutKeyFromKeyboardEvent,
} from "../../app/settings/app-settings";
import {
  settingsDescriptionClassName,
  settingsFieldLabelClassName,
  settingsInputClassName,
  settingsModuleClassName,
  settingsSectionTitleClassName,
  settingsSmallButtonClassName,
} from "./settingsStyles";

/**
 * 快捷键配置面板组件属性接口。
 */
interface ShortcutSettingsPanelProps {
  /** 快捷键完整配置列表 */
  readonly shortcuts: AppSettings["shortcuts"];
  /** 当前暂存未持久化的快捷键草稿映射表（id -> formattedKey） */
  readonly shortcutDrafts: Readonly<Record<string, string>>;
  /** 捕获并更新指定快捷键草稿回调 */
  readonly onCaptureShortcut: (id: string, key: string) => void;
  /** 重置指定快捷键为系统默认值回调 */
  readonly onResetShortcut: (id: string) => void;
}

/**
 * 快捷键设置面板组件。
 */
export function ShortcutSettingsPanel({
  shortcuts,
  shortcutDrafts,
  onCaptureShortcut,
  onResetShortcut,
}: ShortcutSettingsPanelProps) {
  const { t } = useTranslation();

  /**
   * 拦截输入框按键事件并将其转换为标准格式快捷键字符（如 "Mod-Shift-P"）。
   */
  const captureShortcut = (id: string, event: KeyboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    event.stopPropagation();

    const nextKey = shortcutKeyFromKeyboardEvent(event);
    if (nextKey) {
      onCaptureShortcut(id, nextKey);
    }
  };

  return (
    <section className={settingsModuleClassName} aria-labelledby="shortcut-settings-title">
      <div className="mb-3">
        <h2 id="shortcut-settings-title" className={settingsSectionTitleClassName}>
          {t("settings.shortcuts.title")}
        </h2>
        <p className={settingsDescriptionClassName}>{t("settings.shortcuts.desc")}</p>
      </div>
      <div className="grid gap-2">
        {shortcuts.map((shortcut) => {
          const translate = t as (key: string, options?: { defaultValue?: string }) => string;
          const label = translate(`commands.titles.${shortcut.commandId}`, {
            defaultValue: shortcut.label,
          });
          return (
            <label
              key={shortcut.id}
              className="grid grid-cols-[minmax(150px,1fr)_minmax(160px,220px)_56px] items-center gap-2.5 max-[760px]:grid-cols-1"
            >
              <span className="min-w-0">
                <strong className={settingsFieldLabelClassName}>{label}</strong>
                <small className="block overflow-hidden text-ellipsis whitespace-nowrap text-xs text-[var(--theme-muted)]">
                  {t("settings.shortcuts.defaultShortcut", {
                    key: keyboardShortcutLabel(shortcut.defaultKey),
                  })}
                </small>
              </span>
              <input
                data-settings-shortcut-input="true"
                className={settingsInputClassName}
                value={shortcutDrafts[shortcut.id] ?? keyboardShortcutLabel(shortcut.key)}
                onKeyDown={(event) => captureShortcut(shortcut.id, event)}
                onChange={() => undefined}
                readOnly
                spellCheck={false}
                aria-label={t("settings.shortcuts.ariaShortcut", { name: label })}
              />
              <button
                type="button"
                className={`${settingsSmallButtonClassName} max-[760px]:w-max`}
                onClick={() => onResetShortcut(shortcut.id)}
              >
                {t("common.reset")}
              </button>
            </label>
          );
        })}
      </div>
    </section>
  );
}
