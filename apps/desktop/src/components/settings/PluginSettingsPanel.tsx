import type { ReactNode } from "react";
import {
  OFFICIAL_SYNTAX_PLUGINS_METADATA,
  type OfficialSyntaxPluginDescriptor,
  type OfficialSyntaxPluginId,
} from "@md-editor/syntax-plugins";
import type { PluginSettings } from "../../app/settings/app-settings";
import {
  settingsDescriptionClassName,
  settingsModuleClassName,
  settingsSectionTitleClassName,
} from "./settingsStyles";

interface PluginSettingsPanelProps {
  readonly pluginsDraft: PluginSettings;
  readonly onTogglePlugin: (pluginId: string, enabled: boolean) => void;
}

/**
 * 官方插件专属高精矢量 SVG 图标（遵循零 Emoji 规范）
 */
function PluginIcon({ id }: { readonly id: OfficialSyntaxPluginId }): ReactNode {
  switch (id) {
    case "markdown.math":
      return (
        <svg
          className="size-5 text-[var(--theme-primary)]"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          {/* 数学求和/公式 Sigma 符号与根号积分几何构型 */}
          <path d="M18 4H6l7 8-7 8h12" />
        </svg>
      );
    case "markdown.mermaid":
      return (
        <svg
          className="size-5 text-emerald-600 dark:text-emerald-400"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          {/* Mermaid 分支流程与拓扑节点 */}
          <rect x="3" y="3" width="6" height="6" rx="1.5" />
          <rect x="15" y="15" width="6" height="6" rx="1.5" />
          <rect x="15" y="3" width="6" height="6" rx="1.5" />
          <path d="M9 6h3a3 3 0 0 1 3 3v6" />
          <path d="M12 6h3" />
        </svg>
      );
    case "markdown.directive":
      return (
        <svg
          className="size-5 text-sky-600 dark:text-sky-400"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          {/* Admonition 容器卡片与信息提示 */}
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M12 8v4" />
          <path d="M12 16h.01" />
        </svg>
      );
    default:
      return (
        <svg
          className="size-5 text-[var(--theme-muted)]"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M12 2v20M2 12h20" />
        </svg>
      );
  }
}

/**
 * 官方认证徽章矢量 SVG 图标
 */
function OfficialBadgeIcon(): ReactNode {
  return (
    <svg className="size-3 shrink-0" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path
        fillRule="evenodd"
        d="M8 1.5a6.5 6.5 0 0 0-4.596 11.1L8 15.5l4.596-2.9A6.5 6.5 0 0 0 8 1.5Zm2.78 5.28a.75.75 0 0 0-1.06-1.06L7.25 8.19 6.28 7.22a.75.75 0 0 0-1.06 1.06l1.5 1.5a.75.75 0 0 0 1.06 0l2-2Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

/**
 * 积木拼装（更多插件研发中）矢量 SVG 图标
 */
function PuzzleIcon(): ReactNode {
  return (
    <svg
      className="size-5 shrink-0 text-amber-500/90"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M19.439 7.85c-.049-.955-.24-1.815-.572-2.583a5.55 5.55 0 0 0-2.316-2.316C15.783 2.62 14.923 2.429 13.968 2.38A6.38 6.38 0 0 0 12 2a6.38 6.38 0 0 0-1.968.38c-.955.049-1.815.24-2.583.572a5.55 5.55 0 0 0-2.316 2.316c-.332.768-.523 1.628-.572 2.583A6.38 6.38 0 0 0 4.18 9.818c.049.955.24 1.815.572 2.583.535 1.238 1.48 2.053 2.316 2.316.768.332 1.628.523 2.583.572.639.033 1.309.033 1.968 0 .955-.049 1.815-.24 2.583-.572a5.55 5.55 0 0 0 2.316-2.316c.332-.768.523-1.628.572-2.583.033-.639.033-1.309 0-1.968Z" />
      <path d="M9 12h6" />
      <path d="M12 9v6" />
    </svg>
  );
}

/**
 * OpenDesign & Claude Design 风格 Switch 滑块组件
 * 具备精致微阴影、平滑弹性滑动、键盘操作与无障碍 (a11y) 支持
 */
function ClaudeSwitch({
  checked,
  onChange,
  ariaLabel,
}: {
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly ariaLabel: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={() => onChange(!checked)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onChange(!checked);
        }
      }}
      className={`group relative inline-flex h-[22px] w-[38px] shrink-0 cursor-pointer items-center rounded-full p-[2px] transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--theme-surface)] ${
        checked
          ? "bg-[var(--theme-primary)] shadow-inner"
          : "bg-[var(--theme-border-strong)] hover:bg-[var(--theme-border-strong)]/80"
      }`}
    >
      <span
        aria-hidden="true"
        className={`pointer-events-none inline-block size-[18px] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.2),0_1px_2px_rgba(0,0,0,0.12)] ring-0 transition-transform duration-200 ease-in-out ${
          checked ? "translate-x-4" : "translate-x-0"
        }`}
      />
    </button>
  );
}

/**
 * 单个插件设置卡片（Claude Design 精致风格）
 */
function PluginItemCard({
  descriptor,
  isEnabled,
  onToggle,
}: {
  readonly descriptor: OfficialSyntaxPluginDescriptor;
  readonly isEnabled: boolean;
  readonly onToggle: (enabled: boolean) => void;
}) {
  return (
    <div
      className={`relative flex flex-col justify-between gap-3 rounded-xl border p-4 transition-all duration-200 ${
        isEnabled
          ? "border-[var(--theme-border)] bg-[var(--theme-surface)] shadow-sm hover:border-[var(--theme-border-strong)]"
          : "border-[var(--theme-border)]/60 bg-[var(--theme-chrome)]/40 opacity-80 hover:opacity-100 hover:border-[var(--theme-border)]"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        {/* 左侧：图标 + 标题 + 官方徽章 */}
        <div className="flex items-start gap-3.5 min-w-0">
          <div
            className={`flex size-10 shrink-0 items-center justify-center rounded-lg border transition-colors ${
              isEnabled
                ? "border-[var(--theme-border)] bg-[var(--theme-chrome)]"
                : "border-[var(--theme-border)]/50 bg-[var(--theme-chrome)]/30 opacity-70"
            }`}
          >
            <PluginIcon id={descriptor.id} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[14px] font-semibold text-[var(--theme-title)]">
                {descriptor.name}
              </span>

              {/* 官方认证徽章 (OpenDesign & Claude 风格微胶囊) */}
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/25 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-400">
                <OfficialBadgeIcon />
                <span>官方</span>
              </span>
            </div>

            {/* 描述信息 */}
            <p className="mb-2 mt-1 text-[12px] leading-relaxed text-[var(--theme-muted)]">
              {descriptor.description}
            </p>

            {/* 语法提示与特性标签 */}
            <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
              <span className="rounded bg-[var(--theme-chrome)] px-2 py-0.5 font-mono text-[11px] text-[var(--theme-control-text)] border border-[var(--theme-border)]">
                {descriptor.syntaxHint}
              </span>
              {descriptor.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded bg-[var(--theme-chrome)]/60 px-1.5 py-0.5 text-[11px] text-[var(--theme-muted)]"
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* 右侧：精美 Switch 滑块 */}
        <div className="flex shrink-0 items-center gap-2 pt-0.5">
          <span
            className={`text-[12px] font-medium transition-colors ${
              isEnabled ? "text-[var(--theme-primary)]" : "text-[var(--theme-muted)]"
            }`}
          >
            {isEnabled ? "已启用" : "已停用"}
          </span>
          <ClaudeSwitch
            checked={isEnabled}
            onChange={onToggle}
            ariaLabel={`切换 ${descriptor.name} 启用状态`}
          />
        </div>
      </div>
    </div>
  );
}

export function PluginSettingsPanel({ pluginsDraft, onTogglePlugin }: PluginSettingsPanelProps) {
  return (
    <section className={settingsModuleClassName} aria-labelledby="plugin-settings-title">
      <div className="mb-4">
        <h2 id="plugin-settings-title" className={settingsSectionTitleClassName}>
          插件管理
        </h2>
        <p className={settingsDescriptionClassName}>
          管理编辑器内置的高级语法与图表渲染插件。启用后即可享受原位所见即所得交互，停用则安全降级为标准
          CommonMark 代码呈现。
        </p>
      </div>

      <div className="grid gap-3.5">
        {/* 官方插件列表 */}
        {OFFICIAL_SYNTAX_PLUGINS_METADATA.map((descriptor) => {
          const isEnabled = pluginsDraft.enabled[descriptor.id] ?? descriptor.defaultEnabled;
          return (
            <PluginItemCard
              key={descriptor.id}
              descriptor={descriptor}
              isEnabled={isEnabled}
              onToggle={(enabled) => onTogglePlugin(descriptor.id, enabled)}
            />
          );
        })}

        {/* 更多插件开发中卡片（Claude / OpenDesign 风格虚线探索预告） */}
        <div className="mt-1 flex items-center justify-between gap-3.5 rounded-xl border border-dashed border-[var(--theme-border-strong)] bg-[var(--theme-chrome)]/35 p-4 transition-colors">
          <div className="flex items-center gap-3.5 min-w-0">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-[var(--theme-border)] bg-[var(--theme-surface)]">
              <PuzzleIcon />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-semibold text-[var(--theme-title)]">
                  更多插件正在持续研发中
                </span>
                <span className="rounded-full bg-[var(--theme-primary-soft)] px-2 py-0.5 text-[10px] font-medium text-[var(--theme-primary)]">
                  敬请期待
                </span>
              </div>
              <p className="m-0 mt-0.5 text-[12px] leading-relaxed text-[var(--theme-muted)]">
                思维导图 (Mindmap)、流程图画板
                (Excalidraw)、甘特图强化与图床扩展等功能正在紧锣密鼓开发中。
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
