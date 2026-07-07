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
  OutlinePanel,
  WelcomeState
} from "@md-editor/editor-ui";
import { FileTreePanel } from "../components/FileTreePanel";
import { MdxComponentMenu } from "../components/MdxComponentMenu";
import { SettingsPage } from "../components/SettingsDialog";
import { isSettingsWindow } from "../desktop/settings-window";
import { cx } from "../lib/cx";
import { useDesktopEditorController } from "./controller/useDesktopEditorController";
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

const SourceEditor = lazy(() =>
  import("@md-editor/editor-ui/source-editor").then((module) => ({ default: module.SourceEditor }))
);
const MilkdownEditor = lazy(() =>
  import("@md-editor/editor-ui/milkdown-editor").then((module) => ({ default: module.MilkdownEditor }))
);

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
      <MainApp toast={toast} showToast={showToast} />
    </AppSettingsProvider>
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
  const editor = useDesktopEditorController({ showToast });
  const [isFileSearchOpen, setIsFileSearchOpen] = useState(false);
  const [fileSearchQuery, setFileSearchQuery] = useState("");
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT_WIDTH);
  const [sidebarResizePreviewWidth, setSidebarResizePreviewWidth] = useState<number | null>(null);
  const shouldShowOverlayTitleBar = isMacPlatform();
  const fileSearchResultCount = useMemo(
    () => countMatchedFiles(editor.folder?.tree ?? null, fileSearchQuery),
    [editor.folder?.tree, fileSearchQuery]
  );
  const sidebarTitle = editor.sidebarMode === "files" ? "文件" : "大纲";
  const showFileSearch = editor.sidebarMode === "files" && isFileSearchOpen;
  const pendingActionDescription = getLoadingDescription(editor.pendingAction);
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
        {editor.isSidebarVisible ? (
          <button
            type="button"
            className="fixed inset-0 z-[29] hidden border-0 bg-[rgba(20,27,35,0.12)] max-[959px]:block"
            aria-label="关闭侧栏"
            onClick={() => editor.setIsSidebarVisible(false)}
          />
        ) : null}
        <aside
          className={cx(
            "relative flex min-h-0 w-0 min-w-0 flex-[0_0_0] select-none flex-col overflow-hidden border-r border-[var(--theme-border)] bg-[var(--theme-surface)] text-[var(--theme-control-text)] opacity-0 transition-[width,flex-basis,opacity] duration-300 ease-out max-[959px]:fixed max-[959px]:inset-y-0 max-[959px]:left-0 max-[959px]:z-30 max-[959px]:shadow-[var(--theme-shadow)] motion-reduce:transition-none",
            editor.isSidebarVisible &&
              "w-[var(--app-sidebar-width,272px)] min-w-[220px] max-w-[420px] flex-[0_0_var(--app-sidebar-width,272px)] opacity-100 max-[959px]:w-[min(var(--app-sidebar-width,272px),calc(100vw_-_64px))] max-[959px]:min-w-[min(220px,calc(100vw_-_64px))] max-[959px]:max-w-[calc(100vw_-_64px)] max-[959px]:flex-[0_0_min(var(--app-sidebar-width,272px),calc(100vw_-_64px))]"
          )}
          style={
            {
              "--app-sidebar-width": `${sidebarWidth}px`,
              borderRightWidth: editor.isSidebarVisible ? 1 : 0
            } as React.CSSProperties
          }
          aria-label={editor.sidebarMode === "files" ? "文件树" : "大纲目录"}
          aria-hidden={!editor.isSidebarVisible}
          inert={!editor.isSidebarVisible}
        >
          <AppTitleBar
            isVisible={shouldShowOverlayTitleBar}
            hasWindowControlsInset
          />
          <div className="grid h-[42px] shrink-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 border-b border-[var(--theme-border)] bg-[var(--theme-chrome)] px-2">
            <button
              type="button"
              className={sidebarHeaderIconButtonClassName}
              aria-label={editor.sidebarMode === "files" ? "切换到大纲" : "切换到文件"}
              title={editor.sidebarMode === "files" ? "切换到大纲" : "切换到文件"}
              onClick={() => editor.setSidebarMode(editor.sidebarMode === "files" ? "outline" : "files")}
            >
              {editor.sidebarMode === "files" ? (
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
                editor.setSidebarMode("files");
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
            {editor.sidebarMode === "files" ? (
              <FileTreePanel
                folder={editor.folder}
                searchQuery={showFileSearch ? fileSearchQuery : ""}
                activeFilePath={snapshot.filePath}
                onOpenFolder={() => void editor.dispatchCommand("file.openFolder")}
                onOpenFile={(filePath) => void editor.openDocumentFromTree(filePath)}
                onOpenAsset={(node) => editor.openAssetFromTree(node)}
                onCreateTreeItem={(parentPath, kind, name) => void editor.createTreeItem(parentPath, kind, name)}
                onRenameTreeItem={(node, name) => void editor.renameTreeItem(node, name)}
                onDeleteTreeItem={(node) => void editor.deleteTreeItem(node)}
                onContextMenuError={editor.showFileActionError}
              />
            ) : (
              <OutlinePanel
                outline={editor.outline}
                activeId={editor.activeOutlineId}
                onJump={editor.jumpToTocItem}
              />
            )}
          </div>
          <DocumentBar
            hasActiveDocument={editor.hasActiveDocument}
            mode={snapshot.mode}
            onChangeMode={(mode) => {
              if (mode !== snapshot.mode) {
                void editor.dispatchCommand(mode === "source" ? "view.toggleSource" : "view.showWysiwyg");
              }
            }}
            onOpenSettings={() => void editor.dispatchCommand("settings.open")}
          />
        </aside>
        {editor.isSidebarVisible ? (
          <SidebarResizeBoundary
            width={sidebarWidth}
            previewOffset={sidebarResizePreviewOffset}
            onPreview={setSidebarResizePreviewWidth}
            onCommit={(width) => {
              setSidebarResizePreviewWidth(null);
              if (width < SIDEBAR_MIN_WIDTH) {
                editor.setIsSidebarVisible(false);
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
            hasWindowControlsInset={!editor.isSidebarVisible}
            titleAlign="center"
            titleIcon="markdown"
            actions={
              <EditorTitleBarControls
                outline={editor.outline}
                activeOutlineId={editor.activeOutlineId}
                hasActiveDocument={editor.hasActiveDocument}
                isSidebarVisible={editor.isSidebarVisible}
                onJumpToOutlineItem={editor.jumpToTocItem}
                onToggleSidebar={() => editor.setIsSidebarVisible(!editor.isSidebarVisible)}
                onRunUpdateAction={() => void editor.runEditorUpdateAction()}
              />
            }
          />
          {!editor.isSidebarVisible ? (
            <CollapsedSidebarReveal
              hasTitleBar={shouldShowOverlayTitleBar}
              onReveal={() => editor.setIsSidebarVisible(true)}
            />
          ) : null}
          <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
            <EditorToast toast={toast} />
            {!editor.hasActiveDocument && !editor.openedAsset ? (
              <WelcomeState
                recentFiles={editor.getRecentFiles()}
                onNewDocument={() => void editor.dispatchCommand("file.new")}
                onOpenDocument={() => void editor.dispatchCommand("file.open")}
                onOpenFolder={() => void editor.dispatchCommand("file.openFolder")}
                onOpenRecent={(path) => void editor.openRecentFile(path)}
              />
            ) : editor.openedAsset ? (
              <AssetPreview
                asset={editor.openedAsset}
                resolveAssetSrc={editor.resolveImageSrc}
                onBack={editor.closeAssetPreview}
              />
            ) : snapshot.mode === "source" ? (
              <Suspense fallback={<EditorLoadingState title={GLOBAL_LOADING_TITLE} />}>
                <SourceEditor
                  snapshot={snapshot}
                  target={editor.tocTarget}
                  scrollTarget={
                    editor.modeScrollTarget?.mode === "source"
                      ? editor.modeScrollTarget.target
                      : null
                  }
                  onChange={editor.commitMarkdown}
                  onScrollRatioChange={editor.updateModeScrollRatio}
                  onScrollTargetApplied={editor.completeModeScrollTarget}
                  onVisibleLineChange={editor.updateActiveOutlineForLine}
                />
              </Suspense>
            ) : (
              <Suspense fallback={<EditorLoadingState title={GLOBAL_LOADING_TITLE} />}>
                <DesktopMilkdownEditor
                  key={editor.documentKey}
                  snapshot={snapshot}
                  outline={editor.outline}
                  target={editor.tocTarget}
                  insertRequest={editor.mdxInsertRequest}
                  aiSuggestionRequest={editor.aiSuggestionRequest}
                  isAiSuggestionPending={editor.isAiSuggestionPending}
                  aiAutoSuggestionsEnabled={editor.isAiCompletionReady}
                  onInsertRequestHandled={editor.clearMdxInsertRequest}
                  onAiSuggestionRequest={editor.requestAiSuggestion}
                  onAiSuggestionRequestHandled={editor.clearAiSuggestionRequest}
                  onAiSuggestionError={editor.handleAiSuggestionError}
                  onChange={editor.commitMarkdown}
                  onOpenLink={editor.openWysiwygLink}
                  scrollTarget={
                    editor.modeScrollTarget?.mode === "wysiwyg"
                      ? editor.modeScrollTarget.target
                      : null
                  }
                  onScrollRatioChange={editor.updateModeScrollRatio}
                  onScrollTargetApplied={editor.completeModeScrollTarget}
                  onActiveOutlineChange={editor.setActiveOutlineId}
                  resolveImageSrc={editor.resolveImageSrc}
                />
              </Suspense>
            )}
            {editor.pendingAction ? (
              <EditorLoadingState
                title={GLOBAL_LOADING_TITLE}
                description={pendingActionDescription}
                ariaLabel={editor.pendingAction}
                isOverlay
              />
            ) : null}
          </div>
        </section>
      </div>
      <ConfirmActionDialog
        confirmation={editor.confirmation}
        onResolve={editor.resolveConfirmation}
      />
      {editor.isMdxComponentMenuOpen ? (
        <MdxComponentMenu
          plugins={editor.mdxComponentPlugins}
          onInsert={editor.insertMdxComponent}
          onClose={editor.closeMdxComponentMenu}
        />
      ) : null}
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

function DesktopMilkdownEditor(props: Omit<React.ComponentProps<typeof MilkdownEditor>, "showCodeBlockLineNumbers" | "wysiwygFontSize">) {
  const { settings } = useAppSettings();
  return (
    <MilkdownEditor
      {...props}
      showCodeBlockLineNumbers={settings.editor.showCodeBlockLineNumbers}
      wysiwygFontSize={settings.editor.wysiwygFontSize}
    />
  );
}

function EditorTitleBarControls({
  activeOutlineId,
  hasActiveDocument,
  isSidebarVisible,
  onJumpToOutlineItem,
  onRunUpdateAction,
  onToggleSidebar,
  outline,
}: {
  readonly activeOutlineId: string | null;
  readonly hasActiveDocument: boolean;
  readonly isSidebarVisible: boolean;
  readonly onJumpToOutlineItem: (target: { readonly line: number; readonly level: number; readonly text: string }) => void;
  readonly onRunUpdateAction: () => void;
  readonly onToggleSidebar: () => void;
  readonly outline: readonly {
    readonly id: string;
    readonly level: number;
    readonly text: string;
    readonly line: number;
  }[];
}) {
  const { updateStatus } = useAppSettings();
  const showUpdateAction = shouldShowEditorUpdateAction(updateStatus);
  const isUpdateActionBusy = isUpdateActionBusy_(updateStatus);
  const updateActionLabel = editorUpdateActionLabel(updateStatus);
  const [metricKind, setMetricKind] = useState<DocumentMetricKind>("words");
  const { markdown } = useDocumentSnapshot();
  const metrics = useMemo(() => calculateDocumentMetrics(markdown), [markdown]);
  return (
    <div className="group/titlebar-controls flex h-[30px] items-center gap-1 text-[var(--theme-control-text)] focus-within:[--titlebar-secondary-opacity:1] hover:[--titlebar-secondary-opacity:1]">
      {showUpdateAction ? (
        <button
          type="button"
          className="h-[22px] cursor-pointer rounded-[5px] border border-[var(--theme-primary)] bg-[var(--theme-primary)] px-2 text-[12px] font-medium leading-none text-white shadow-[0_1px_0_rgba(0,0,0,0.12)] hover:bg-[color-mix(in_srgb,var(--theme-primary)_88%,black)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--theme-primary)] disabled:cursor-default disabled:opacity-70"
          onClick={onRunUpdateAction}
          disabled={isUpdateActionBusy}
        >
          {updateActionLabel}
        </button>
      ) : null}
      {hasActiveDocument ? (
        <>
          <DocumentMetricMenu
            metricKind={metricKind}
            metrics={metrics}
            onMetricKindChange={setMetricKind}
          />
          <OutlinePopover
            outline={outline}
            activeOutlineId={activeOutlineId}
            onJumpToOutlineItem={onJumpToOutlineItem}
          />
        </>
      ) : null}
      <button
        type="button"
        className={titleBarSecondaryButtonClassName}
        aria-label={isSidebarVisible ? "隐藏侧栏" : "显示侧栏"}
        title={isSidebarVisible ? "隐藏侧栏" : "显示侧栏"}
        onClick={onToggleSidebar}
      >
        <RectangleGroupIcon aria-hidden="true" />
      </button>
    </div>
  );
}

function DocumentMetricMenu({
  metricKind,
  metrics,
  onMetricKindChange
}: {
  readonly metricKind: DocumentMetricKind;
  readonly metrics: ReturnType<typeof calculateDocumentMetrics>;
  readonly onMetricKindChange: (kind: DocumentMetricKind) => void;
}) {
  return (
    <Menu as="div" className="relative">
      <MenuButton className="flex h-[28px] min-w-[76px] items-center justify-center gap-1 rounded-[5px] border-0 bg-transparent px-2 text-[13px] font-medium leading-none text-[var(--theme-control-text)] hover:bg-[var(--theme-control-hover)] hover:text-[var(--theme-title)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--theme-primary)]">
        <span>{getDocumentMetricLabel(metricKind, metrics)}</span>
        <ChevronUpDownIcon className="size-3.5 shrink-0 stroke-[1.5]" aria-hidden="true" />
      </MenuButton>
      <MenuItems
        anchor={{ to: "bottom end", gap: 6, padding: 8 }}
        className="z-[70] min-w-[132px] rounded-[8px] border border-[var(--theme-border)] bg-[color-mix(in_oklab,var(--theme-surface)_96%,white)] p-1 text-[13px] text-[var(--theme-control-text)] shadow-[0_14px_44px_rgba(0,0,0,0.16)] outline-none backdrop-blur-xl"
      >
        {documentMetricOptions.map((option) => (
          <MenuItem key={option.kind}>
            {({ focus }) => (
              <button
                type="button"
                className={cx(
                  "flex h-8 w-full items-center justify-between gap-3 rounded-[5px] border-0 bg-transparent px-2 text-left text-[13px] text-[var(--theme-control-text)]",
                  focus && "bg-[var(--theme-control-hover)] text-[var(--theme-title)]",
                  metricKind === option.kind && "font-[560] text-[var(--theme-title)]"
                )}
                onClick={() => onMetricKindChange(option.kind)}
              >
                <span>{option.label}</span>
                <span className="text-[12px] text-[var(--theme-muted)]">
                  {getDocumentMetricLabel(option.kind, metrics)}
                </span>
              </button>
            )}
          </MenuItem>
        ))}
      </MenuItems>
    </Menu>
  );
}

function OutlinePopover({
  activeOutlineId,
  onJumpToOutlineItem,
  outline
}: {
  readonly activeOutlineId: string | null;
  readonly onJumpToOutlineItem: (target: { readonly line: number; readonly level: number; readonly text: string }) => void;
  readonly outline: readonly {
    readonly id: string;
    readonly level: number;
    readonly text: string;
    readonly line: number;
  }[];
}) {
  return (
    <Popover className="relative">
      {({ close }) => (
        <>
          <PopoverButton
            className={titleBarSecondaryButtonClassName}
            aria-label="打开大纲浮层"
            title="大纲"
          >
            <ListBulletIcon aria-hidden="true" />
          </PopoverButton>
          <PopoverPanel
            anchor={{ to: "bottom end", gap: 12, padding: 12 }}
            className="z-[70] w-[min(360px,calc(100vw_-_32px))] rounded-[12px] border border-[var(--theme-border-strong)] bg-[color-mix(in_oklab,var(--theme-surface)_96%,white)] text-[var(--theme-text)] shadow-[0_18px_56px_rgba(0,0,0,0.18)] outline-none backdrop-blur-xl"
          >
            <span
              className="absolute right-[16px] top-[-6px] size-3 rotate-45 border-l border-t border-[var(--theme-border-strong)] bg-[color-mix(in_oklab,var(--theme-surface)_96%,white)]"
              aria-hidden="true"
            />
            <div className="relative z-10 flex h-[48px] items-center border-b border-[var(--theme-border)] px-4">
              <h2 className="m-0 text-[17px] font-semibold leading-none text-[var(--theme-title)]">大纲</h2>
            </div>
            {outline.length === 0 ? (
              <p className="m-0 px-4 py-5 text-[13px] leading-5 text-[var(--theme-control-subtle)]">
                当前文档没有标题。
              </p>
            ) : (
              <nav className="max-h-[min(420px,calc(100vh_-_120px))] overflow-auto p-2" aria-label="文章大纲">
                {outline.map((item) => {
                  const active = item.id === activeOutlineId;

                  return (
                    <button
                      type="button"
                      key={`${item.id}-${item.line}`}
                      className={cx(
                        "flex min-h-8 w-full items-center rounded-[6px] border-0 bg-transparent py-1 pr-2 text-left text-[13px] leading-[1.35] text-[var(--theme-control-text)] hover:bg-[var(--theme-control-hover)] hover:text-[var(--theme-title)] focus-visible:bg-[var(--theme-control-hover)] focus-visible:text-[var(--theme-title)] focus-visible:outline-none",
                        active && "bg-[var(--theme-control-active)] font-[560] text-[var(--theme-title)]"
                      )}
                      style={{ paddingLeft: 10 + (item.level - 1) * 14 }}
                      title={item.text}
                      aria-current={active ? "location" : undefined}
                      onClick={() => {
                        onJumpToOutlineItem({ line: item.line, level: item.level, text: item.text });
                        close();
                      }}
                    >
                      <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
                        {item.text}
                      </span>
                    </button>
                  );
                })}
              </nav>
            )}
          </PopoverPanel>
        </>
      )}
    </Popover>
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
