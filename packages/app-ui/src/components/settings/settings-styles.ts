/**
 * @fileoverview 跨端统一设置面板样式类名令牌 (Shared Settings Styles)
 */

export const settingsModuleClassName = "py-1";

export const settingsSectionTitleClassName = "m-0 text-sm leading-[1.4] text-[var(--theme-title)]";

export const settingsDescriptionClassName =
  "mb-0 mt-1 text-xs leading-normal text-[var(--theme-muted)]";

export const settingsFieldLabelClassName =
  "block text-[13px] font-semibold text-[var(--theme-title)]";

export const settingsInputClassName =
  "h-[30px] w-full rounded-[5px] border border-[var(--theme-border-strong)] bg-[var(--theme-surface)] px-2 text-[13px] leading-none text-[var(--theme-text)] outline-none read-only:cursor-default focus:border-[var(--theme-primary)] focus:shadow-[0_0_0_2px_var(--theme-primary-soft)]";

export const settingsSmallButtonClassName =
  "h-[30px] px-2.5 rounded-[5px] border border-[var(--theme-border-strong)] bg-[var(--theme-surface)] text-xs text-[var(--theme-control-text)] hover:bg-[var(--theme-control-hover)] hover:text-[var(--theme-title)] disabled:opacity-55 shrink-0 whitespace-nowrap";

/** 插件卡片标签行：语法提示等等宽代码标签。 */
export const pluginCodeChipClassName =
  "rounded border border-[var(--theme-border)] bg-[var(--theme-chrome)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--theme-control-text)]";

/** 插件卡片标签行：普通描述标签。 */
export const pluginTagChipClassName =
  "rounded bg-[var(--theme-chrome)]/60 px-1.5 py-0.5 text-[11px] text-[var(--theme-muted)]";

/** 插件卡片标题旁的胶囊徽标（中性色），如版本号。 */
export const pluginBadgeClassName =
  "inline-flex items-center gap-1 rounded-full border border-[var(--theme-border)] bg-[var(--theme-chrome)] px-2 py-0.5 text-[11px] font-medium text-[var(--theme-muted)]";

/** 卡片内的文字型次要操作按钮（检查更新、回退、移除等）。 */
export const settingsTextButtonClassName =
  "inline-flex h-7 items-center gap-1 rounded-lg px-2 text-xs text-[var(--theme-control-text)] transition-colors hover:bg-[var(--theme-control-hover)] hover:text-[var(--theme-title)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--theme-primary)] disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent";

/** 文字按钮的危险态（移除等不可撤销操作）。 */
export const settingsDangerTextButtonClassName =
  "inline-flex h-7 items-center gap-1 rounded-lg px-2 text-xs text-[var(--theme-danger-text)] transition-colors hover:bg-[var(--theme-danger-bg)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--theme-primary)] disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent";

/** 设置面板内的行内错误提示框。 */
export const settingsErrorNoticeClassName =
  "rounded-lg border border-[var(--theme-danger-text)]/25 bg-[var(--theme-danger-bg)] px-3 py-2 text-xs leading-normal text-[var(--theme-danger-text)]";

/** 与 `settingsSmallButtonClassName` 同尺寸的强调按钮（安装等主操作）。 */
export const settingsPrimarySmallButtonClassName =
  "h-[30px] px-2.5 rounded-[5px] border border-[var(--theme-primary-fill)] bg-[var(--theme-primary-fill)] text-xs text-white hover:bg-[color-mix(in_srgb,var(--theme-primary-fill)_88%,black)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--theme-primary)] disabled:opacity-55 shrink-0 whitespace-nowrap";
