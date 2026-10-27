/**
 * @fileoverview 跨端统一快捷键配置/速查面板组件 (Shortcut Settings Panel)
 */

import type { KeyboardEvent, ReactNode } from "react";
import { useTranslation } from "@md-editor/i18n";
import {
  settingsDescriptionClassName,
  settingsFieldLabelClassName,
  settingsInputClassName,
  settingsModuleClassName,
  settingsSectionTitleClassName,
  settingsSmallButtonClassName,
} from "./settings-styles";

export interface ShortcutItemData {
  readonly id: string;
  readonly commandId?: string;
  readonly label: string;
  readonly key: string;
  readonly defaultKey?: string;
}

export interface ShortcutCategoryData {
  readonly title: string;
  readonly items: readonly { readonly key: string; readonly desc: string }[];
}

export interface ShortcutSettingsPanelProps {
  /** 模式：editable 支持按键录制与单项重置；readonly 为只读速查表 */
  readonly mode?: "editable" | "readonly";
  readonly shortcuts?: readonly ShortcutItemData[];
  readonly shortcutDrafts?: Readonly<Record<string, string>>;
  readonly onCaptureShortcut?: (id: string, event: KeyboardEvent<HTMLInputElement>) => void;
  readonly onResetShortcut?: (id: string) => void;
  /** 可选分类速查数据（uTools 模式） */
  readonly categories?: readonly ShortcutCategoryData[];
  /** 可选宿主专属扩展卡片（如 uTools 全局呼出快捷键配置提示） */
  readonly extraSections?: ReactNode;
}

export function ShortcutSettingsPanel({
  mode = "editable",
  shortcuts = [],
  shortcutDrafts = {},
  onCaptureShortcut,
  onResetShortcut,
  categories,
  extraSections,
}: ShortcutSettingsPanelProps) {
  const { t } = useTranslation();

  return (
    <div className="grid gap-5">
      <section className={settingsModuleClassName} aria-labelledby="shortcut-settings-title">
        <div className="mb-3">
          <h2 id="shortcut-settings-title" className={settingsSectionTitleClassName}>
            {t("settings.shortcuts.title")}
          </h2>
          <p className={settingsDescriptionClassName}>{t("settings.shortcuts.desc")}</p>
        </div>

        {/* 分类展示模式（uTools 格式） */}
        {categories ? (
          <div className="grid gap-4">
            {categories.map((category) => (
              <div key={category.title} className="grid gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--theme-muted)]">
                  {category.title}
                </h3>
                <div className="grid gap-1.5">
                  {category.items.map((item) => (
                    <div
                      key={item.desc}
                      className="flex items-center justify-between gap-3 rounded-[6px] border border-[var(--theme-border)] bg-[var(--theme-chrome)]/40 px-3 py-2 text-xs"
                    >
                      <span className="text-[var(--theme-text)]">{item.desc}</span>
                      <kbd className="rounded border border-[var(--theme-border-strong)] bg-[var(--theme-surface)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--theme-title)] shadow-xs">
                        {item.key}
                      </kbd>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          /* 标准列表模式（Desktop / Web 格式） */
          <div className="grid gap-2.5">
            {shortcuts.map((shortcut) => {
              const translate = t as (key: string, options?: { defaultValue?: string }) => string;
              const label = shortcut.commandId
                ? translate(`commands.titles.${shortcut.commandId}`, {
                    defaultValue: shortcut.label,
                  })
                : shortcut.label;
              const currentKey = shortcutDrafts[shortcut.id] ?? shortcut.key;
              const isCustom = shortcut.defaultKey && currentKey !== shortcut.defaultKey;

              return (
                <div
                  key={shortcut.id}
                  className={`grid items-center gap-2.5 max-[760px]:grid-cols-1 ${
                    mode === "editable"
                      ? "grid-cols-[minmax(150px,1fr)_minmax(160px,220px)_56px]"
                      : "grid-cols-[minmax(150px,1fr)_minmax(160px,220px)]"
                  }`}
                >
                  <span className="min-w-0">
                    <strong className={settingsFieldLabelClassName}>{label}</strong>
                    {shortcut.defaultKey ? (
                      <small className="block overflow-hidden text-ellipsis whitespace-nowrap text-xs text-[var(--theme-muted)]">
                        {t("settings.shortcuts.defaultShortcut", {
                          key: shortcut.defaultKey,
                        })}
                      </small>
                    ) : null}
                  </span>

                  <input
                    data-settings-shortcut-input="true"
                    className={settingsInputClassName}
                    value={currentKey}
                    onKeyDown={
                      onCaptureShortcut
                        ? (event) => onCaptureShortcut(shortcut.id, event)
                        : undefined
                    }
                    onChange={() => undefined}
                    readOnly
                    spellCheck={false}
                    aria-label={t("settings.shortcuts.ariaShortcut", { name: label })}
                  />

                  {mode === "editable" && onResetShortcut ? (
                    <button
                      type="button"
                      className={settingsSmallButtonClassName}
                      disabled={!isCustom}
                      onClick={() => onResetShortcut(shortcut.id)}
                    >
                      {t("settings.shortcuts.resetToDefault", { defaultValue: "重置" })}
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {extraSections}
    </div>
  );
}
