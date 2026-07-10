import type { KeyboardEvent } from "react";
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

interface ShortcutSettingsPanelProps {
  readonly shortcuts: AppSettings["shortcuts"];
  readonly shortcutDrafts: Readonly<Record<string, string>>;
  readonly onCaptureShortcut: (id: string, key: string) => void;
  readonly onResetShortcut: (id: string) => void;
}

export function ShortcutSettingsPanel({
  shortcuts,
  shortcutDrafts,
  onCaptureShortcut,
  onResetShortcut,
}: ShortcutSettingsPanelProps) {
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
          快捷键设置
        </h2>
        <p className={settingsDescriptionClassName}>点击输入框后按下组合键，系统会自动记录键位。</p>
      </div>
      <div className="grid gap-2">
        {shortcuts.map((shortcut) => (
          <label
            key={shortcut.id}
            className="grid grid-cols-[minmax(150px,1fr)_minmax(160px,220px)_56px] items-center gap-2.5 max-[760px]:grid-cols-1"
          >
            <span className="min-w-0">
              <strong className={settingsFieldLabelClassName}>{shortcut.label}</strong>
              <small className="block overflow-hidden text-ellipsis whitespace-nowrap text-xs text-[var(--theme-muted)]">
                默认 {keyboardShortcutLabel(shortcut.defaultKey)}
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
              aria-label={`${shortcut.label}快捷键`}
            />
            <button
              type="button"
              className={`${settingsSmallButtonClassName} max-[760px]:w-max`}
              onClick={() => onResetShortcut(shortcut.id)}
            >
              重置
            </button>
          </label>
        ))}
      </div>
    </section>
  );
}
