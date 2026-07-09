import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Menu,
  MenuButton,
  MenuItem,
  MenuItems,
  Popover,
  PopoverButton,
  PopoverPanel
} from "@headlessui/react";
import {
  ChevronUpDownIcon,
  ChevronRightIcon,
  FolderIcon,
  ListBulletIcon,
  MagnifyingGlassIcon,
  QueueListIcon,
  RectangleGroupIcon
} from "@heroicons/react/24/outline";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { MarkdownFileTreeNode } from "@md-editor/file-system";
import {
  AssetPreview,
  ConfirmActionDialog,
  DocumentBar,
  EditorUiProvider,
  OutlinePanel,
  useEditorUiActions,
  useEditorUiState,
  WelcomeState
} from "@md-editor/editor-ui";
import { DesktopMilkdownEditor } from "../components/DesktopMilkdownEditor";
import { DesktopSourceEditor } from "../components/DesktopSourceEditor";
import { EditorTitleBarControls } from "../components/EditorTitleBarControls";
import { FileTreePanel } from "../components/FileTreePanel";
import { SettingsPage } from "../components/SettingsDialog";
import { isSettingsWindow } from "../desktop/settings-window";
import { cx } from "../lib/cx";
import { useDesktopEditorController } from "./controller/useDesktopEditorController";
import { DesktopEditorActionsContext, useDesktopEditorActions } from "./context/DesktopEditorActionsContext";
import {
  calculateDocumentMetrics,
  getDocumentMetricLabel,
  type DocumentMetricKind
} from "./document-metrics";
import { useDocumentSnapshot } from "./document-store";
import { AppSettingsProvider, useAppSettings } from "./settings-context";
import { useToast } from "./controller/useToast";
import { getLoadingDescription, GLOBAL_LOADING_TITLE } from "./loading-state";
import { editorUpdateActionLabel } from "../components/settings/settingsUtils";
import {
  isUpdateActionBusy as isUpdateActionBusy_,
  shouldShowEditorUpdateAction,
} from "./updates/update-status";
import { useConfirmationStore } from "./stores/confirmation-store";
import { useDocumentUiStore } from "./stores/document-ui-store";
import { useFileActionStore } from "./stores/file-action-store";
import { useFileTreeStore } from "./stores/file-tree-store";
import { useSidebarStore } from "./stores/sidebar-store";

const SIDEBAR_DEFAULT_WIDTH = 272;
const SIDEBAR_MIN_WIDTH = 220;
const SIDEBAR_MAX_WIDTH = 420;

export function App() {
  if (isSettingsWindow()) {
    return <SettingsWindowApp />;
  }
  return <AppWithProviders />;
}

function AppWithProviders() {
  const { toast, showToast } = useToast();
  return (
    <AppSettingsProvider showToast={showToast} surface="main">
      {/* Keep this provider above both desktop effects and shell consumers so command dispatch, outline, and editor surfaces share one editor-ui instance. */}
      <DesktopEditorUiProvider showToast={showToast}>
        {/* DesktopEditorEffects 只跑副作用，不订阅任何 store，避免 store 写入 -> 重渲 -> 再写入的循环 */}
        <DesktopEditorEffects showToast={showToast}>
          <MainApp toast={toast} showToast={showToast} />
        </DesktopEditorEffects>
      </DesktopEditorUiProvider>
    </AppSettingsProvider>
  );
}

function DesktopEditorUiProvider({
  children,
  showToast
}: {
  readonly children: ReactNode;
  readonly showToast: (message: string | null) => void;
}) {
  const snapshot = useDocumentSnapshot();
  return (
    <EditorUiProvider
      filePath={snapshot.filePath}
      markdown={snapshot.markdown}
      showToast={showToast}
    >
      {children}
    </EditorUiProvider>
  );
}

function DesktopEditorEffects({
  children,
  showToast
}: {
  readonly children: ReactNode;
  readonly showToast: (message: string | null) => void;
}) {
  const actions = useDesktopEditorController({ showToast });
  return (
    <DesktopEditorActionsContext value={actions}>
      {children}
    </DesktopEditorActionsContext>
  );
}

function MainApp({
  toast,
  showToast,
}: {
  readonly toast: { readonly id: number; readonly message: string } | null;
  readonly showToast: (message: string | null) => void;
}) {
  const { isSettingsOpen } = useAppSettings();
  const snapshot = useDocumentSnapshot();
  const { isSidebarVisible, sidebarMode, setIsSidebarVisible, setSidebarMode } = useSidebarStore();
  const { pendingAction } = useFileActionStore();
  const { outline, activeOutlineId } = useEditorUiState();
  const { jumpToTocItem } = useEditorUiActions();
  const { hasActiveDocument, openedAsset, resolveImageSrc, closeAssetPreview, getRecentFiles } = useDocumentUiStore();
  const { dispatchCommand, openRecentFile } = useDesktopEditorActions();
  const { confirmation, resolveConfirmation } = useConfirmationStore();
  const [isFileSearchOpen, setIsFileSearchOpen] = useState(false);
  const [fileSearchQuery, setFileSearchQuery] = useState("");
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT_WIDTH);
  const [sidebarResizePreviewWidth, setSidebarResizePreviewWidth] = useState<number | null>(null);
  const shouldShowOverlayTitleBar = isMacPlatform();
  const folderTree = useFileTreeStore(s => s.folder?.tree ?? null);
  const fileSearchResultCount = useMemo(
    () => countMatchedFiles(folderTree, fileSearchQuery),
    [folderTree, fileSearchQuery]
  );
  const sidebarTitle = sidebarMode === "files" ? "文件" : "大纲";
  const showFileSearch = sidebarMode === "files" && isFileSearchOpen;
  const pendingActionDescription = getLoadingDescription(pendingAction);
  const sidebarResizePreviewOffset =
    sidebarResizePreviewWidth === null ? null : clampSidebarPreviewWidth(sidebarResizePreviewWidth) - sidebarWidth;

  // Web/Vite 预览没有原生子窗口，保留内嵌设置页只作为开发 fallback；桌面端走 Tauri 设置窗口。
  if (isSettingsOpen) {
    return (
      <main className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden bg-[var(--theme-bg)]">
        <AppTitleBar title="设置" isVisible={shouldShowOverlayTitleBar} hasWindowControlsInset />
        <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
          <SettingsPage surface="main" />
        </div>
      </main>
    );
  }

  return (
    <main className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden bg-[var(--theme-bg)]">
      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        {isSidebarVisible ? (
          <button
            type="button"
            className="fixed inset-0 z-[29] hidden border-0 bg-[rgba(20,27,35,0.12)] max-[959px]:block"
            aria-label="关闭侧栏"
            onClick={() => setIsSidebarVisible(false)}
          />
        ) : null}
        <aside
          className={cx(
            "relative flex min-h-0 w-0 min-w-0 flex-[0_0_0] select-none flex-col overflow-hidden border-r border-[var(--theme-border)] bg-[var(--theme-surface)] text-[var(--theme-control-text)] opacity-0 transition-[width,flex-basis,opacity] duration-300 ease-out max-[959px]:fixed max-[959px]:inset-y-0 max-[959px]:left-0 max-[959px]:z-30 max-[959px]:shadow-[var(--theme-shadow)] motion-reduce:transition-none",
            isSidebarVisible &&
              "w-[var(--app-sidebar-width,272px)] min-w-[220px] max-w-[420px] flex-[0_0_var(--app-sidebar-width,272px)] opacity-100 max-[959px]:w-[min(var(--app-sidebar-width,272px),calc(100vw_-_64px))] max-[959px]:min-w-[min(220px,calc(100vw_-_64px))] max-[959px]:max-w-[calc(100vw_-_64px)] max-[959px]:flex-[0_0_min(var(--app-sidebar-width,272px),calc(100vw_-_64px))]"
          )}
          style={
            {
              "--app-sidebar-width": `${sidebarWidth}px`,
              borderRightWidth: isSidebarVisible ? 1 : 0
            } as React.CSSProperties
          }
          aria-label={sidebarMode === "files" ? "文件树" : "大纲目录"}
          aria-hidden={!isSidebarVisible}
          inert={!isSidebarVisible}
        >
          <AppTitleBar
            isVisible={shouldShowOverlayTitleBar}
            hasWindowControlsInset
          />
          <div className="grid h-[42px] shrink-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 border-b border-[var(--theme-border)] bg-[var(--theme-chrome)] px-2">
            <button
              type="button"
              className={sidebarHeaderIconButtonClassName}
              aria-label={sidebarMode === "files" ? "切换到大纲" : "切换到文件"}
              title={sidebarMode === "files" ? "切换到大纲" : "切换到文件"}
              onClick={() => setSidebarMode(sidebarMode === "files" ? "outline" : "files")}
            >
              {sidebarMode === "files" ? (
                <FolderIcon aria-hidden="true" />
              ) : (
                <QueueListIcon aria-hidden="true" />
              )}
            </button>
            <strong className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-center text-[13px] font-semibold leading-none text-[var(--theme-title)]">
              {sidebarTitle}
            </strong>
            <button
              type="button"
              className={cx(
                sidebarHeaderIconButtonClassName,
                isFileSearchOpen && "bg-[var(--theme-control-active)] text-[var(--theme-title)]"
              )}
              aria-label={isFileSearchOpen ? "关闭文件搜索" : "搜索文件"}
              aria-pressed={isFileSearchOpen}
              title="搜索文件"
              onClick={() => {
                setSidebarMode("files");
                setIsFileSearchOpen((current) => !current);
              }}
            >
              <MagnifyingGlassIcon aria-hidden="true" />
            </button>
          </div>
          {showFileSearch ? (
            <div
              className="grid min-h-[38px] shrink-0 grid-cols-[16px_minmax(0,1fr)_minmax(16px,auto)] items-center gap-[7px] border-b border-[var(--theme-border)] bg-[var(--theme-chrome)] px-2.5 py-1.5 text-[var(--theme-control-subtle)] [&_svg]:size-4 [&_svg]:fill-none [&_svg]:stroke-current [&_svg]:stroke-[1.35] [&_svg]:[stroke-linecap:round] [&_svg]:[stroke-linejoin:round]"
              role="search"
            >
              <MagnifyingGlassIcon aria-hidden="true" />
              <input
                type="search"
                className="h-[26px] min-w-0 border-0 bg-transparent font-sans text-[13px] leading-none text-[var(--theme-title)] outline-none placeholder:text-[var(--theme-control-subtle)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--theme-primary)]"
                value={fileSearchQuery}
                autoFocus
                placeholder="搜索文件"
                aria-label="搜索当前打开文件夹下的文件"
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
                title="匹配数量"
              >
                {fileSearchQuery.trim() ? fileSearchResultCount : ""}
              </span>
            </div>
          ) : null}
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {sidebarMode === "files" ? (
              <FileTreePanel searchQuery={showFileSearch ? fileSearchQuery : ""} />
            ) : (
              <OutlinePanel
                outline={outline}
                activeId={activeOutlineId}
                onJump={jumpToTocItem}
              />
            )}
          </div>
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
        {isSidebarVisible ? (
          <SidebarResizeBoundary
            width={sidebarWidth}
            previewOffset={sidebarResizePreviewOffset}
            onPreview={setSidebarResizePreviewWidth}
            onCommit={(width) => {
              setSidebarResizePreviewWidth(null);
              if (width < SIDEBAR_MIN_WIDTH) {
                setIsSidebarVisible(false);
                return;
              }
              setSidebarWidth(clampSidebarWidth(width));
            }}
            onCancel={() => setSidebarResizePreviewWidth(null)}
          />
        ) : null}
        <section
          className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[var(--theme-surface)]"
          aria-label="Markdown 编辑器"
        >
          <AppTitleBar
            title={snapshot.filePath?.split(/[\\/]/u).pop() || "Markdown Editor"}
            isDirty={snapshot.isDirty}
            isVisible={shouldShowOverlayTitleBar}
            hasWindowControlsInset={!isSidebarVisible}
            titleAlign="center"
            titleIcon="markdown"
            actions={
              <EditorTitleBarControls />
            }
          />
          {!isSidebarVisible ? (
            <CollapsedSidebarReveal
              hasTitleBar={shouldShowOverlayTitleBar}
              onReveal={() => setIsSidebarVisible(true)}
            />
          ) : null}
          <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
            <EditorToast toast={toast} />
            {!hasActiveDocument && !openedAsset ? (
              <WelcomeState
                recentFiles={getRecentFiles()}
                onNewDocument={() => void dispatchCommand("file.new")}
                onOpenDocument={() => void dispatchCommand("file.open")}
                onOpenFolder={() => void dispatchCommand("file.openFolder")}
                onOpenRecent={(path) => void openRecentFile(path)}
              />
            ) : openedAsset ? (
              <AssetPreview
                asset={openedAsset}
                resolveAssetSrc={resolveImageSrc}
                onBack={closeAssetPreview}
              />
            ) : snapshot.mode === "source" ? (
              <DesktopSourceEditor />
            ) : (
              <DesktopMilkdownEditor showToast={showToast} />
            )}
            {pendingAction ? (
              <EditorLoadingState
                title={GLOBAL_LOADING_TITLE}
                description={pendingActionDescription}
                ariaLabel={pendingAction}
                isOverlay
              />
            ) : null}
          </div>
        </section>
      </div>
      <ConfirmActionDialog
        confirmation={confirmation}
        onResolve={resolveConfirmation}
      />
    </main>
  );
}

function CollapsedSidebarReveal({
  hasTitleBar,
  onReveal
}: {
  readonly hasTitleBar: boolean;
  readonly onReveal: () => void;
}) {
  const handlePointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    onReveal();
  };

  return (
    <div
      className={cx(
        "group absolute bottom-0 left-0 z-[15] w-14",
        // 只让正文左侧 56px 成为唤起热区，避免覆盖 macOS 标题栏拖拽和红黄绿按钮。
        hasTitleBar ? "top-[34px]" : "top-0"
      )}
    >
      <button
        type="button"
        className="absolute left-1 top-1/2 grid h-14 w-10 -translate-y-1/2 touch-none place-items-center border-0 bg-transparent p-0 text-[var(--theme-control-text)] opacity-0 transition-[opacity,transform,color] duration-150 ease-out hover:text-[var(--theme-title)] hover:opacity-90 active:scale-95 group-hover:opacity-60 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--theme-primary)] motion-reduce:transition-none [&_svg]:size-7 [&_svg]:fill-none [&_svg]:stroke-current [&_svg]:stroke-[1.25]"
        aria-label="显示侧栏"
        title="显示侧栏"
        onPointerDown={handlePointerDown}
        onClick={onReveal}
      >
        <ChevronRightIcon aria-hidden="true" />
      </button>
    </div>
  );
}

function SettingsWindowApp() {
  const { toast, showToast } = useToast();
  return (
    <AppSettingsProvider showToast={showToast} surface="settings-window">
      <SettingsWindowContent toast={toast} />
    </AppSettingsProvider>
  );
}

function SettingsWindowContent({
  toast
}: {
  readonly toast: { readonly id: number; readonly message: string } | null;
}) {
  const shouldShowOverlayTitleBar = isMacPlatform();
  useEffect(() => { document.title = "设置"; }, []);
  return (
    <main className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden bg-[var(--theme-bg)]">
      <AppTitleBar
        title="设置"
        isVisible={shouldShowOverlayTitleBar}
        hasWindowControlsInset
        titleAlign="center"
      />
      <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
        <EditorToast toast={toast} />
        <SettingsPage surface="settings-window" onStartWindowDrag={startTitleBarDrag} />
      </div>
    </main>
  );
}

function AppTitleBar({
  actions,
  title,
  hasWindowControlsInset = false,
  isDirty = false,
  isVisible,
  titleAlign = "start",
  titleIcon
}: {
  readonly actions?: ReactNode;
  readonly title?: string;
  readonly hasWindowControlsInset?: boolean;
  readonly isDirty?: boolean;
  readonly isVisible: boolean;
  readonly titleAlign?: "start" | "center";
  readonly titleIcon?: "markdown";
}) {
  if (!isVisible) {
    return null;
  }

  return (
    <div
      data-tauri-drag-region
      className={cx(
        "relative h-[34px] shrink-0 select-none bg-[var(--theme-chrome)] text-[13px] text-[var(--theme-muted)]",
        titleAlign === "center"
          ? "grid items-center"
          : "flex items-center pr-4",
        titleAlign === "center"
          ? hasWindowControlsInset
            ? "grid-cols-[76px_minmax(0,1fr)_76px]"
            : "grid-cols-[12px_minmax(0,1fr)_12px]"
          : hasWindowControlsInset
            ? "pl-[76px]"
            : "pl-3"
      )}
      onMouseDown={startTitleBarDrag}
    >
      {title ? (
        <span
          data-tauri-drag-region
          className={cx(
            "flex min-w-0 max-w-full items-center gap-1.5 overflow-hidden font-medium leading-none",
            titleAlign === "center" && "col-start-2 justify-self-center"
          )}
        >
          {titleIcon === "markdown" ? <MarkdownTitleIcon /> : null}
          <span
            data-tauri-drag-region
            className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap"
          >
            {title}
            {isDirty ? "*" : ""}
          </span>
        </span>
      ) : null}
      {actions ? (
        <div
          className="absolute right-2 top-1/2 z-10 -translate-y-1/2"
          onMouseDown={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
        >
          {actions}
        </div>
      ) : null}
    </div>
  );
}


function MarkdownTitleIcon() {
  return (
    <svg
      className="size-[17px] shrink-0 text-[var(--theme-control-subtle)]"
      viewBox="0 0 24 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="1.75" y="1.75" width="20.5" height="12.5" rx="2" />
      <path d="M5 11V5l2.5 3L10 5v6" />
      <path d="M16 5v5.5" />
      <path d="m13.75 8.5 2.25 2.25 2.25-2.25" />
    </svg>
  );
}

function startTitleBarDrag(event: React.MouseEvent<HTMLElement>): void {
  if (event.button !== 0 || event.detail > 1 || !isTauri()) {
    return;
  }

  // Tauri 要求拖拽必须从一次真实的按下事件里启动；WebKit 子窗口有时会把
  // 首次 mousedown 的 detail 记为 0，所以这里只拦截双击/多击，不强依赖 detail === 1。
  event.preventDefault();
  event.stopPropagation();
  void getCurrentWindow().startDragging().catch((error: unknown) => {
    console.warn("窗口拖拽启动失败", error);
  });
}

export function EditorToast({
  toast
}: {
  readonly toast: { readonly id: number; readonly message: string } | null;
}) {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (!toast) {
      setIsVisible(false);
      return;
    }

    setIsVisible(true);
    const timer = window.setTimeout(() => setIsVisible(false), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  if (!toast || !isVisible) {
    return null;
  }

  return (
    <div
      key={toast.id}
      className="pointer-events-none absolute left-1/2 top-4 z-20 max-w-[min(520px,calc(100%_-_32px))] -translate-x-1/2 rounded-[10px] border border-white/10 bg-[rgba(38,38,40,0.86)] px-3.5 py-2 text-center text-[13px] font-medium leading-[1.35] text-white shadow-[0_10px_30px_rgba(0,0,0,0.16)] backdrop-blur-xl motion-safe:animate-[toast-in_160ms_ease-out] motion-reduce:animate-none"
      role="alert"
    >
      {toast.message}
    </div>
  );
}

function SidebarResizeBoundary({
  onCancel,
  onCommit,
  onPreview,
  previewOffset,
  width
}: {
  readonly onCancel: () => void;
  readonly onCommit: (width: number) => void;
  readonly onPreview: (width: number) => void;
  readonly previewOffset: number | null;
  readonly width: number;
}) {
  return (
    <div className="z-20 hidden h-full w-0 shrink-0 min-[960px]:grid">
      {previewOffset !== null ? (
        <div
          className="pointer-events-none col-start-1 row-start-1 h-full w-0 border-l border-dashed border-[var(--theme-primary)]"
          style={{ transform: `translateX(${previewOffset}px)` }}
          aria-hidden="true"
        />
      ) : null}
      <SidebarResizeHandle
        width={width}
        onPreview={onPreview}
        onCommit={onCommit}
        onCancel={onCancel}
      />
    </div>
  );
}

function SidebarResizeHandle({
  onCancel,
  onCommit,
  onPreview,
  width
}: {
  readonly onCancel: () => void;
  readonly onCommit: (width: number) => void;
  readonly onPreview: (width: number) => void;
  readonly width: number;
}) {
  return (
    <div
      className="group col-start-1 row-start-1 grid h-full w-1.5 -translate-x-1/2 cursor-col-resize touch-none place-items-center"
      role="separator"
      aria-label="调整侧栏宽度"
      aria-orientation="vertical"
      aria-valuemin={SIDEBAR_MIN_WIDTH}
      aria-valuemax={SIDEBAR_MAX_WIDTH}
      aria-valuenow={width}
      onPointerDown={(event) => {
        event.preventDefault();
        const pointerId = event.pointerId;
        const target = event.currentTarget;
        event.currentTarget.setPointerCapture(pointerId);
        onPreview(event.clientX);

        const handlePointerMove = (moveEvent: PointerEvent) => {
          onPreview(moveEvent.clientX);
        };

        const stopTracking = () => {
          if (target.hasPointerCapture(pointerId)) {
            target.releasePointerCapture(pointerId);
          }
          window.removeEventListener("pointermove", handlePointerMove);
          window.removeEventListener("pointerup", handlePointerUp);
          window.removeEventListener("pointercancel", handlePointerCancel);
        };

        const handlePointerUp = (upEvent: PointerEvent) => {
          stopTracking();
          onCommit(upEvent.clientX);
        };

        const handlePointerCancel = () => {
          stopTracking();
          onCancel();
        };

        window.addEventListener("pointermove", handlePointerMove);
        window.addEventListener("pointerup", handlePointerUp);
        window.addEventListener("pointercancel", handlePointerCancel);
      }}
    >
      <span
        className="pointer-events-none h-full w-px bg-transparent group-hover:bg-[var(--theme-primary)]"
        aria-hidden="true"
      />
    </div>
  );
}

const sidebarHeaderIconButtonClassName =
  "grid size-[30px] place-items-center rounded-[5px] border-0 bg-transparent text-[var(--theme-control-text)] hover:bg-[var(--theme-control-hover)] hover:text-[var(--theme-title)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--theme-primary)] [&_svg]:size-4 [&_svg]:fill-none [&_svg]:stroke-current [&_svg]:stroke-[1.35] [&_svg]:[stroke-linecap:round] [&_svg]:[stroke-linejoin:round]";

const titleBarSecondaryButtonClassName =
  "invisible grid size-[28px] shrink-0 place-items-center rounded-[5px] border-0 bg-transparent text-[var(--theme-control-text)] opacity-0 transition-[visibility,opacity,background-color,color] duration-150 ease-out hover:bg-[var(--theme-control-hover)] hover:text-[var(--theme-title)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--theme-primary)] group-hover/titlebar-controls:visible group-hover/titlebar-controls:opacity-100 group-focus-within/titlebar-controls:visible group-focus-within/titlebar-controls:opacity-100 motion-reduce:transition-none [&_svg]:size-4 [&_svg]:fill-none [&_svg]:stroke-current [&_svg]:stroke-[1.35] [&_svg]:[stroke-linecap:round] [&_svg]:[stroke-linejoin:round]";

const documentMetricOptions: readonly {
  readonly kind: DocumentMetricKind;
  readonly label: string;
}[] = [
  { kind: "words", label: "词数" },
  { kind: "lines", label: "行数" },
  { kind: "characters", label: "字符数" }
];

function clampSidebarWidth(width: number): number {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width));
}

function clampSidebarPreviewWidth(width: number): number {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(0, width));
}

function EditorLoadingState({
  title,
  description,
  ariaLabel,
  isOverlay = false
}: {
  readonly title: string;
  readonly description?: string;
  readonly ariaLabel?: string;
  readonly isOverlay?: boolean;
}) {
  return (
    <div
      className={cx(
        "pointer-events-none flex items-center justify-center bg-[color-mix(in_oklab,var(--theme-surface)_72%,transparent)] backdrop-blur-[2px]",
        isOverlay ? "absolute inset-0 z-10" : "min-h-0 flex-1"
      )}
      role="status"
      aria-live="polite"
      aria-label={ariaLabel ?? title}
    >
      <div className="flex min-w-[180px] max-w-[240px] flex-col items-center gap-3 rounded-[8px] border border-[var(--theme-border)] bg-[color-mix(in_oklab,var(--theme-surface)_94%,white)] px-5 py-4 text-center shadow-[var(--theme-shadow)]">
        <span
          className="block size-5 animate-spin rounded-full border-2 border-[var(--theme-border-strong)] border-t-[var(--theme-primary)]"
          aria-hidden="true"
        />
        <div className="space-y-1">
          <p className="m-0 text-[13px] font-medium leading-5 text-[var(--theme-title)]">{title}</p>
          {description ? (
            <p className="m-0 text-[12px] leading-5 text-[var(--theme-muted)]">{description}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function countMatchedFiles(root: MarkdownFileTreeNode | null, query: string): number {
  const normalizedQuery = normalizeSearchQuery(query);
  if (!root || !normalizedQuery) {
    return 0;
  }

  let count = 0;
  const visit = (node: MarkdownFileTreeNode) => {
    if (node.kind !== "directory") {
      const haystack = `${node.name}\n${node.path}`.toLowerCase();
      if (haystack.includes(normalizedQuery)) {
        count += 1;
      }
      return;
    }
    node.children?.forEach(visit);
  };

  visit(root);
  return count;
}

function normalizeSearchQuery(query: string): string {
  return query.trim().toLowerCase();
}

function isMacPlatform(): boolean {
  return navigator.platform.toLowerCase().includes("mac");
}
