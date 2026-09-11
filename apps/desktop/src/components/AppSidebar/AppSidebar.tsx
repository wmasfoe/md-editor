import { useMemo, useState, type CSSProperties } from "react";
import { FolderIcon, MagnifyingGlassIcon, QueueListIcon } from "@heroicons/react/24/outline";
import type { RuntimeFileService } from "@md-editor/file-system";
import {
  DocumentBar,
  OutlinePanel,
  useEditorUiActions,
  useEditorUiState,
} from "@md-editor/editor-ui";
import { useTranslation } from "@md-editor/i18n";
import { FileTreePanel } from "../FileTreePanel";
import { AppTitleBar } from "../../app/AppWindowChrome";
import { useDesktopEditorActions } from "../../app/context/DesktopEditorActionsContext";
import { useDocumentSnapshot } from "../../app/document-store";
import { useDocumentUiStore } from "../../app/stores/document-ui-store";
import { useFileTreeStore } from "../../app/stores/file-tree-store";
import { useSidebarStore } from "../../app/stores/sidebar-store";
import { cx } from "../../lib/cx";
import { countMatchedFiles } from "./file-search";

export interface AppSidebarProps {
  readonly fileService: RuntimeFileService;
  readonly sidebarWidth: number;
  readonly shouldShowOverlayTitleBar: boolean;
}

const sidebarHeaderIconButtonClassName =
  "grid size-[28px] place-items-center rounded-[5px] border-0 bg-transparent text-[var(--theme-control-text)] transition-all duration-120 ease-out hover:bg-[var(--theme-control-hover)] hover:text-[var(--theme-title)] active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--theme-primary)] [&_svg]:size-4 [&_svg]:fill-none [&_svg]:stroke-current [&_svg]:stroke-[1.35] [&_svg]:[stroke-linecap:round] [&_svg]:[stroke-linejoin:round]";

/**
 * 桌面端主界面侧边栏组件。
 *
 * 职责：
 * 1. 展现移动端遮罩 Backdrop 与桌面端分栏 Aside 布局；
 * 2. 头部导航：在“文件树”与“文档大纲”之间切换，并提供快速文件搜索入口；
 * 3. 实时文件检索输入栏与匹配数量统计（搜索状态完全内聚在侧栏内部，避免输入影响主工作区）；
 * 4. 底部文档状态栏（DocumentBar）：模式切换（所见即所得/源码）及快捷打开偏好设置。
 */
export function AppSidebar({
  fileService,
  sidebarWidth,
  shouldShowOverlayTitleBar,
}: AppSidebarProps) {
  const { t } = useTranslation();
  const snapshot = useDocumentSnapshot();
  const { hasActiveDocument } = useDocumentUiStore();
  const { isSidebarVisible, sidebarMode, setIsSidebarVisible, setSidebarMode } = useSidebarStore();
  const { outline, activeOutlineId } = useEditorUiState();
  const { jumpToTocItem } = useEditorUiActions();
  const { dispatchCommand } = useDesktopEditorActions();

  const [isFileSearchOpen, setIsFileSearchOpen] = useState(false);
  const [fileSearchQuery, setFileSearchQuery] = useState("");

  const folderTree = useFileTreeStore((s) => s.folder?.tree ?? null);
  const fileSearchResultCount = useMemo(
    () => countMatchedFiles(folderTree, fileSearchQuery),
    [folderTree, fileSearchQuery],
  );

  const sidebarTitle = sidebarMode === "files" ? t("sidebar.files") : t("sidebar.outline");
  const showFileSearch = sidebarMode === "files" && isFileSearchOpen;

  return (
    <>
      {/* 移动端/小屏幕 (<960px) 展开抽屉时的半透明遮罩背景 */}
      {isSidebarVisible ? (
        <button
          type="button"
          className="fixed inset-0 z-[29] hidden border-0 bg-[rgba(20,27,35,0.12)] max-[959px]:block"
          aria-label={t("sidebar.closeSidebar")}
          onClick={() => setIsSidebarVisible(false)}
        />
      ) : null}

      <aside
        className={cx(
          "relative flex min-h-0 w-0 min-w-0 flex-[0_0_0] select-none flex-col overflow-hidden border-r border-[var(--theme-border)] bg-[var(--theme-chrome)] text-[var(--theme-control-text)] opacity-0 transition-[width,flex-basis,opacity] duration-300 ease-out max-[959px]:fixed max-[959px]:inset-y-0 max-[959px]:left-0 max-[959px]:z-30 max-[959px]:shadow-[var(--theme-shadow)] motion-reduce:transition-none",
          isSidebarVisible &&
            "w-[var(--app-sidebar-width,272px)] min-w-[220px] max-w-[420px] flex-[0_0_var(--app-sidebar-width,272px)] opacity-100 max-[959px]:w-[min(var(--app-sidebar-width,272px),calc(100vw_-_64px))] max-[959px]:min-w-[min(220px,calc(100vw_-_64px))] max-[959px]:max-w-[calc(100vw_-_64px)] max-[959px]:flex-[0_0_min(var(--app-sidebar-width,272px),calc(100vw_-_64px))]",
        )}
        style={
          {
            "--app-sidebar-width": `${sidebarWidth}px`,
            borderRightWidth: isSidebarVisible ? 1 : 0,
          } as CSSProperties
        }
        aria-label={sidebarMode === "files" ? t("sidebar.fileTreeAria") : t("sidebar.outlineAria")}
        aria-hidden={!isSidebarVisible}
        inert={!isSidebarVisible}
      >
        {/* macOS 自定义红黄绿交通灯占位区域 */}
        <AppTitleBar
          isVisible={shouldShowOverlayTitleBar}
          hasWindowControlsInset
          className="border-b-0 bg-transparent"
        />

        {/* 侧栏顶栏：模式切换按钮、标题与搜索开关 */}
        <div className="grid h-[38px] shrink-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 border-b border-[var(--theme-border)] bg-[var(--theme-chrome)] px-2.5">
          <button
            type="button"
            className={sidebarHeaderIconButtonClassName}
            aria-label={
              sidebarMode === "files" ? t("sidebar.switchToOutline") : t("sidebar.switchToFiles")
            }
            title={
              sidebarMode === "files" ? t("sidebar.switchToOutline") : t("sidebar.switchToFiles")
            }
            onClick={() => setSidebarMode(sidebarMode === "files" ? "outline" : "files")}
          >
            {sidebarMode === "files" ? (
              <FolderIcon aria-hidden="true" />
            ) : (
              <QueueListIcon aria-hidden="true" />
            )}
          </button>
          <strong className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-center text-[13px] font-semibold leading-none tracking-tight text-[var(--theme-title)]">
            {sidebarTitle}
          </strong>
          <button
            type="button"
            className={cx(
              sidebarHeaderIconButtonClassName,
              isFileSearchOpen && "bg-[var(--theme-control-active)] text-[var(--theme-title)]",
            )}
            aria-label={isFileSearchOpen ? t("sidebar.closeFileSearch") : t("sidebar.searchFiles")}
            aria-pressed={isFileSearchOpen}
            title={t("sidebar.searchFiles")}
            onClick={() => {
              setSidebarMode("files");
              setIsFileSearchOpen((current) => !current);
            }}
          >
            <MagnifyingGlassIcon aria-hidden="true" />
          </button>
        </div>

        {/* 文件搜索输入框 */}
        {showFileSearch ? (
          <div
            className="grid min-h-[36px] shrink-0 grid-cols-[16px_minmax(0,1fr)_minmax(16px,auto)] items-center gap-[7px] border-b border-[var(--theme-border)] bg-[var(--theme-chrome)] px-3 py-1.5 text-[var(--theme-control-subtle)] [&_svg]:size-4 [&_svg]:fill-none [&_svg]:stroke-current [&_svg]:stroke-[1.35] [&_svg]:[stroke-linecap:round] [&_svg]:[stroke-linejoin:round]"
            role="search"
          >
            <MagnifyingGlassIcon aria-hidden="true" />
            <input
              type="search"
              className="h-[26px] min-w-0 border-0 bg-transparent font-sans text-[13px] leading-none text-[var(--theme-title)] outline-none placeholder:text-[var(--theme-control-subtle)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--theme-primary)]"
              value={fileSearchQuery}
              autoFocus
              placeholder={t("sidebar.searchFilesPlaceholder")}
              aria-label={t("sidebar.searchFilesAria")}
              onChange={(event) => setFileSearchQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setFileSearchQuery("");
                  setIsFileSearchOpen(false);
                }
              }}
            />
            <span
              className="min-w-4 text-right text-[11px] leading-none text-[var(--theme-control-subtle)]"
              aria-live="polite"
              title={t("sidebar.matchCount")}
            >
              {fileSearchQuery.trim() ? fileSearchResultCount : ""}
            </span>
          </div>
        ) : null}

        {/* 侧栏主体展示区：根据模式展示文件树或大纲 */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {sidebarMode === "files" ? (
            <FileTreePanel
              fileService={fileService}
              searchQuery={showFileSearch ? fileSearchQuery : ""}
            />
          ) : (
            <OutlinePanel outline={outline} activeId={activeOutlineId} onJump={jumpToTocItem} />
          )}
        </div>

        {/* 侧栏底栏操作区：视图模式与偏好设置入口 */}
        <DocumentBar
          hasActiveDocument={hasActiveDocument}
          mode={snapshot.mode}
          onChangeMode={(mode) => {
            if (mode !== snapshot.mode) {
              void dispatchCommand(mode === "source" ? "view.toggleSource" : "view.showWysiwyg");
            }
          }}
          onOpenSettings={() => void dispatchCommand("settings.open")}
        />
      </aside>
    </>
  );
}
