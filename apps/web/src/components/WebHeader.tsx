import React from "react";
import { Cog6ToothIcon, MoonIcon, SunIcon } from "@heroicons/react/24/outline";

export interface WebHeaderProps {
  readonly theme: "light" | "dark" | "system";
  readonly onToggleTheme: () => void;
  readonly onOpenSettings: () => void;
}

export function WebHeader({ theme, onToggleTheme, onOpenSettings }: WebHeaderProps) {
  const isMac =
    typeof navigator !== "undefined" &&
    /Mac|iPod|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  const modKey = isMac ? "⌘" : "Ctrl";

  return (
    <header className="flex h-12 shrink-0 select-none items-center justify-between border-b border-[var(--theme-border)] bg-[var(--theme-chrome)] px-4 text-[var(--theme-text)]">
      {/* 左侧：Logo 与标识 */}
      <div className="flex items-center gap-2.5">
        <div className="flex size-7 items-center justify-center rounded-lg bg-[var(--theme-primary)] text-white shadow-sm">
          <span className="text-xs font-bold leading-none">Ink</span>
        </div>
        <div className="flex items-baseline gap-1.5">
          <span className="text-sm font-semibold tracking-tight text-[var(--theme-title)]">
            Inkpoint
          </span>
          <span className="rounded bg-[var(--theme-primary-soft)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--theme-primary)]">
            Playground
          </span>
        </div>
      </div>

      {/* 右侧：仅保留明暗模式切换与设置菜单 */}
      <div className="flex items-center gap-1.5">
        {/* 主题明暗切换 */}
        <button
          type="button"
          className="grid size-8 place-items-center rounded-md text-[var(--theme-muted)] transition-colors hover:bg-[var(--theme-control-hover)] hover:text-[var(--theme-title)]"
          title={theme === "dark" ? "切换为浅色模式" : "切换为深色模式"}
          onClick={onToggleTheme}
        >
          {theme === "dark" ? <SunIcon className="size-4" /> : <MoonIcon className="size-4" />}
        </button>

        {/* 设置菜单 */}
        <button
          type="button"
          className="grid size-8 place-items-center rounded-md text-[var(--theme-muted)] transition-colors hover:bg-[var(--theme-control-hover)] hover:text-[var(--theme-title)]"
          title={`设置与快捷键指南 (${modKey},)`}
          onClick={onOpenSettings}
        >
          <Cog6ToothIcon className="size-4" />
        </button>
      </div>
    </header>
  );
}
