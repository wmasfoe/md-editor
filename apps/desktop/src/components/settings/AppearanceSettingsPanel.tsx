import type {
  AppThemeSettings,
  EditorDisplaySettings
} from "../../app/settings/app-settings";
import {
  BUILT_IN_DARK_THEME_OPTIONS,
  BUILT_IN_LIGHT_THEME_OPTIONS
} from "../../app/settings/built-in-themes";
import { ThemeCssPicker } from "./ThemeCssPicker";
import { readThemeColorScheme } from "./settingsUtils";
import {
  settingsDescriptionClassName,
  settingsFieldLabelClassName,
  settingsInputClassName,
  settingsModuleClassName,
  settingsSectionTitleClassName
} from "./settingsStyles";

interface AppearanceSettingsPanelProps {
  readonly editorSettingsDraft: EditorDisplaySettings;
  readonly themeDraft: AppThemeSettings;
  readonly onChangeEditorSettings: (value: EditorDisplaySettings) => void;
  readonly onChangeTheme: (value: AppThemeSettings) => void;
  readonly onChooseThemeCss: (scheme: "light" | "dark") => void;
  readonly onClearThemeCss: (scheme: "light" | "dark") => void;
}

const WYSIWYG_FONT_SIZE_MIN = 13;
const WYSIWYG_FONT_SIZE_MAX = 22;

export function AppearanceSettingsPanel({
  editorSettingsDraft,
  themeDraft,
  onChangeEditorSettings,
  onChangeTheme,
  onChooseThemeCss,
  onClearThemeCss
}: AppearanceSettingsPanelProps) {
  return (
    <section className={settingsModuleClassName} aria-labelledby="appearance-settings-title">
      <div className="mb-3">
        <h2 id="appearance-settings-title" className={settingsSectionTitleClassName}>外观设置</h2>
        <p className={settingsDescriptionClassName}>为亮色和暗色分别选择内置主题或自定义 CSS，应用默认跟随系统明暗。</p>
      </div>
      <div className="grid gap-4">
        <fieldset className="grid gap-2.5 border-0 p-0">
          <legend className={settingsFieldLabelClassName}>编辑显示</legend>
          <label className="grid grid-cols-[minmax(120px,160px)_minmax(0,1fr)_44px] items-center gap-3 text-[13px] text-[var(--theme-text)] max-[760px]:grid-cols-[minmax(0,1fr)_44px]">
            <span className={settingsFieldLabelClassName}>所见即所得字号</span>
            <input
              type="range"
              min={WYSIWYG_FONT_SIZE_MIN}
              max={WYSIWYG_FONT_SIZE_MAX}
              step={1}
              value={editorSettingsDraft.wysiwygFontSize}
              aria-label="所见即所得字号"
              onChange={(event) =>
                onChangeEditorSettings({
                  ...editorSettingsDraft,
                  wysiwygFontSize: Number.parseInt(event.target.value, 10)
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
                  showCodeBlockLineNumbers: event.target.checked
                })
              }
            />
            <span>显示代码块行号</span>
          </label>
        </fieldset>
        <div className="grid gap-2.5">
          <h3 className={settingsFieldLabelClassName}>主题</h3>
        <label className="grid grid-cols-[minmax(120px,160px)_minmax(0,1fr)] items-center gap-3 max-[760px]:grid-cols-1">
          <span className={settingsFieldLabelClassName}>应用方式</span>
          <select
            className={settingsInputClassName}
            value={themeDraft.mode}
            onChange={(event) =>
              onChangeTheme({ ...themeDraft, mode: readThemeColorScheme(event.target.value) })
            }
          >
            <option value="system">跟随系统</option>
            <option value="light">使用亮色 CSS</option>
            <option value="dark">使用暗色 CSS</option>
          </select>
        </label>
        <ThemeCssPicker
          label="亮色主题"
          theme={themeDraft.light}
          builtInOptions={BUILT_IN_LIGHT_THEME_OPTIONS}
          onChange={(light) => onChangeTheme({ ...themeDraft, light })}
          onChoose={() => onChooseThemeCss("light")}
          onClear={() => onClearThemeCss("light")}
        />
        <ThemeCssPicker
          label="暗色主题"
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
