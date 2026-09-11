/**
 * @file AppearanceSettingsPanel.tsx
 * @module apps/desktop/components/settings/AppearanceSettingsPanel
 * @description
 * 外观与排版配置面板（Appearance Settings Panel）。
 *
 * 提供正文字体（Prose Font）、代码字体（Code Font）、字号滑块、代码行号开关、
 * 色彩主题模式（跟随系统 / 浅色 / 深色）以及内置与自定义 CSS 主题选择器的交互设置。
 */

import {
  CODE_FONT_OPTIONS,
  PROSE_FONT_OPTIONS,
  type AppThemeSettings,
  type EditorDisplaySettings,
} from "../../app/settings/app-settings";
import {
  BUILT_IN_DARK_THEME_OPTIONS,
  BUILT_IN_LIGHT_THEME_OPTIONS,
} from "../../app/settings/built-in-themes";
import { ThemeCssPicker } from "./ThemeCssPicker";
import { readThemeColorScheme } from "./settingsUtils";
import { useTranslation } from "@md-editor/i18n";
import {
  settingsDescriptionClassName,
  settingsFieldLabelClassName,
  settingsInputClassName,
  settingsModuleClassName,
  settingsSectionTitleClassName,
} from "./settingsStyles";

/**
 * 外观设置面板组件属性接口。
 */
interface AppearanceSettingsPanelProps {
  /** 当前编辑中的排版设置草稿 */
  readonly editorSettingsDraft: EditorDisplaySettings;
  /** 当前编辑中的主题设置草稿 */
  readonly themeDraft: AppThemeSettings;
  /** 排版设置变更回调 */
  readonly onChangeEditorSettings: (value: EditorDisplaySettings) => void;
  /** 主题设置变更回调 */
  readonly onChangeTheme: (value: AppThemeSettings) => void;
  /** 点击选择自定义 CSS 文件回调 */
  readonly onChooseThemeCss: (scheme: "light" | "dark") => void;
  /** 清除自定义 CSS 文件恢复内置主题回调 */
  readonly onClearThemeCss: (scheme: "light" | "dark") => void;
}

/** 所见即所得编辑区正文字号最小值（像素） */
const WYSIWYG_FONT_SIZE_MIN = 13;
/** 所见即所得编辑区正文字号最大值（像素） */
const WYSIWYG_FONT_SIZE_MAX = 22;

/**
 * 外观设置面板组件。
 */
export function AppearanceSettingsPanel({
  editorSettingsDraft,
  themeDraft,
  onChangeEditorSettings,
  onChangeTheme,
  onChooseThemeCss,
  onClearThemeCss,
}: AppearanceSettingsPanelProps) {
  const { t } = useTranslation();
  const isCustomProse =
    Boolean(editorSettingsDraft.proseFontFamily) &&
    !PROSE_FONT_OPTIONS.some((opt) => opt.id === editorSettingsDraft.proseFontFamily);

  const isCustomCode =
    Boolean(editorSettingsDraft.codeFontFamily) &&
    !CODE_FONT_OPTIONS.some((opt) => opt.id === editorSettingsDraft.codeFontFamily);

  return (
    <section className={settingsModuleClassName} aria-labelledby="appearance-settings-title">
      <div className="mb-3">
        <h2 id="appearance-settings-title" className={settingsSectionTitleClassName}>
          {t("settings.appearance.title")}
        </h2>
        <p className={settingsDescriptionClassName}>{t("settings.appearance.desc")}</p>
      </div>
      <div className="grid gap-4">
        <fieldset className="grid gap-3 border-0 p-0">
          <legend className={settingsFieldLabelClassName}>
            {t("settings.appearance.fontTitle")}
          </legend>

          <label className="grid grid-cols-[minmax(120px,160px)_minmax(0,1fr)] items-center gap-3 max-[760px]:grid-cols-1">
            <span className={settingsFieldLabelClassName}>
              {t("settings.appearance.proseFont")}
            </span>
            <select
              className={settingsInputClassName}
              value={isCustomProse ? "custom" : editorSettingsDraft.proseFontFamily}
              onChange={(event) => {
                const val = event.target.value;
                onChangeEditorSettings({
                  ...editorSettingsDraft,
                  proseFontFamily:
                    val === "custom" ? editorSettingsDraft.proseFontFamily || "PingFang SC" : val,
                });
              }}
            >
              {PROSE_FONT_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
              <option value="custom">{t("settings.appearance.customFontOption")}</option>
            </select>
          </label>
          {isCustomProse ? (
            <label className="grid grid-cols-[minmax(120px,160px)_minmax(0,1fr)] items-center gap-3 max-[760px]:grid-cols-1">
              <span className={settingsFieldLabelClassName}>
                {t("settings.appearance.customProseFont")}
              </span>
              <input
                type="text"
                className={settingsInputClassName}
                placeholder={t("settings.appearance.customProsePlaceholder")}
                value={editorSettingsDraft.proseFontFamily}
                onChange={(event) =>
                  onChangeEditorSettings({
                    ...editorSettingsDraft,
                    proseFontFamily: event.target.value,
                  })
                }
              />
            </label>
          ) : null}

          <label className="grid grid-cols-[minmax(120px,160px)_minmax(0,1fr)] items-center gap-3 max-[760px]:grid-cols-1">
            <span className={settingsFieldLabelClassName}>{t("settings.appearance.codeFont")}</span>
            <select
              className={settingsInputClassName}
              value={isCustomCode ? "custom" : editorSettingsDraft.codeFontFamily}
              onChange={(event) => {
                const val = event.target.value;
                onChangeEditorSettings({
                  ...editorSettingsDraft,
                  codeFontFamily:
                    val === "custom" ? editorSettingsDraft.codeFontFamily || "SF Mono" : val,
                });
              }}
            >
              {CODE_FONT_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
              <option value="custom">{t("settings.appearance.customCodeOption")}</option>
            </select>
          </label>
          {isCustomCode ? (
            <label className="grid grid-cols-[minmax(120px,160px)_minmax(0,1fr)] items-center gap-3 max-[760px]:grid-cols-1">
              <span className={settingsFieldLabelClassName}>
                {t("settings.appearance.customCodeFont")}
              </span>
              <input
                type="text"
                className={settingsInputClassName}
                placeholder={t("settings.appearance.customCodePlaceholder")}
                value={editorSettingsDraft.codeFontFamily}
                onChange={(event) =>
                  onChangeEditorSettings({
                    ...editorSettingsDraft,
                    codeFontFamily: event.target.value,
                  })
                }
              />
            </label>
          ) : null}

          <label className="grid grid-cols-[minmax(120px,160px)_minmax(0,1fr)_44px] items-center gap-3 text-[13px] text-[var(--theme-text)] max-[760px]:grid-cols-[minmax(0,1fr)_44px]">
            <span className={settingsFieldLabelClassName}>{t("settings.appearance.fontSize")}</span>
            <input
              type="range"
              min={WYSIWYG_FONT_SIZE_MIN}
              max={WYSIWYG_FONT_SIZE_MAX}
              step={1}
              value={editorSettingsDraft.wysiwygFontSize}
              aria-label={t("settings.appearance.fontSize")}
              onChange={(event) =>
                onChangeEditorSettings({
                  ...editorSettingsDraft,
                  wysiwygFontSize: Number.parseInt(event.target.value, 10),
                })
              }
            />
            <output className="text-right text-[13px] tabular-nums text-[var(--theme-control-text)]">
              {editorSettingsDraft.wysiwygFontSize}px
            </output>
          </label>
          <label className="flex min-h-[30px] items-center gap-2 text-[13px] text-[var(--theme-text)]">
            <input
              type="checkbox"
              className="size-4 accent-[var(--theme-primary)]"
              checked={editorSettingsDraft.showCodeBlockLineNumbers}
              onChange={(event) =>
                onChangeEditorSettings({
                  ...editorSettingsDraft,
                  showCodeBlockLineNumbers: event.target.checked,
                })
              }
            />
            <span>{t("settings.appearance.showLineNumbers")}</span>
          </label>
        </fieldset>
        <div className="grid gap-2.5">
          <h3 className={settingsFieldLabelClassName}>{t("settings.appearance.themeTitle")}</h3>
          <label className="grid grid-cols-[minmax(120px,160px)_minmax(0,1fr)] items-center gap-3 max-[760px]:grid-cols-1">
            <span className={settingsFieldLabelClassName}>
              {t("settings.appearance.applyMode")}
            </span>
            <select
              className={settingsInputClassName}
              value={themeDraft.mode}
              onChange={(event) =>
                onChangeTheme({ ...themeDraft, mode: readThemeColorScheme(event.target.value) })
              }
            >
              <option value="system">{t("settings.appearance.modeSystem")}</option>
              <option value="light">{t("settings.appearance.modeLight")}</option>
              <option value="dark">{t("settings.appearance.modeDark")}</option>
            </select>
          </label>
          <ThemeCssPicker
            label={t("settings.appearance.lightTheme")}
            theme={themeDraft.light}
            builtInOptions={BUILT_IN_LIGHT_THEME_OPTIONS}
            onChange={(light) => onChangeTheme({ ...themeDraft, light })}
            onChoose={() => onChooseThemeCss("light")}
            onClear={() => onClearThemeCss("light")}
          />
          <ThemeCssPicker
            label={t("settings.appearance.darkTheme")}
            theme={themeDraft.dark}
            builtInOptions={BUILT_IN_DARK_THEME_OPTIONS}
            onChange={(dark) => onChangeTheme({ ...themeDraft, dark })}
            onChoose={() => onChooseThemeCss("dark")}
            onClear={() => onClearThemeCss("dark")}
          />
        </div>
      </div>
    </section>
  );
}
