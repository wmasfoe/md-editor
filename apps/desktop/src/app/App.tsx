import { AssetPreview, MilkdownEditor, OutlinePanel, SourceEditor } from "@md-editor/editor-ui";
import { FileTreePanel } from "../components/FileTreePanel";
import { cx } from "../lib/cx";
import { useDesktopEditorController } from "./useDesktopEditorController";

export function App() {
  const editor = useDesktopEditorController();

  return (
    <main className="flex h-full min-h-0 w-full min-w-0 overflow-hidden bg-[var(--theme-bg)]">
      <aside
        className="flex min-h-0 w-[250px] min-w-[220px] max-w-[320px] flex-[0_0_250px] flex-col overflow-hidden border-r border-[var(--theme-border)] bg-[var(--theme-chrome)] text-[var(--theme-control-text)]"
        aria-label={editor.sidebarMode === "files" ? "文件树" : "大纲目录"}
      >
        <div
          className="grid grid-cols-2 gap-1 border-b border-[var(--theme-border)] p-2.5"
          role="tablist"
          aria-label="侧栏视图"
        >
          <SidebarTab active={editor.sidebarMode === "files"} onClick={() => editor.setSidebarMode("files")}>
            文件
          </SidebarTab>
          <SidebarTab active={editor.sidebarMode === "outline"} onClick={() => editor.setSidebarMode("outline")}>
            大纲
          </SidebarTab>
        </div>
        {editor.sidebarMode === "files" ? (
          <FileTreePanel
            folder={editor.folder}
            activeFilePath={editor.snapshot.filePath}
            onOpenFolder={() => void editor.dispatchCommand("file.openFolder")}
            onOpenFile={(filePath) => void editor.openDocumentFromTree(filePath)}
            onOpenAsset={(node) => editor.openAssetFromTree(node)}
            onCreateTreeItem={(parentPath, kind) => void editor.createTreeItem(parentPath, kind)}
            onRenameTreeItem={(node) => void editor.renameTreeItem(node)}
            onDeleteTreeItem={(node) => void editor.deleteTreeItem(node)}
          />
        ) : (
          <OutlinePanel outline={editor.outline} onJump={editor.jumpToTocItem} />
        )}
      </aside>
      <section
        className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[var(--theme-surface)]"
        aria-label="Markdown 编辑器"
      >
        {editor.errorMessage ? (
          <div className="border-b border-[rgba(227,15,46,0.25)] bg-[var(--theme-danger-bg)] px-5 py-2.5 text-sm text-[var(--theme-danger-text)]">
            {editor.errorMessage}
          </div>
        ) : null}
        {editor.pendingAction ? (
          <div className="pointer-events-none fixed left-1/2 top-[18px] z-20 -translate-x-1/2 rounded border border-[var(--theme-border)] bg-white/95 px-3 py-1.5 text-[13px] leading-[1.4] text-[var(--theme-muted)] shadow-[0_4px_18px_rgba(0,0,0,0.08)]">
            {editor.pendingAction}
          </div>
        ) : null}
        {editor.openedAsset ? (
          <AssetPreview asset={editor.openedAsset} resolveAssetSrc={editor.resolveImageSrc} />
        ) : editor.snapshot.mode === "source" ? (
          <SourceEditor
            snapshot={editor.snapshot}
            target={editor.tocTarget}
            onChange={editor.commitMarkdown}
          />
        ) : (
          <MilkdownEditor
            key={editor.documentKey}
            snapshot={editor.snapshot}
            target={editor.tocTarget}
            onChange={editor.commitMarkdown}
            resolveImageSrc={editor.resolveImageSrc}
          />
        )}
      </section>
    </main>
  );
}

function SidebarTab({
  active,
  children,
  onClick
}: {
  readonly active: boolean;
  readonly children: React.ReactNode;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={cx(
        "rounded border border-transparent bg-transparent px-2 py-1 text-[13px] leading-[1.4] text-[var(--theme-control-text)] hover:bg-[var(--theme-control-hover)]",
        active && "border-[var(--theme-border)] bg-[var(--theme-surface)] text-[var(--theme-text)]"
      )}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
