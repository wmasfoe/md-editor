/**
 * @fileoverview 跨端统一外观与主题配置面板组件 (Appearance Settings Panel)
 */

import { useTranslation } from "@md-editor/i18n";
import {
  BUILT_IN_DARK_THEME_OPTIONS,
  BUILT_IN_LIGHT_THEME_OPTIONS,
  type BuiltInThemeId,
} from "../../themes/built-in-themes";
import {
  settingsDescriptionClassName,
  settingsFieldLabelClassName,
  settingsInputClassName,
  settingsModuleClassName,
  settingsSectionTitleClassName,
  settingsSmallButtonClassName,
} from "./settings-styles";

export interface CustomCssState {
  readonly lightPath: string | null;
  readonly darkPath: string | null;
  readonly onChoose: (scheme: "light" | "dark") => void;
  readonly onClear: (scheme: "light" | "dark") => void;
}

export interface BuiltInThemesState {
  readonly lightTheme: string;
  readonly darkTheme: string;
  readonly onChangeLightTheme: (theme: string) => void;
  readonly onChangeDarkTheme: (theme: string) => void;
}

export interface AppearanceSettingsPanelProps {
  readonly mode: "system" | "light" | "dark";
  readonly onChangeMode: (mode: "system" | "light" | "dark") => void;
  /** 可选内置主题列表（Desktop / Web 传入） */
  readonly builtInThemes?: BuiltInThemesState;
  /** 可选自定义 CSS 皮肤（仅 Desktop 传入） */
  readonly customCss?: CustomCssState;
}

export function AppearanceSettingsPanel({
  mode,
  onChangeMode,
  builtInThemes,
  customCss,
}: AppearanceSettingsPanelProps) {
  const { t } = useTranslation();

  return (
    <div className="grid gap-5">
      {/* 模块 1：主题模式 */}
      <section className={settingsModuleClassName} aria-labelledby="appearance-theme-title">
        <div className="mb-3">
          <h2 id="appearance-theme-title" className={settingsSectionTitleClassName}>
            {t("settings.appearance.themeTitle")}
          </h2>
          <p className={settingsDescriptionClassName}>{t("settings.appearance.themeDesc")}</p>
        </div>

        <div className="grid gap-3">
          <label className="grid grid-cols-[minmax(120px,160px)_minmax(0,1fr)] items-center gap-3 max-[760px]:grid-cols-1">
            <span className={settingsFieldLabelClassName}>
              {t("settings.appearance.applyMode")}
            </span>
            <select
              className={settingsInputClassName}
              value={mode}
              onChange={(event) => onChangeMode(event.target.value as "system" | "light" | "dark")}
            >
              <option value="system">{t("settings.appearance.modeSystem")}</option>
              <option value="light">{t("settings.appearance.modeLight")}</option>
              <option value="dark">{t("settings.appearance.modeDark")}</option>
            </select>
          </label>

          {builtInThemes ? (
            <>
              <label className="grid grid-cols-[minmax(120px,160px)_minmax(0,1fr)] items-center gap-3 max-[760px]:grid-cols-1">
                <span className={settingsFieldLabelClassName}>
                  {t("settings.appearance.lightTheme")}
                </span>
                <select
                  className={settingsInputClassName}
                  value={builtInThemes.lightTheme}
                  onChange={(event) => builtInThemes.onChangeLightTheme(event.target.value)}
                >
                  {BUILT_IN_LIGHT_THEME_OPTIONS.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {t(`settings.appearance.themes.${themeKey(opt.id)}`, {
                        defaultValue: opt.label,
                      })}
                    </option>
                  ))}
                </select>
              </label>

              <label className="grid grid-cols-[minmax(120px,160px)_minmax(0,1fr)] items-center gap-3 max-[760px]:grid-cols-1">
                <span className={settingsFieldLabelClassName}>
                  {t("settings.appearance.darkTheme")}
                </span>
                <select
                  className={settingsInputClassName}
                  value={builtInThemes.darkTheme}
                  onChange={(event) => builtInThemes.onChangeDarkTheme(event.target.value)}
                >
                  {BUILT_IN_DARK_THEME_OPTIONS.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {t(`settings.appearance.themes.${themeKey(opt.id)}`, {
                        defaultValue: opt.label,
                      })}
                    </option>
                  ))}
                </select>
              </label>
            </>
          ) : null}
        </div>
      </section>

      {/* 模块 2：自定义 CSS 皮肤（可选能力，仅 Desktop 传入） */}
      {customCss ? (
        <section className={settingsModuleClassName} aria-labelledby="custom-css-title">
          <div className="mb-3">
            <h2 id="custom-css-title" className={settingsSectionTitleClassName}>
              {t("settings.appearance.customCss")}
            </h2>
            <p className={settingsDescriptionClassName}>{t("settings.appearance.customCssDesc")}</p>
          </div>

          <div className="grid gap-3">
            <div className="grid grid-cols-[minmax(120px,160px)_minmax(0,1fr)] items-center gap-3 max-[760px]:grid-cols-1">
              <span className={settingsFieldLabelClassName}>
                {t("settings.appearance.lightTheme")} CSS
              </span>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  className={settingsInputClassName}
                  placeholder={t("settings.appearance.noCssSelected")}
                  value={customCss.lightPath ?? ""}
                />
                <button
                  type="button"
                  className={settingsSmallButtonClassName}
                  onClick={() => customCss.onChoose("light")}
                >
                  {t("settings.appearance.chooseCssFile")}
                </button>
                {customCss.lightPath ? (
                  <button
                    type="button"
                    className={settingsSmallButtonClassName}
                    onClick={() => customCss.onClear("light")}
                  >
                    {t("settings.appearance.clearCss")}
                  </button>
                ) : null}
              </div>
            </div>

            <div className="grid grid-cols-[minmax(120px,160px)_minmax(0,1fr)] items-center gap-3 max-[760px]:grid-cols-1">
              <span className={settingsFieldLabelClassName}>
                {t("settings.appearance.darkTheme")} CSS
              </span>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  className={settingsInputClassName}
                  placeholder={t("settings.appearance.noCssSelected")}
                  value={customCss.darkPath ?? ""}
                />
                <button
                  type="button"
                  className={settingsSmallButtonClassName}
                  onClick={() => customCss.onChoose("dark")}
                >
                  {t("settings.appearance.chooseCssFile")}
                </button>
                {customCss.darkPath ? (
                  <button
                    type="button"
                    className={settingsSmallButtonClassName}
                    onClick={() => customCss.onClear("dark")}
                  >
                    {t("settings.appearance.clearCss")}
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function themeKey(id: BuiltInThemeId): string {
  switch (id) {
    case "github-light":
      return "githubLight";
    case "gothic-light":
      return "gothicLight";
    case "night-dark":
      return "nightDark";
    case "paper-light":
      return "paperLight";
    case "charcoal-dark":
      return "charcoalDark";
  }
}
