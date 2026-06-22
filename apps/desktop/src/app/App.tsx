import { lazy, Suspense, useMemo, useState } from "react";
import type { MarkdownFileTreeNode } from "@md-editor/file-system";
import {
  AssetPreview,
  ConfirmActionDialog,
  DocumentBar,
  OutlinePanel,
  WelcomeState
} from "@md-editor/editor-ui";
import { FileTreePanel } from "../components/FileTreePanel";
import { SettingsDialog } from "../components/SettingsDialog";
import { cx } from "../lib/cx";
import { useDesktopEditorController } from "./controller/useDesktopEditorController";

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

  return (
    <main className="flex h-full min-h-0 w-full min-w-0 overflow-hidden bg-[var(--theme-bg)]">
      {editor.isSidebarVisible ? (
        <button
          type="button"
          className="sidebar-backdrop"
          aria-label="关闭侧栏"
          onClick={() => editor.setIsSidebarVisible(false)}
        />
      ) : null}
      <aside
        className={cx("app-sidebar", editor.isSidebarVisible && "app-sidebar--visible")}
        style={{ "--app-sidebar-width": `${sidebarWidth}px` } as React.CSSProperties}
        aria-label={editor.sidebarMode === "files" ? "文件树" : "大纲目录"}
        aria-hidden={!editor.isSidebarVisible}
        inert={!editor.isSidebarVisible}
      >
        <div className="sidebar-header">
          <button
            type="button"
            className="sidebar-header__tab sidebar-header__tab--active"
            aria-label={editor.sidebarMode === "files" ? "切换到大纲" : "切换到文件"}
            title={editor.sidebarMode === "files" ? "切换到大纲" : "切换到文件"}
            onClick={() => editor.setSidebarMode(editor.sidebarMode === "files" ? "outline" : "files")}
          >
            {editor.sidebarMode === "files" ? <FilesIcon /> : <OutlineIcon />}
          </button>
          <strong className="sidebar-header__title">{sidebarTitle}</strong>
          <button
            type="button"
            className="sidebar-header__icon-button"
            aria-label={isFileSearchOpen ? "关闭文件搜索" : "搜索文件"}
            aria-pressed={isFileSearchOpen}
            title="搜索文件"
            onClick={() => {
              editor.setSidebarMode("files");
              setIsFileSearchOpen((current) => !current);
            }}
          >
            <SearchIcon />
          </button>
        </div>
        {showFileSearch ? (
          <div className="sidebar-search" role="search">
            <SearchIcon />
            <input
              type="search"
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
            <span aria-live="polite" title="匹配数量">
              {fileSearchQuery.trim() ? fileSearchResultCount : ""}
            </span>
          </div>
        ) : null}
        <div className="sidebar-content">
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
            className="editor-sidebar-toggle"
            aria-label="显示侧栏"
            title="显示侧栏"
            onClick={() => editor.setIsSidebarVisible(true)}
          >
            <SidebarIcon />
          </button>
        ) : null}
        {editor.errorMessage ? (
          <div
            className="border-b border-[rgba(227,15,46,0.25)] bg-[var(--theme-danger-bg)] px-5 py-2.5 text-sm text-[var(--theme-danger-text)]"
            role="alert"
          >
            {editor.errorMessage}
          </div>
        ) : null}
        {editor.pendingAction ? (
          <div
            className="pointer-events-none fixed left-1/2 top-[18px] z-20 -translate-x-1/2 rounded border border-[var(--theme-border)] bg-white/95 px-3 py-1.5 text-[13px] leading-[1.4] text-[var(--theme-muted)] shadow-[0_4px_18px_rgba(0,0,0,0.08)]"
            role="status"
          >
            {editor.pendingAction}
          </div>
        ) : null}
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
          <Suspense fallback={<EditorLoadingState />}>
            <SourceEditor
              snapshot={editor.snapshot}
              target={editor.tocTarget}
              onChange={editor.commitMarkdown}
              onVisibleLineChange={editor.updateActiveOutlineForLine}
            />
          </Suspense>
        ) : (
          <Suspense fallback={<EditorLoadingState />}>
            <MilkdownEditor
              key={editor.documentKey}
              snapshot={editor.snapshot}
              outline={editor.outline}
              target={editor.tocTarget}
              onChange={editor.commitMarkdown}
              onActiveOutlineChange={editor.setActiveOutlineId}
              resolveImageSrc={editor.resolveImageSrc}
            />
          </Suspense>
        )}
      </section>
      <ConfirmActionDialog
        confirmation={editor.confirmation}
        onResolve={editor.resolveConfirmation}
      />
      {editor.isSettingsOpen ? (
        <SettingsDialog
          settings={editor.settings}
          updateStatus={editor.updateStatus}
          shortcutDrafts={editor.shortcutDrafts}
          assetsDirectoryDraft={editor.assetsDirectoryDraft}
          errorMessage={editor.settingsErrorMessage}
          isSaving={editor.isSavingSettings}
          isCheckingForUpdates={editor.updateStatus.state === "checking"}
          onCaptureShortcut={editor.captureShortcutDraft}
          onResetShortcut={editor.resetShortcutDraft}
          onChangeAssetsDirectory={editor.setAssetsDirectoryDraft}
          onSave={() => void editor.saveSettings()}
          onClose={editor.closeSettings}
          onCheckForUpdates={() => void editor.runUpdateCheck()}
        />
      ) : null}
    </main>
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
      className="sidebar-resize-handle"
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

function clampSidebarWidth(width: number): number {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width));
}

function EditorLoadingState() {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-[var(--theme-muted)]" role="status">
      正在载入源码编辑器…
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

function FilesIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2.5 4.2h4l1 1.3h6v6.8a1.2 1.2 0 0 1-1.2 1.2H3.7a1.2 1.2 0 0 1-1.2-1.2z" />
      <path d="M2.5 4.2V3.7a1.2 1.2 0 0 1 1.2-1.2h3.1l1 1.2h4.5a1.2 1.2 0 0 1 1.2 1.2v.6" />
    </svg>
  );
}

function OutlineIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4.5 3h8M4.5 8h8M4.5 13h8" />
      <path d="M2 3h.1M2 8h.1M2 13h.1" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="7" cy="7" r="4.2" />
      <path d="M10.2 10.2 13.5 13.5" />
    </svg>
  );
}

function SidebarIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <rect x="2" y="2.5" width="12" height="11" rx="1.5" />
      <path d="M6 3v10" />
    </svg>
  );
}
