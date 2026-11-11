/**
 * @fileoverview 设置面板通用开关（role="switch"），内置插件与外部插件共用同一外观。
 */

export interface SettingsSwitchProps {
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly ariaLabel: string;
  readonly disabled?: boolean;
}

export function SettingsSwitch({ checked, onChange, ariaLabel, disabled }: SettingsSwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          if (!disabled) onChange(!checked);
        }
      }}
      className={`group relative inline-flex h-[20px] w-[34px] shrink-0 cursor-pointer items-center rounded-full p-[2px] transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--theme-surface)] disabled:cursor-not-allowed disabled:opacity-55 ${
        checked
          ? "bg-[var(--theme-primary)] shadow-inner"
          : "bg-[var(--theme-border-strong)] hover:bg-[var(--theme-border-strong)]/80"
      }`}
    >
      <span
        aria-hidden="true"
        className={`pointer-events-none inline-block size-4 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.2),0_1px_2px_rgba(0,0,0,0.12)] ring-0 transition-transform duration-200 ease-in-out ${
          checked ? "translate-x-3.5" : "translate-x-0"
        }`}
      />
    </button>
  );
}
