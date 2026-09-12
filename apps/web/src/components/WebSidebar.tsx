import { useState, type CSSProperties } from "react";
import {
  FolderIcon,
  QueueListIcon,
  MagnifyingGlassIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { DocumentBar, OutlinePanel, type OutlineItem } from "@md-editor/editor-ui";
import { useTranslation } from "@md-editor/i18n";
import type { MarkdownFileTreeNode, MarkdownFolder } from "@md-editor/file-system";
import { WebFileTreePanel } from "./WebFileTreePanel";
import { cx } from "../lib/cx";

export type SidebarTab = "files" | "outline";

export interface WebSidebarProps {
  readonly isVisible: boolean;
  readonly sidebarWidth: number;
  readonly folder: MarkdownFolder | null;
  readonly activeFilePath: string | null;
  readonly mode: "wysiwyg" | "source";
  readonly outline: readonly OutlineItem[];
  readonly activeOutlineId?: string | null;
  readonly onSelectOutlineItem: (item: OutlineItem) => void;
  readonly onChangeMode: (mode: "wysiwyg" | "source") => void;
  readonly onOpenSettings: () => void;
  readonly onCloseSidebar: () => void;
  readonly onOpenFile: (path: string) => void;
  readonly onOpenAsset: (path: string) => void;
  readonly onOpenFolder: () => void;
  readonly onOpenSingleFile: () => void;
  readonly onNewDraft: () => void;
  readonly onRefreshFolder: () => void;
  readonly onCreateItem: (
    parentPath: string,
    name: string,
    kind: "markdown" | "directory",
  ) => Promise<void>;
  readonly onRenameItem: (node: MarkdownFileTreeNode, newName: string) => Promise<void>;
  readonly onDeleteItem: (node: MarkdownFileTreeNode) => Promise<void>;
}

export function WebSidebar({
  isVisible,
  sidebarWidth,
  folder,
  activeFilePath,
  mode,
  outline,
  activeOutlineId,
  onSelectOutlineItem,
  onChangeMode,
  onOpenSettings,
  onCloseSidebar,
  onOpenFile,
  onOpenAsset,
  onOpenFolder,
  onOpenSingleFile,
  onNewDraft,
  onRefreshFolder,
  onCreateItem,
  onRenameItem,
  onDeleteItem,
}: WebSidebarProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<SidebarTab>("files");
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const sidebarTitle = tab === "files" ? "文件" : "大纲";

  return (
    <>
      {/* 移动端遮罩背景 */}
      {isVisible ? (
        <button
          type="button"
          className="fixed inset-0 z-[29] hidden border-0 bg-[rgba(20,27,35,0.12)] max-[959px]:block"
          aria-label={t("sidebar.closeSidebar")}
          onClick={onCloseSidebar}
        />
      ) : null}

      <aside
        className={cx(
          "relative flex min-h-0 w-0 min-w-0 flex-[0_0_0] select-none flex-col overflow-hidden border-r border-[var(--theme-border)] bg-[var(--theme-chrome)] text-[var(--theme-control-text)] opacity-0 transition-[width,flex-basis,opacity] duration-300 ease-out max-[959px]:fixed max-[959px]:inset-y-0 max-[959px]:left-0 max-[959px]:z-30 max-[959px]:shadow-[var(--theme-shadow)] motion-reduce:transition-none",
          isVisible &&
            "w-[var(--app-sidebar-width,272px)] min-w-[220px] max-w-[420px] flex-[0_0_var(--app-sidebar-width,272px)] opacity-100 max-[959px]:w-[min(var(--app-sidebar-width,272px),calc(100vw_-_64px))] max-[959px]:min-w-[min(220px,calc(100vw_-_64px))] max-[959px]:max-w-[calc(100vw_-_64px)] max-[959px]:flex-[0_0_min(var(--app-sidebar-width,272px),calc(100vw_-_64px))]",
        )}
        style={
          {
            "--app-sidebar-width": `${sidebarWidth}px`,
            borderRightWidth: isVisible ? 1 : 0,
          } as CSSProperties
        }
        aria-label={tab === "files" ? "文件列表" : "文档大纲"}
        aria-hidden={!isVisible}
        inert={!isVisible}
      >
        {/* 顶部标题与切换 Tab */}
        <div className="grid h-[38px] shrink-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 border-b border-[var(--theme-border)] bg-[var(--theme-chrome)] px-2.5">
          <button
            type="button"
            className="grid size-[28px] place-items-center rounded-[5px] border-0 bg-transparent text-[var(--theme-control-text)] transition-all duration-120 hover:bg-[var(--theme-control-hover)] hover:text-[var(--theme-title)] active:scale-95"
            aria-label={tab === "files" ? "切换至文档大纲" : "切换至文件树"}
            title={tab === "files" ? "切换至文档大纲" : "切换至文件树"}
            onClick={() => setTab(tab === "files" ? "outline" : "files")}
          >
            {tab === "files" ? (
              <FolderIcon className="size-4 stroke-[1.4]" />
            ) : (
              <QueueListIcon className="size-4 stroke-[1.4]" />
            )}
          </button>

          <strong className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-center text-[13px] font-semibold leading-none tracking-tight text-[var(--theme-title)]">
            {sidebarTitle}
          </strong>

          {tab === "files" ? (
            <button
              type="button"
              className={cx(
                "grid size-[28px] place-items-center rounded-[5px] border-0 bg-transparent text-[var(--theme-control-text)] transition-all duration-120 hover:bg-[var(--theme-control-hover)] hover:text-[var(--theme-title)] active:scale-95",
                isSearchOpen && "bg-[var(--theme-control-hover)] text-[var(--theme-title)]",
              )}
              aria-label="搜索文件"
              title="搜索文件"
              onClick={() => {
                setIsSearchOpen((prev) => !prev);
                if (isSearchOpen) setSearchQuery("");
              }}
            >
              <MagnifyingGlassIcon className="size-4 stroke-[1.4]" />
            </button>
          ) : (
            <div className="size-[28px]" />
          )}
        </div>

        {/* 搜索展开框 */}
        {tab === "files" && isSearchOpen && (
          <div className="flex items-center gap-1.5 border-b border-[var(--theme-border)] bg-[var(--theme-chrome)] px-2.5 py-1.5 animate-in fade-in slide-in-from-top-1">
            <MagnifyingGlassIcon className="size-3.5 shrink-0 text-[var(--theme-control-subtle)]" />
            <input
              type="text"
              placeholder="快速检索文件..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-6 flex-1 bg-transparent text-xs text-[var(--theme-title)] placeholder:text-[var(--theme-control-subtle)] outline-none"
              autoFocus
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="text-[var(--theme-control-subtle)] hover:text-[var(--theme-title)]"
              >
                <XMarkIcon className="size-3.5" />
              </button>
            )}
          </div>
        )}

        {/* 侧栏主体内容 */}
        <div className="flex-1 overflow-hidden">
          {tab === "files" ? (
            <WebFileTreePanel
              folder={folder}
              activeFilePath={activeFilePath}
              searchQuery={searchQuery}
              onOpenFile={onOpenFile}
              onOpenAsset={onOpenAsset}
              onOpenFolder={onOpenFolder}
              onOpenSingleFile={onOpenSingleFile}
              onNewDraft={onNewDraft}
              onRefreshFolder={onRefreshFolder}
              onCreateItem={onCreateItem}
              onRenameItem={onRenameItem}
              onDeleteItem={onDeleteItem}
            />
          ) : (
            <div className="h-full overflow-y-auto p-2">
              <OutlinePanel
                outline={outline}
                activeId={activeOutlineId}
                onJump={(target) => {
                  const found = outline.find(
                    (item) => item.line === target.line && item.level === target.level,
                  );
                  if (found) {
                    onSelectOutlineItem(found);
                  }
                }}
              />
            </div>
          )}
        </div>

        {/* 底部状态栏 */}
        <DocumentBar
          hasActiveDocument={Boolean(activeFilePath || true)}
          mode={mode}
          onChangeMode={onChangeMode}
          onOpenSettings={onOpenSettings}
        />
      </aside>
    </>
  );
}
