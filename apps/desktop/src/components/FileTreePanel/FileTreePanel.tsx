import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MarkdownFileTreeNode, RuntimeFileService } from "@md-editor/file-system";
import { findFirstMarkdownPath } from "../../app/files/file-tree-mutations";
import { createDefaultCollapsedDirectoryPaths } from "../../app/files/file-tree-view-state";
import {
  FILE_TREE_CONTEXT_MENU_ACTION,
  copyNativeFileTreePath,
  isDesktopNativeFileTreeContextMenuAvailable,
  listenToNativeFileTreeContextMenuActions,
  revealNativeFileTreeItemInFinder,
  showNativeFileTreeContextMenu,
  type FileTreeContextMenuAction,
} from "../../desktop/file-tree-context-menu";
import { useDocumentSnapshot } from "../../app/document-store";
import { useDocumentUiStore } from "../../app/stores/document-ui-store";
import { useDesktopEditorActions } from "../../app/context/DesktopEditorActionsContext";
import { useFileActionStore } from "../../app/stores/file-action-store";
import { useFileTreeStore } from "../../app/stores/file-tree-store";
import type { FileTreeContextMenuState, TreeItemKind } from "../../types";
import { FileTreeNodeView } from "./FileTreeNodeView";
import { SearchResultRow } from "./SearchResultRow";
import { FileTreeContextMenu } from "./FileTreeContextMenu";
import type { EditingState } from "./types";
import {
  normalizeSearchQuery,
  collectSearchResults,
  readCollapsedPaths,
  writeCollapsedPaths,
  isPathInsideRoot,
} from "./utils";
import "./FileTreePanel.css";

export interface FileTreePanelProps {
  readonly fileService: RuntimeFileService;
  readonly searchQuery?: string;
}

export function FileTreePanel({ fileService, searchQuery = "" }: FileTreePanelProps) {
  const { folder, createTreeItem, renameTreeItem, deleteTreeItem } = useFileTreeStore();
  const { openAssetFromTree } = useDocumentUiStore();
  const { dispatchCommand, openDocumentFromTree } = useDesktopEditorActions();
  const { showFileActionError } = useFileActionStore();
  const { filePath: activeFilePath } = useDocumentSnapshot();

  const onOpenFolder = useCallback(
    () => void dispatchCommand("file.openFolder"),
    [dispatchCommand],
  );
  const onOpenFile = useCallback(
    (filePath: string) => void openDocumentFromTree(filePath),
    [openDocumentFromTree],
  );
  const onOpenAsset = useCallback(
    (node: MarkdownFileTreeNode) => openAssetFromTree(node),
    [openAssetFromTree],
  );
  const onCreateTreeItem = useCallback(
    (parentPath: string, kind: TreeItemKind, name: string) =>
      void createTreeItem(fileService, parentPath, kind, name),
    [createTreeItem, fileService],
  );
  const onRenameTreeItem = useCallback(
    (node: MarkdownFileTreeNode, name: string) => void renameTreeItem(fileService, node, name),
    [fileService, renameTreeItem],
  );
  const onDeleteTreeItem = useCallback(
    (node: MarkdownFileTreeNode) => void deleteTreeItem(fileService, node),
    [deleteTreeItem, fileService],
  );
  const onContextMenuError = showFileActionError;
  const [collapsedPaths, setCollapsedPaths] = useState<ReadonlySet<string>>(() => new Set());
  const [contextMenu, setContextMenu] = useState<FileTreeContextMenuState | null>(null);
  const [editing, setEditing] = useState<EditingState | null>(null);
  const collapsedPathsRootRef = useRef<string | null>(null);
  const contextMenuTargetRef = useRef<FileTreeContextMenuState | null>(null);
  const normalizedSearchQuery = normalizeSearchQuery(searchQuery);
  const searchResults = useMemo(
    () =>
      folder && normalizedSearchQuery
        ? collectSearchResults(folder.tree, normalizedSearchQuery)
        : [],
    [folder, normalizedSearchQuery],
  );

  useEffect(() => {
    const nextRootPath = folder?.rootPath ?? null;
    if (collapsedPathsRootRef.current === nextRootPath) {
      return;
    }

    collapsedPathsRootRef.current = nextRootPath;
    if (!folder) {
      setCollapsedPaths(new Set());
      return;
    }

    const storedCollapsedPaths = readCollapsedPaths(folder.rootPath);
    setCollapsedPaths(
      storedCollapsedPaths ??
        createDefaultCollapsedDirectoryPaths(
          folder.tree,
          activeFilePath && isPathInsideRoot(activeFilePath, folder.rootPath)
            ? activeFilePath
            : findFirstMarkdownPath(folder.tree),
        ),
    );
  }, [activeFilePath, folder]);

  useEffect(() => {
    if (!folder?.rootPath || collapsedPathsRootRef.current !== folder.rootPath) {
      return;
    }

    writeCollapsedPaths(folder.rootPath, collapsedPaths);
  }, [collapsedPaths, folder?.rootPath]);

  useEffect(() => {
    if (!contextMenu) {
      return;
    }

    const closeMenu = () => setContextMenu(null);
    window.addEventListener("click", closeMenu);
    window.addEventListener("keydown", closeMenu);
    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("keydown", closeMenu);
    };
  }, [contextMenu]);

  const toggleCollapsed = useCallback((path: string) => {
    setCollapsedPaths((current) => {
      const next = new Set(current);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const startCreate = useCallback(
    (parentPath: string, kind: TreeItemKind, defaultName?: string) => {
      const nextDefaultName = defaultName ?? (kind === "markdown" ? "untitled.md" : "untitled");
      // 展开目标目录
      setCollapsedPaths((current) => {
        const next = new Set(current);
        next.delete(parentPath);
        return next;
      });
      setEditing({ mode: "create", parentPath, kind, defaultName: nextDefaultName });
    },
    [],
  );

  const startRename = useCallback((node: MarkdownFileTreeNode) => {
    setEditing({ mode: "rename", node });
  }, []);

  const runContextMenuAction = useCallback(
    async (menu: FileTreeContextMenuState, action: FileTreeContextMenuAction) => {
      if (!folder) {
        return;
      }

      const parentPath = menu.node?.kind === "directory" ? menu.node.path : folder.rootPath;

      switch (action) {
        case FILE_TREE_CONTEXT_MENU_ACTION.newMarkdown:
          startCreate(parentPath, "markdown");
          break;
        case FILE_TREE_CONTEXT_MENU_ACTION.newMdx:
          startCreate(parentPath, "markdown", "untitled.mdx");
          break;
        case FILE_TREE_CONTEXT_MENU_ACTION.newFolder:
          startCreate(parentPath, "directory");
          break;
        case FILE_TREE_CONTEXT_MENU_ACTION.copyRelativePath:
          if (menu.node) {
            await copyNativeFileTreePath({
              rootPath: folder.rootPath,
              path: menu.node.path,
              relative: true,
            });
          }
          break;
        case FILE_TREE_CONTEXT_MENU_ACTION.copyAbsolutePath:
          if (menu.node) {
            await copyNativeFileTreePath({
              rootPath: folder.rootPath,
              path: menu.node.path,
              relative: false,
            });
          }
          break;
        case FILE_TREE_CONTEXT_MENU_ACTION.revealInFinder:
          if (menu.node) {
            await revealNativeFileTreeItemInFinder({
              rootPath: folder.rootPath,
              path: menu.node.path,
            });
          }
          break;
        case FILE_TREE_CONTEXT_MENU_ACTION.rename:
          if (menu.node) {
            startRename(menu.node);
          }
          break;
        case FILE_TREE_CONTEXT_MENU_ACTION.delete:
          if (menu.node) {
            onDeleteTreeItem(menu.node);
          }
          break;
      }
    },
    [folder, onDeleteTreeItem, startCreate, startRename],
  );

  const runContextMenuActionWithErrorHandling = useCallback(
    (menu: FileTreeContextMenuState, action: FileTreeContextMenuAction) => {
      void runContextMenuAction(menu, action).catch((error: unknown) => {
        onContextMenuError?.(error);
      });
    },
    [onContextMenuError, runContextMenuAction],
  );

  useEffect(() => {
    return listenToNativeFileTreeContextMenuActions((action) => {
      const menu = contextMenuTargetRef.current;
      if (!menu) {
        return;
      }

      runContextMenuActionWithErrorHandling(menu, action);
    });
  }, [runContextMenuActionWithErrorHandling]);

  const openContextMenu = useCallback(
    (event: React.MouseEvent, node: MarkdownFileTreeNode | null) => {
      event.preventDefault();
      event.stopPropagation();

      const menu = {
        x: event.clientX,
        y: event.clientY,
        node,
      };
      contextMenuTargetRef.current = menu;

      if (isDesktopNativeFileTreeContextMenuAvailable()) {
        setContextMenu(null);
        void showNativeFileTreeContextMenu({
          x: menu.x,
          y: menu.y,
          hasNode: Boolean(node),
        }).catch((error: unknown) => {
          onContextMenuError?.(error);
        });
        return;
      }

      setContextMenu(menu);
    },
    [onContextMenuError],
  );

  const commitEdit = useCallback(
    (name: string) => {
      if (!editing) return;
      const trimmed = name.trim();
      if (trimmed) {
        if (editing.mode === "create") {
          onCreateTreeItem(editing.parentPath, editing.kind, trimmed);
        } else {
          onRenameTreeItem(editing.node, trimmed);
        }
      }
      setEditing(null);
    },
    [editing, onCreateTreeItem, onRenameTreeItem],
  );

  const cancelEdit = useCallback(() => setEditing(null), []);

  if (!folder) {
    return (
      <div className="min-h-0 flex-1 bg-[var(--theme-surface)] p-3 text-[13px] text-[var(--theme-control-subtle)]">
        <button
          type="button"
          className="w-full rounded-sm border border-transparent bg-transparent px-2 py-1.5 text-left text-[13px] leading-[1.4] text-[var(--theme-control-text)] transition-colors hover:bg-[var(--theme-control-hover)] hover:text-[var(--theme-title)]"
          onClick={onOpenFolder}
        >
          打开文件夹
        </button>
      </div>
    );
  }

  if (normalizedSearchQuery) {
    return (
      <div
        className="file-tree-scrollbar min-h-0 flex-1 overflow-auto bg-[var(--theme-surface)] pb-4 pt-1"
        onContextMenu={(event) => openContextMenu(event, null)}
      >
        {searchResults.length > 0 ? (
          searchResults.map((node) => (
            <SearchResultRow
              key={node.path}
              node={node}
              rootPath={folder.rootPath}
              activeFilePath={activeFilePath}
              onOpenFile={onOpenFile}
              onOpenAsset={onOpenAsset}
              onOpenContextMenu={openContextMenu}
            />
          ))
        ) : (
          <p className="m-0 px-3 py-2 text-[13px] text-[var(--theme-control-subtle)]">
            没有匹配的文件。
          </p>
        )}
        {contextMenu ? (
          <FileTreeContextMenu
            menu={contextMenu}
            onClose={() => setContextMenu(null)}
            onRunAction={runContextMenuActionWithErrorHandling}
          />
        ) : null}
      </div>
    );
  }

  return (
    <div
      className="file-tree-scrollbar min-h-0 flex-1 overflow-auto bg-[var(--theme-surface)] pb-4"
      onContextMenu={(event) => openContextMenu(event, null)}
    >
      <FileTreeNodeView
        node={folder.tree}
        activeFilePath={activeFilePath}
        collapsedPaths={collapsedPaths}
        editing={editing}
        onToggleCollapsed={toggleCollapsed}
        onOpenFile={onOpenFile}
        onOpenAsset={onOpenAsset}
        onOpenContextMenu={openContextMenu}
        onCommitEdit={commitEdit}
        onCancelEdit={cancelEdit}
      />
      {contextMenu ? (
        <FileTreeContextMenu
          menu={contextMenu}
          onClose={() => setContextMenu(null)}
          onRunAction={runContextMenuActionWithErrorHandling}
        />
      ) : null}
    </div>
  );
}
