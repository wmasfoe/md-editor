import {
  Bars3Icon,
  Cog6ToothIcon,
  MoonIcon,
  SunIcon,
  SparklesIcon,
  ArrowDownTrayIcon,
  DocumentDuplicateIcon,
  CheckIcon,
} from "@heroicons/react/24/outline";
import { useTranslation } from "@md-editor/i18n";

export interface WebHeaderProps {
  readonly theme: "light" | "dark" | "system";
  readonly isSidebarVisible: boolean;
  readonly activeFilePath: string | null;
  readonly isDirty: boolean;
  readonly mode: "wysiwyg" | "source";
  readonly isCopied: boolean;
  readonly onToggleSidebar: () => void;
  readonly onToggleMode: (mode: "wysiwyg" | "source") => void;
  readonly onToggleTheme: () => void;
  readonly onOpenSettings: () => void;
  readonly onTriggerAi: () => void;
  readonly onCopy: () => void;
  readonly onExport: () => void;
}

export function WebHeader({
  theme,
  isSidebarVisible,
  activeFilePath,
  isDirty,
  mode,
  isCopied,
  onToggleSidebar,
  onToggleMode,
  onToggleTheme,
  onOpenSettings,
  onTriggerAi,
  onCopy,
  onExport,
}: WebHeaderProps) {
  const { t } = useTranslation();
  const isMac =
    typeof navigator !== "undefined" &&
    /Mac|iPod|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  const modKey = isMac ? "⌘" : "Ctrl";

  const fileName = activeFilePath ? activeFilePath.split("/").pop() : "草稿文档";

  return (
    <header className="flex h-12 shrink-0 select-none items-center justify-between border-b border-[var(--theme-border)] bg-[var(--theme-chrome)] px-3 text-[var(--theme-text)]">
      {/* 左侧：侧栏开关 + 文档信息 */}
      <div className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          onClick={onToggleSidebar}
          title={isSidebarVisible ? "收起侧边栏 (Mod-B)" : "展开侧边栏 (Mod-B)"}
          className="flex size-7 items-center justify-center rounded-md text-[var(--theme-control-text)] hover:bg-[var(--theme-control-hover)] hover:text-[var(--theme-title)] active:scale-95"
        >
          <Bars3Icon className="size-4" />
        </button>

        <div className="flex items-center gap-2">
          <div className="flex size-6.5 items-center justify-center rounded-md bg-[var(--theme-primary)] text-white shadow-xs">
            <span className="text-[11px] font-bold leading-none">Ink</span>
          </div>

          <div className="flex min-w-0 items-center gap-1.5 text-xs">
            <span className="truncate font-semibold text-[var(--theme-title)]">
              {fileName}
              {isDirty ? "*" : ""}
            </span>
            {activeFilePath && (
              <span className="hidden truncate text-[var(--theme-muted)] sm:inline">
                ({activeFilePath})
              </span>
            )}
          </div>
        </div>
      </div>

      {/* 中间：所见即所得 / 源码模式切换胶囊 */}
      <div className="hidden items-center rounded-lg border border-[var(--theme-border)] bg-[var(--theme-surface)] p-0.5 md:flex">
        <button
          type="button"
          onClick={() => onToggleMode("wysiwyg")}
          className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
            mode === "wysiwyg"
              ? "bg-[var(--theme-primary-soft)] text-[var(--theme-primary)] font-semibold shadow-2xs"
              : "text-[var(--theme-control-text)] hover:text-[var(--theme-title)]"
          }`}
        >
          所见即所得
        </button>
        <button
          type="button"
          onClick={() => onToggleMode("source")}
          className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
            mode === "source"
              ? "bg-[var(--theme-primary-soft)] text-[var(--theme-primary)] font-semibold shadow-2xs"
              : "text-[var(--theme-control-text)] hover:text-[var(--theme-title)]"
          }`}
        >
          源码模式
        </button>
      </div>

      {/* 右侧：操作区 */}
      <div className="flex items-center gap-1">
        {/* AI 续写按钮 */}
        <button
          type="button"
          onClick={onTriggerAi}
          className="flex h-7.5 items-center gap-1.5 rounded-lg bg-[var(--theme-primary-soft)] px-2.5 text-xs font-medium text-[var(--theme-primary)] transition-all hover:bg-[var(--theme-primary-selected)] active:scale-95"
          title={`AI 智能续写 (${modKey}-J)`}
        >
          <SparklesIcon className="size-3.5 animate-pulse" />
          <span className="hidden sm:inline">AI 续写</span>
        </button>

        {/* 复制 */}
        <button
          type="button"
          onClick={onCopy}
          className="grid size-7.5 place-items-center rounded-md text-[var(--theme-control-text)] hover:bg-[var(--theme-control-hover)] hover:text-[var(--theme-title)] active:scale-95"
          title="复制 Markdown"
        >
          {isCopied ? (
            <CheckIcon className="size-4 text-emerald-600" />
          ) : (
            <DocumentDuplicateIcon className="size-4" />
          )}
        </button>

        {/* 导出 */}
        <button
          type="button"
          onClick={onExport}
          className="grid size-7.5 place-items-center rounded-md text-[var(--theme-control-text)] hover:bg-[var(--theme-control-hover)] hover:text-[var(--theme-title)] active:scale-95"
          title="导出 Markdown"
        >
          <ArrowDownTrayIcon className="size-4" />
        </button>

        {/* 主题切换 */}
        <button
          type="button"
          onClick={onToggleTheme}
          className="grid size-7.5 place-items-center rounded-md text-[var(--theme-control-text)] hover:bg-[var(--theme-control-hover)] hover:text-[var(--theme-title)] active:scale-95"
          title={theme === "dark" ? t("web.toggleLight") : t("web.toggleDark")}
        >
          {theme === "dark" ? <SunIcon className="size-4" /> : <MoonIcon className="size-4" />}
        </button>

        {/* 设置 */}
        <button
          type="button"
          onClick={onOpenSettings}
          className="grid size-7.5 place-items-center rounded-md text-[var(--theme-control-text)] hover:bg-[var(--theme-control-hover)] hover:text-[var(--theme-title)] active:scale-95"
          title={t("web.openSettingsWithShortcut", { modKey })}
        >
          <Cog6ToothIcon className="size-4" />
        </button>
      </div>
    </header>
  );
}
