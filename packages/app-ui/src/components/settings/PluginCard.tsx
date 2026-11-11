/**
 * @fileoverview 插件卡片外框：图标块、标题行、描述、标签行、右侧状态控件与卡片内扩展区。
 *
 * 内置插件与外部插件都用这一个外框渲染，保证两类插件在设置页里视觉一致；
 * 各自的数据来源与操作逻辑留在调用方。
 */

import type { ReactNode } from "react";
import { SettingsSwitch } from "./SettingsSwitch";

export interface PluginCardProps {
  /** 16px 线性图标，卡片负责放进统一的图标块。 */
  readonly icon: ReactNode;
  readonly title: ReactNode;
  /** 跟在标题后面的徽标，如「官方」或版本号。 */
  readonly badges?: ReactNode;
  readonly description?: ReactNode;
  /** 描述下方的标签行，通常由 `pluginCodeChipClassName` / `pluginTagChipClassName` 组成。 */
  readonly meta?: ReactNode;
  /** 右上角控件，通常是 `PluginToggle`。 */
  readonly trailing?: ReactNode;
  /** 停用态降低视觉权重。 */
  readonly dimmed?: boolean;
  /** 卡片内扩展区（操作按钮、快捷键、插件配置），与标题列左对齐。 */
  readonly children?: ReactNode;
}

export function PluginCard({
  icon,
  title,
  badges,
  description,
  meta,
  trailing,
  dimmed = false,
  children,
}: PluginCardProps) {
  return (
    <div
      className={`relative flex flex-col gap-2.5 rounded-lg border px-4 py-3 transition-[border-color,background-color,opacity] duration-200 ${
        dimmed
          ? "border-[var(--theme-border)]/60 bg-[var(--theme-chrome)]/40 opacity-80 hover:border-[var(--theme-border)] hover:opacity-100"
          : "border-[var(--theme-border)] bg-[var(--theme-surface)] hover:border-[var(--theme-border-strong)]"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div
            className={`flex size-8 shrink-0 items-center justify-center rounded-md border transition-colors ${
              dimmed
                ? "border-[var(--theme-border)]/50 bg-[var(--theme-chrome)]/30 opacity-70"
                : "border-[var(--theme-border)] bg-[var(--theme-chrome)]"
            }`}
          >
            {icon}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[13px] font-medium text-[var(--theme-title)]">{title}</span>
              {badges}
            </div>
            {description && (
              <p className="mb-1.5 mt-0.5 text-[12px] leading-relaxed text-[var(--theme-muted)]">
                {description}
              </p>
            )}
            {meta && <div className="flex flex-wrap items-center gap-1.5">{meta}</div>}
          </div>
        </div>
        {trailing && <div className="flex shrink-0 items-center gap-2 pt-0.5">{trailing}</div>}
      </div>
      {/* 图标块 32px + 间距 12px，扩展区与标题列对齐。 */}
      {children && <div className="grid gap-2.5 pl-11 max-[560px]:pl-0">{children}</div>}
    </div>
  );
}

export type PluginToggleTone = "enabled" | "disabled" | "pending" | "danger";

const TOGGLE_TONE_CLASS: Record<PluginToggleTone, string> = {
  enabled: "text-[var(--theme-primary)]",
  disabled: "text-[var(--theme-muted)]",
  pending: "text-[var(--theme-muted)]",
  danger: "text-[var(--theme-danger-text)]",
};

export interface PluginToggleProps {
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly ariaLabel: string;
  /** 开关左侧的状态文字，如「已启用」「正在启用」「启用失败」。 */
  readonly statusLabel: string;
  /** 不传时按 `checked` 取启用/停用色。 */
  readonly tone?: PluginToggleTone;
  readonly disabled?: boolean;
}

/** 卡片右上角的「状态文字 + 开关」组合。 */
export function PluginToggle({
  checked,
  onChange,
  ariaLabel,
  statusLabel,
  tone,
  disabled,
}: PluginToggleProps) {
  const resolvedTone = tone ?? (checked ? "enabled" : "disabled");
  return (
    <>
      <span
        className={`text-[12px] font-medium transition-colors ${TOGGLE_TONE_CLASS[resolvedTone]}`}
      >
        {statusLabel}
      </span>
      <SettingsSwitch
        checked={checked}
        onChange={onChange}
        ariaLabel={ariaLabel}
        disabled={disabled}
      />
    </>
  );
}
