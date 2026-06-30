import type { AppThemeSettings } from "../../app/settings/app-settings";
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
  readonly themeDraft: AppThemeSettings;
  readonly onChangeTheme: (value: AppThemeSettings) => void;
  readonly onChooseThemeCss: (scheme: "light" | "dark") => void;
  readonly onClearThemeCss: (scheme: "light" | "dark") => void;
}

export function AppearanceSettingsPanel({
  themeDraft,
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
      <div className="grid gap-2.5">
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
    </section>
  );
}
