import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import {
  Bars3BottomLeftIcon,
  FolderIcon,
  MagnifyingGlassIcon,
  QueueListIcon
} from "@heroicons/react/24/outline";
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
import { SettingsDialog } from "../components/SettingsDialog";
import { cx } from "../lib/cx";
import { useDesktopEditorController } from "./controller/useDesktopEditorController";
import { getLoadingDescription, GLOBAL_LOADING_TITLE } from "./loading-state";

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
  const editor = useDesktopEditorController();
  const [isFileSearchOpen, setIsFileSearchOpen] = useState(false);
  const [fileSearchQuery, setFileSearchQuery] = useState("");
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT_WIDTH);
  const fileSearchResultCount = useMemo(
    () => countMatchedFiles(editor.folder?.tree ?? null, fileSearchQuery),
    [editor.folder?.tree, fileSearchQuery]
  );
  const sidebarTitle = editor.sidebarMode === "files" ? "文件" : "大纲";
  const showFileSearch = editor.sidebarMode === "files" && isFileSearchOpen;
  const pendingActionDescription = getLoadingDescription(editor.pendingAction);

  return (
    <main className="flex h-full min-h-0 w-full min-w-0 overflow-hidden bg-[var(--theme-bg)]">
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
          "relative flex min-h-0 w-0 min-w-0 flex-[0_0_0] select-none flex-col overflow-hidden border-r-0 border-[var(--theme-border)] bg-[var(--theme-chrome-soft)] text-[var(--theme-control-text)] opacity-0 transition-[width,flex-basis,opacity] duration-150 ease-out max-[959px]:fixed max-[959px]:inset-y-0 max-[959px]:left-0 max-[959px]:z-30 max-[959px]:shadow-[var(--theme-shadow)] motion-reduce:transition-none",
          editor.isSidebarVisible &&
            "w-[var(--app-sidebar-width,272px)] min-w-[220px] max-w-[420px] flex-[0_0_var(--app-sidebar-width,272px)] border-r opacity-100 max-[959px]:w-[min(var(--app-sidebar-width,272px),calc(100vw_-_64px))] max-[959px]:min-w-[min(220px,calc(100vw_-_64px))] max-[959px]:max-w-[calc(100vw_-_64px)] max-[959px]:flex-[0_0_min(var(--app-sidebar-width,272px),calc(100vw_-_64px))]"
        )}
        style={{ "--app-sidebar-width": `${sidebarWidth}px` } as React.CSSProperties}
        aria-label={editor.sidebarMode === "files" ? "文件树" : "大纲目录"}
        aria-hidden={!editor.isSidebarVisible}
        inert={!editor.isSidebarVisible}
      >
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
            className="grid min-h-[38px] shrink-0 grid-cols-[16px_minmax(0,1fr)_minmax(16px,auto)] items-center gap-[7px] border-b border-[var(--theme-border)] bg-[var(--theme-chrome-soft)] px-2.5 py-1.5 text-[var(--theme-control-subtle)] [&_svg]:size-4 [&_svg]:fill-none [&_svg]:stroke-current [&_svg]:stroke-[1.35] [&_svg]:[stroke-linecap:round] [&_svg]:[stroke-linejoin:round]"
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
              activeFilePath={editor.snapshot.filePath}
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
          mode={editor.snapshot.mode}
          onChangeMode={(mode) => {
            if (mode !== editor.snapshot.mode) {
              void editor.dispatchCommand(mode === "source" ? "view.toggleSource" : "view.showWysiwyg");
            }
          }}
          onOpenSettings={() => void editor.dispatchCommand("settings.open")}
        />
        <SidebarResizeHandle
          onResize={(width) => setSidebarWidth(clampSidebarWidth(width))}
          onCollapse={() => editor.setIsSidebarVisible(false)}
        />
      </aside>
      <section
        className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[var(--theme-surface)]"
        aria-label="Markdown 编辑器"
      >
        {!editor.isSidebarVisible ? (
          <button
            type="button"
            className="fixed left-2 top-2 z-[15] grid size-[30px] place-items-center rounded-[5px] border-0 bg-[var(--theme-chrome)] text-[var(--theme-control-text)] shadow-[0_1px_6px_rgba(0,0,0,0.08)] hover:bg-[var(--theme-control-hover)] hover:text-[var(--theme-title)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--theme-primary)] [&_svg]:size-4 [&_svg]:fill-none [&_svg]:stroke-current [&_svg]:stroke-[1.25]"
            aria-label="显示侧栏"
            title="显示侧栏"
            onClick={() => editor.setIsSidebarVisible(true)}
          >
            <Bars3BottomLeftIcon aria-hidden="true" />
          </button>
        ) : null}
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
          <EditorToast toast={editor.toast} />
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
          ) : editor.snapshot.mode === "source" ? (
            <Suspense fallback={<EditorLoadingState title={GLOBAL_LOADING_TITLE} />}>
              <SourceEditor
                snapshot={editor.snapshot}
                target={editor.tocTarget}
                onChange={editor.commitMarkdown}
                onVisibleLineChange={editor.updateActiveOutlineForLine}
              />
            </Suspense>
          ) : (
            <Suspense fallback={<EditorLoadingState title={GLOBAL_LOADING_TITLE} />}>
              <MilkdownEditor
                key={editor.documentKey}
                snapshot={editor.snapshot}
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
      {editor.isSettingsOpen ? (
        <SettingsDialog
          settings={editor.settings}
          updateStatus={editor.updateStatus}
          shortcutDrafts={editor.shortcutDrafts}
          assetsDirectoryDraft={editor.assetsDirectoryDraft}
          aiSettingsDraft={editor.aiSettingsDraft}
          isLocalModelActionPending={editor.isLocalModelActionPending}
          errorMessage={editor.settingsErrorMessage}
          isSaving={editor.isSavingSettings}
          isCheckingForUpdates={editor.updateStatus.state === "checking"}
          onCaptureShortcut={editor.captureShortcutDraft}
          onResetShortcut={editor.resetShortcutDraft}
          onChangeAssetsDirectory={editor.setAssetsDirectoryDraft}
          onChangeAiSettings={editor.setAiSettingsDraft}
          onDownloadLocalModel={editor.downloadLocalModel}
          onDeleteLocalModel={editor.deleteLocalModel}
          onSave={() => void editor.saveSettings()}
          onClose={editor.closeSettings}
          onCheckForUpdates={() => void editor.runUpdateCheck()}
        />
      ) : null}
    </main>
  );
}

function EditorToast({
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

function SidebarResizeHandle({
  onCollapse,
  onResize
}: {
  readonly onCollapse: () => void;
  readonly onResize: (width: number) => void;
}) {
  return (
    <div
      className="absolute bottom-0 right-[-3px] top-0 z-[2] w-1.5 cursor-col-resize touch-none after:absolute after:bottom-0 after:right-0.5 after:top-0 after:w-px after:bg-transparent after:content-[''] hover:after:bg-[var(--theme-primary)]"
      role="separator"
      aria-label="调整侧栏宽度"
      aria-orientation="vertical"
      onPointerDown={(event) => {
        event.preventDefault();
        const pointerId = event.pointerId;
        event.currentTarget.setPointerCapture(pointerId);

        const handlePointerMove = (moveEvent: PointerEvent) => {
          if (moveEvent.clientX < SIDEBAR_MIN_WIDTH) {
            onCollapse();
            return;
          }
          onResize(moveEvent.clientX);
        };

        const handlePointerUp = () => {
          window.removeEventListener("pointermove", handlePointerMove);
          window.removeEventListener("pointerup", handlePointerUp);
          window.removeEventListener("pointercancel", handlePointerUp);
        };

        window.addEventListener("pointermove", handlePointerMove);
        window.addEventListener("pointerup", handlePointerUp);
        window.addEventListener("pointercancel", handlePointerUp);
      }}
    />
  );
}

const sidebarHeaderIconButtonClassName =
  "grid size-[30px] place-items-center rounded-[5px] border-0 bg-transparent text-[var(--theme-control-text)] hover:bg-[var(--theme-control-hover)] hover:text-[var(--theme-title)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--theme-primary)] [&_svg]:size-4 [&_svg]:fill-none [&_svg]:stroke-current [&_svg]:stroke-[1.35] [&_svg]:[stroke-linecap:round] [&_svg]:[stroke-linejoin:round]";

function clampSidebarWidth(width: number): number {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width));
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
