// apps/utools/src/components/UtoolsStatusBar.tsx
// uTools 底部多功能状态栏：整合目录控制、活动文件状态与脏标记、新建/打开快捷动作、字数统计、编辑模式及设置

import type { MarkdownFolder } from "@md-editor/file-system";
import { openOfficialSite } from "../utools/referral";
import { ExternalLinkIcon, FolderIcon, NewFileIcon, PanelLeftIcon, SettingsIcon } from "./Icons";

export interface UtoolsStatusBarProps {
  filePath: string | null;
  isDirty?: boolean;
  folder: MarkdownFolder | null;
  isSidebarOpen: boolean;
  charCount: number;
  editorMode: "wysiwyg" | "source";
  onToggleSidebar: () => void;
  onNewFile: () => void;
  onOpenFile: () => void;
  onOpenFolder: () => void;
  onToggleSourceMode: () => void;
  onOpenSettings: () => void;
}

export function UtoolsStatusBar({
  filePath,
  isDirty = false,
  folder,
  isSidebarOpen,
  charCount,
  editorMode,
  onToggleSidebar,
  onNewFile,
  onOpenFile,
  onOpenFolder,
  onToggleSourceMode,
  onOpenSettings,
}: UtoolsStatusBarProps) {
  const fileName = filePath ? (filePath.split(/[/\\]/).pop() ?? "本地文件") : "未命名文档";
  const hasFolder = Boolean(folder);

  return (
    <footer className="h-8 px-3 bg-[var(--theme-surface)] border-t border-[var(--theme-border)] text-xs text-[var(--theme-muted)] flex items-center justify-between shrink-0 select-none">
      {/* 左侧：目录树开关、活动文件/脏标记、新建/打开动作、字数统计 */}
      <div className="flex items-center gap-2 min-w-0">
        <button
          type="button"
          onClick={onToggleSidebar}
          className={`flex items-center gap-1.5 px-2 py-0.5 rounded-[4px] cursor-pointer border transition-colors text-xs shrink-0 ${
            isSidebarOpen
              ? "bg-[var(--theme-primary-soft)] text-[var(--theme-primary)] border-[var(--theme-primary-soft)] font-medium"
              : "bg-transparent text-[var(--theme-muted)] border-transparent hover:text-[var(--theme-text)] hover:bg-[var(--theme-control-hover)]"
          }`}
          title={
            isSidebarOpen
              ? "收起文件树侧栏 (快捷键: Cmd+Shift+B 或 Ctrl+Shift+B)"
              : "展开文件树侧栏 (快捷键: Cmd+Shift+B 或 Ctrl+Shift+B)"
          }
        >
          <PanelLeftIcon className="size-3.5" />
          <span>目录</span>
        </button>

        <span className="h-3 w-px bg-[var(--theme-border)] shrink-0" aria-hidden="true" />

        {/* 当前编辑文件名与脏标记（对齐桌面端） */}
        <div
          className="flex items-center gap-1.5 min-w-0 max-w-[200px] shrink-0"
          title={filePath ? `${filePath}${isDirty ? " (未保存)" : ""}` : "未命名文档"}
        >
          <span
            className={`inline-block size-1.5 rounded-full shrink-0 transition-opacity ${
              isDirty ? "bg-[var(--theme-primary)] opacity-100" : "opacity-0"
            }`}
            aria-label={isDirty ? "未保存更改" : undefined}
          />
          <span
            className={`truncate text-xs ${
              filePath
                ? "font-medium text-[var(--theme-title)]"
                : "text-[var(--theme-muted)] italic"
            }`}
          >
            {fileName}
          </span>
        </div>

        <span className="h-3 w-px bg-[var(--theme-border)] shrink-0" aria-hidden="true" />

        {/* 快捷文件操作动作：新建、打开文件、工作区文件夹 */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={onNewFile}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded-[4px] text-xs text-[var(--theme-muted)] hover:text-[var(--theme-text)] hover:bg-[var(--theme-control-hover)] cursor-pointer bg-transparent border-0 transition-colors"
            title="新建文档 (快捷键: Cmd+N 或 Ctrl+N)"
          >
            <NewFileIcon className="size-3.5" />
            <span>新建</span>
          </button>

          <button
            type="button"
            onClick={onOpenFile}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded-[4px] text-xs text-[var(--theme-muted)] hover:text-[var(--theme-text)] hover:bg-[var(--theme-control-hover)] cursor-pointer bg-transparent border-0 transition-colors"
            title="打开本地 Markdown 文件 (快捷键: Cmd+O 或 Ctrl+O)"
          >
            <span>打开文件</span>
          </button>

          <button
            type="button"
            onClick={onOpenFolder}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded-[4px] text-xs text-[var(--theme-muted)] hover:text-[var(--theme-text)] hover:bg-[var(--theme-control-hover)] cursor-pointer bg-transparent border-0 transition-colors max-w-[140px] truncate"
            title={
              hasFolder
                ? `当前工作区: ${folder?.rootPath ?? ""} (点击更换文件夹，快捷键: Cmd+Shift+O)`
                : "打开本地文件夹并浏览完整目录树 (快捷键: Cmd+Shift+O)"
            }
          >
            <FolderIcon className="size-3.5" />
            <span className="truncate">
              {hasFolder ? (folder?.rootName ?? "文件夹") : "打开文件夹"}
            </span>
          </button>
        </div>

        <span className="h-3 w-px bg-[var(--theme-border)] shrink-0" aria-hidden="true" />

        <span className="text-xs text-[var(--theme-muted)] shrink-0 select-none">
          {charCount} 字符
        </span>
      </div>

      {/* 右侧：源码/所见即所得模式、偏好设置、官网链接 */}
      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={onToggleSourceMode}
          className="px-2 py-0.5 rounded-[4px] text-xs text-[var(--theme-muted)] hover:text-[var(--theme-text)] hover:bg-[var(--theme-control-hover)] cursor-pointer bg-transparent border-0 transition-colors"
          title="切换编辑模式 (快捷键: Cmd+/ 或 Ctrl+/)"
        >
          {editorMode === "source" ? "模式: 源码 (Cmd+/)" : "模式: 所见即所得 (Cmd+/)"}
        </button>

        <span className="h-3 w-px bg-[var(--theme-border)] shrink-0" aria-hidden="true" />

        <button
          type="button"
          onClick={onOpenSettings}
          className="px-2 py-0.5 rounded-[4px] text-xs text-[var(--theme-muted)] hover:text-[var(--theme-text)] hover:bg-[var(--theme-control-hover)] cursor-pointer bg-transparent border-0 transition-colors flex items-center gap-1"
          title="打开设置偏好与快捷键速查 (快捷键: Cmd+,)"
        >
          <SettingsIcon className="size-3.5" />
          <span>设置</span>
        </button>

        <span className="h-3 w-px bg-[var(--theme-border)] shrink-0" aria-hidden="true" />

        <button
          type="button"
          onClick={() => openOfficialSite("status_bar")}
          className="px-2 py-0.5 rounded-[4px] text-xs text-[var(--theme-muted)] hover:text-[var(--theme-primary)] hover:bg-[var(--theme-control-hover)] cursor-pointer bg-transparent border-0 transition-colors flex items-center gap-1"
          title="前往官网了解更多完整桌面功能"
        >
          <span>官网</span>
          <ExternalLinkIcon className="size-3" />
        </button>
      </div>
    </footer>
  );
}
