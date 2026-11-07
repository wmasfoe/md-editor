import { useEffect } from "react";
import type { MarkdownFileTreeNode } from "@md-editor/file-system";
import { useTranslation } from "@md-editor/i18n";
import { ContextMenuItem } from "./ContextMenuItem";

export interface ContextMenuPosition {
  x: number;
  y: number;
  node: MarkdownFileTreeNode | null;
  parentPath: string;
}

export interface WebFileContextMenuProps {
  readonly menu: ContextMenuPosition;
  readonly onClose: () => void;
  readonly onNewFile: (parentPath: string, isMdx?: boolean) => void;
  readonly onNewFolder: (parentPath: string) => void;
  readonly onRename: (node: MarkdownFileTreeNode) => void;
  readonly onDelete: (node: MarkdownFileTreeNode) => void;
  readonly onCopyPath: (node: MarkdownFileTreeNode) => void;
}

export function WebFileContextMenu({
  menu,
  onClose,
  onNewFile,
  onNewFolder,
  onRename,
  onDelete,
  onCopyPath,
}: WebFileContextMenuProps) {
  const { t } = useTranslation();

  useEffect(() => {
    const handleGlobalClick = () => onClose();
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("click", handleGlobalClick);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("click", handleGlobalClick);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  return (
    <div
      className="fixed z-50 min-w-44 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-surface)] p-1 shadow-[var(--theme-shadow)] animate-in fade-in zoom-in-95 duration-100"
      style={{ left: menu.x, top: menu.y }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <ContextMenuItem
        onClick={() => {
          onClose();
          onNewFile(menu.parentPath, false);
        }}
      >
        {t("fileTree.contextMenu.newFile")} (.md)
      </ContextMenuItem>
      <ContextMenuItem
        onClick={() => {
          onClose();
          onNewFile(menu.parentPath, true);
        }}
      >
        {t("fileTree.contextMenu.newMdxFile")} (.mdx)
      </ContextMenuItem>
      <ContextMenuItem
        onClick={() => {
          onClose();
          onNewFolder(menu.parentPath);
        }}
      >
        {t("fileTree.contextMenu.newFolder")}
      </ContextMenuItem>

      {menu.node ? (
        <>
          <div className="my-1 h-px bg-[var(--theme-border)]/60" />
          <ContextMenuItem
            onClick={() => {
              onClose();
              onCopyPath(menu.node!);
            }}
          >
            {t("fileTree.contextMenu.copyRelativePath")}
          </ContextMenuItem>
          <div className="my-1 h-px bg-[var(--theme-border)]/60" />
          <ContextMenuItem
            onClick={() => {
              onClose();
              onRename(menu.node!);
            }}
          >
            {t("fileTree.contextMenu.rename")}
          </ContextMenuItem>
          <ContextMenuItem
            danger
            onClick={() => {
              onClose();
              onDelete(menu.node!);
            }}
          >
            {t("fileTree.contextMenu.delete")}
          </ContextMenuItem>
        </>
      ) : null}
    </div>
  );
}
