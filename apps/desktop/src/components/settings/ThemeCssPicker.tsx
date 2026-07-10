import type { ThemeSchemeSettings } from "../../app/settings/app-settings";
import type { BuiltInThemeOption } from "../../app/settings/built-in-themes";
import { readThemeSelection } from "./settingsUtils";
import {
  settingsFieldLabelClassName,
  settingsInputClassName,
  settingsSmallButtonClassName,
} from "./settingsStyles";

interface ThemeCssPickerProps {
  readonly label: string;
  readonly theme: ThemeSchemeSettings;
  readonly builtInOptions: readonly BuiltInThemeOption[];
  readonly onChange: (value: ThemeSchemeSettings) => void;
  readonly onChoose: () => void;
  readonly onClear: () => void;
}

export function ThemeCssPicker({
  label,
  theme,
  builtInOptions,
  onChange,
  onChoose,
  onClear,
}: ThemeCssPickerProps) {
  const customCssPath = theme.customCssPath;
  const shouldShowCustomCss = theme.source === "custom" || customCssPath !== null;

  return (
    <div className="grid grid-cols-[minmax(120px,160px)_minmax(0,1fr)] items-start gap-3 max-[760px]:grid-cols-1">
      <span className={settingsFieldLabelClassName}>{label}</span>
      <div className="grid gap-2">
        <select
          className={settingsInputClassName}
          value={theme.source === "custom" ? "custom" : theme.builtinTheme}
          onChange={(event) =>
            onChange(readThemeSelection(event.target.value, theme, builtInOptions))
          }
        >
          {builtInOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
          <option value="custom">自定义 CSS</option>
        </select>
        {shouldShowCustomCss ? (
          <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 max-[760px]:grid-cols-1">
            <input
              className={settingsInputClassName}
              value={customCssPath ?? ""}
              placeholder="未选择 CSS 文件"
              readOnly
              spellCheck={false}
              aria-label={`${label}自定义 CSS 路径`}
              title={customCssPath ?? "未选择 CSS 文件"}
            />
            <button
              type="button"
              className={`${settingsSmallButtonClassName} max-[760px]:w-max`}
              onClick={onChoose}
            >
              选择
            </button>
            {customCssPath ? (
              <button
                type="button"
                className={`${settingsSmallButtonClassName} max-[760px]:w-max`}
                onClick={onClear}
              >
                清除
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
