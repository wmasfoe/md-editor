import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MarkdownFileTreeNode, MarkdownFolder } from "@md-editor/file-system";
import { cx } from "../lib/cx";
import type { FileTreeContextMenuState, TreeItemKind } from "../types";
import "./FileTreePanel.css";

const COLLAPSED_PATHS_STORAGE_PREFIX = "md-editor:file-tree:collapsed:";

// 行内编辑状态：新建 or 重命名
type EditingState =
  | { mode: "create"; parentPath: string; kind: TreeItemKind; defaultName: string }
  | { mode: "rename"; node: MarkdownFileTreeNode };
type SearchResultNode = MarkdownFileTreeNode & { kind: "markdown" | "asset" };

interface FileTreePanelProps {
  readonly folder: MarkdownFolder | null;
  readonly searchQuery?: string;
  readonly activeFilePath: string | null;
  readonly onOpenFolder: () => void;
  readonly onOpenFile: (filePath: string) => void;
  readonly onOpenAsset: (node: MarkdownFileTreeNode) => void;
  readonly onCreateTreeItem: (parentPath: string, kind: TreeItemKind, name: string) => void;
  readonly onRenameTreeItem: (node: MarkdownFileTreeNode, name: string) => void;
  readonly onDeleteTreeItem: (node: MarkdownFileTreeNode) => void;
}

export function FileTreePanel({
  folder,
  searchQuery = "",
  activeFilePath,
  onOpenFolder,
  onOpenFile,
  onOpenAsset,
  onCreateTreeItem,
  onRenameTreeItem,
  onDeleteTreeItem
}: FileTreePanelProps) {
  const [collapsedPaths, setCollapsedPaths] = useState<ReadonlySet<string>>(() => new Set());
  const [contextMenu, setContextMenu] = useState<FileTreeContextMenuState | null>(null);
  const [editing, setEditing] = useState<EditingState | null>(null);
  const collapsedPathsRootRef = useRef<string | null>(null);
  const normalizedSearchQuery = normalizeSearchQuery(searchQuery);
  const searchResults = useMemo(
    () => (folder && normalizedSearchQuery ? collectSearchResults(folder.tree, normalizedSearchQuery) : []),
    [folder, normalizedSearchQuery]
  );

  useEffect(() => {
    const rootPath = folder?.rootPath ?? null;
    collapsedPathsRootRef.current = rootPath;
    setCollapsedPaths(rootPath ? readCollapsedPaths(rootPath) : new Set());
  }, [folder?.rootPath]);

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

  const openContextMenu = useCallback((event: React.MouseEvent, node: MarkdownFileTreeNode | null) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      node
    });
  }, []);

  const startCreate = useCallback((parentPath: string, kind: TreeItemKind) => {
    const defaultName = kind === "markdown" ? "untitled.md" : "untitled";
    // 展开目标目录
    setCollapsedPaths((current) => {
      const next = new Set(current);
      next.delete(parentPath);
      return next;
    });
    setEditing({ mode: "create", parentPath, kind, defaultName });
  }, []);

  const startRename = useCallback((node: MarkdownFileTreeNode) => {
    setEditing({ mode: "rename", node });
  }, []);

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
    [editing, onCreateTreeItem, onRenameTreeItem]
  );

  const cancelEdit = useCallback(() => setEditing(null), []);

  if (!folder) {
    return (
      <div className="p-3 text-[13px] text-[var(--theme-control-subtle)]">
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

  const contextParentPath =
    contextMenu?.node?.kind === "directory" ? contextMenu.node.path : folder.rootPath;

  if (normalizedSearchQuery) {
    return (
      <div
        className="file-tree-scrollbar min-h-0 flex-1 overflow-auto pb-4 pt-1"
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
          <p className="m-0 px-3 py-2 text-[13px] text-[var(--theme-control-subtle)]">没有匹配的文件。</p>
        )}
        {contextMenu ? (
          <FileTreeContextMenu
            menu={contextMenu}
            parentPath={contextParentPath}
            onClose={() => setContextMenu(null)}
            onStartCreate={startCreate}
            onStartRename={startRename}
            onDeleteTreeItem={onDeleteTreeItem}
          />
        ) : null}
      </div>
    );
  }

  return (
    <div
      className="file-tree-scrollbar min-h-0 flex-1 overflow-auto pb-4"
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
          parentPath={contextParentPath}
          onClose={() => setContextMenu(null)}
          onStartCreate={startCreate}
          onStartRename={startRename}
          onDeleteTreeItem={onDeleteTreeItem}
        />
      ) : null}
    </div>
  );
}

function normalizeSearchQuery(query: string): string {
  return query.trim().toLowerCase();
}

function collectSearchResults(
  root: MarkdownFileTreeNode,
  normalizedQuery: string
): readonly SearchResultNode[] {
  const results: SearchResultNode[] = [];

  const visit = (node: MarkdownFileTreeNode) => {
    if (isSearchResultNode(node)) {
      const haystack = `${node.name}\n${node.path}`.toLowerCase();
      if (haystack.includes(normalizedQuery)) {
        results.push(node);
      }
      return;
    }
    node.children?.forEach(visit);
  };

  visit(root);
  return results;
}

function isSearchResultNode(node: MarkdownFileTreeNode): node is SearchResultNode {
  return node.kind === "markdown" || node.kind === "asset";
}

function SearchResultRow({
  node,
  rootPath,
  activeFilePath,
  onOpenFile,
  onOpenAsset,
  onOpenContextMenu
}: {
  readonly node: SearchResultNode;
  readonly rootPath: string;
  readonly activeFilePath: string | null;
  readonly onOpenFile: (filePath: string) => void;
  readonly onOpenAsset: (node: MarkdownFileTreeNode) => void;
  readonly onOpenContextMenu: (event: React.MouseEvent, node: MarkdownFileTreeNode) => void;
}) {
  const isMarkdown = node.kind === "markdown";
  const relativePath = relativePathFromRoot(rootPath, node.path);

  return (
    <button
      type="button"
      className={cx(
        "flex min-h-9 w-full items-center gap-2 border-0 bg-transparent px-3 py-1 text-left text-[13px] leading-[1.3] text-[var(--theme-control-text)] transition-colors duration-150 ease-out hover:bg-[var(--theme-control-hover)] hover:text-[var(--theme-title)] focus-visible:bg-[var(--theme-control-hover)] focus-visible:text-[var(--theme-title)] focus-visible:outline-none",
        node.path === activeFilePath && "bg-[var(--theme-control-active)] font-[560] text-[var(--theme-title)]"
      )}
      title={node.path}
      onClick={() => (isMarkdown ? onOpenFile(node.path) : onOpenAsset(node))}
      onContextMenu={(event) => onOpenContextMenu(event, node)}
    >
      <FileKindIcon kind={node.kind} />
      <span className="min-w-0">
        <span className="block overflow-hidden text-ellipsis whitespace-nowrap">{node.name}</span>
        <small className="block overflow-hidden text-ellipsis whitespace-nowrap text-[11px] font-normal text-[var(--theme-control-subtle)]">
          {relativePath}
        </small>
      </span>
    </button>
  );
}

function relativePathFromRoot(rootPath: string, path: string): string {
  const normalizedRoot = rootPath.replace(/\\/g, "/").replace(/\/$/u, "");
  const normalizedPath = path.replace(/\\/g, "/");
  return normalizedPath.startsWith(`${normalizedRoot}/`)
    ? normalizedPath.slice(normalizedRoot.length + 1)
    : normalizedPath;
}

function storageKeyForRoot(rootPath: string): string {
  return `${COLLAPSED_PATHS_STORAGE_PREFIX}${encodeURIComponent(rootPath)}`;
}

function readCollapsedPaths(rootPath: string): ReadonlySet<string> {
  try {
    const raw = window.localStorage.getItem(storageKeyForRoot(rootPath));
    const paths = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(paths) ? paths.filter((path) => typeof path === "string") : []);
  } catch {
    // Persisted tree state is a convenience only; broken storage should not block authoring.
    return new Set();
  }
}

function writeCollapsedPaths(rootPath: string, collapsedPaths: ReadonlySet<string>) {
  try {
    const key = storageKeyForRoot(rootPath);
    if (collapsedPaths.size === 0) {
      window.localStorage.removeItem(key);
      return;
    }

    window.localStorage.setItem(key, JSON.stringify([...collapsedPaths]));
  } catch {
    // Ignore quota/private-mode failures and keep the in-memory tree usable.
  }
}

interface FileTreeNodeViewProps {
  readonly node: MarkdownFileTreeNode;
  readonly activeFilePath: string | null;
  readonly collapsedPaths: ReadonlySet<string>;
  readonly depth?: number;
  readonly editing: EditingState | null;
  readonly onToggleCollapsed: (path: string) => void;
  readonly onOpenFile: (filePath: string) => void;
  readonly onOpenAsset: (node: MarkdownFileTreeNode) => void;
  readonly onOpenContextMenu: (event: React.MouseEvent, node: MarkdownFileTreeNode) => void;
  readonly onCommitEdit: (name: string) => void;
  readonly onCancelEdit: () => void;
}

function FileTreeNodeView({
  node,
  activeFilePath,
  collapsedPaths,
  depth = 0,
  editing,
  onToggleCollapsed,
  onOpenFile,
  onOpenAsset,
  onOpenContextMenu,
  onCommitEdit,
  onCancelEdit
}: FileTreeNodeViewProps) {
  const paddingLeft = 16 + depth * 14;

  const isRenaming = editing?.mode === "rename" && editing.node.path === node.path;

  if (node.kind === "markdown" || node.kind === "asset") {
    const isMarkdown = node.kind === "markdown";

    if (isRenaming) {
      return (
        <InlineInput
          defaultValue={node.name}
          paddingLeft={paddingLeft}
          onCommit={onCommitEdit}
          onCancel={onCancelEdit}
        />
      );
    }

    return (
      <button
        type="button"
        className={cx(
          "flex min-h-7 w-full items-center gap-1.5 border-0 bg-transparent py-0 text-left text-[13px] leading-[1.35] text-[var(--theme-control-text)] transition-colors duration-150 ease-out hover:bg-[var(--theme-control-hover)] hover:text-[var(--theme-title)] focus-visible:bg-[var(--theme-control-hover)] focus-visible:text-[var(--theme-title)] focus-visible:outline-none",
          node.path === activeFilePath && "bg-[var(--theme-control-active)] font-[560] text-[var(--theme-title)]"
        )}
        style={{ paddingLeft }}
        title={node.path}
        onClick={() => (isMarkdown ? onOpenFile(node.path) : onOpenAsset(node))}
        onContextMenu={(event) => onOpenContextMenu(event, node)}
      >
        <FileKindIcon kind={node.kind} />
        <span className="overflow-hidden text-ellipsis whitespace-nowrap">{node.name}</span>
      </button>
    );
  }

  const isCollapsed = collapsedPaths.has(node.path);
  const isCreatingInside =
    editing?.mode === "create" && editing.parentPath === node.path;

  if (isRenaming) {
    return (
      <div>
        <InlineInput
          defaultValue={node.name}
          paddingLeft={paddingLeft}
          onCommit={onCommitEdit}
          onCancel={onCancelEdit}
        />
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        className="flex min-h-7 w-full items-center gap-1.5 border-0 bg-transparent py-0 text-left text-[13px] leading-[1.35] text-[var(--theme-control-subtle)] transition-colors duration-150 ease-out hover:bg-[var(--theme-control-hover)] hover:text-[var(--theme-title)] focus-visible:bg-[var(--theme-control-hover)] focus-visible:text-[var(--theme-title)] focus-visible:outline-none"
        style={{ paddingLeft }}
        title={node.path}
        aria-expanded={!isCollapsed}
        onClick={() => onToggleCollapsed(node.path)}
        onContextMenu={(event) => onOpenContextMenu(event, node)}
      >
        <span className="file-tree-icon inline-flex h-4 w-4 flex-none items-center justify-center text-[var(--theme-control-subtle)]">
          {isCollapsed ? (
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M3.5 2L6.5 5L3.5 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          )}
        </span>
        <span className="overflow-hidden text-ellipsis whitespace-nowrap">{node.name}</span>
      </button>
      {!isCollapsed && (
        <>
          {node.children?.map((child) => (
            <FileTreeNodeView
              key={child.path}
              node={child}
              activeFilePath={activeFilePath}
              collapsedPaths={collapsedPaths}
              depth={depth + 1}
              editing={editing}
              onToggleCollapsed={onToggleCollapsed}
              onOpenFile={onOpenFile}
              onOpenAsset={onOpenAsset}
              onOpenContextMenu={onOpenContextMenu}
              onCommitEdit={onCommitEdit}
              onCancelEdit={onCancelEdit}
            />
          ))}
          {isCreatingInside && (
            <InlineInput
              defaultValue={editing.defaultName}
              paddingLeft={16 + (depth + 1) * 14}
              onCommit={onCommitEdit}
              onCancel={onCancelEdit}
            />
          )}
        </>
      )}
    </div>
  );
}

function InlineInput({
  defaultValue,
  paddingLeft,
  onCommit,
  onCancel
}: {
  readonly defaultValue: string;
  readonly paddingLeft: number;
  readonly onCommit: (name: string) => void;
  readonly onCancel: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    // 选中不含扩展名的部分
    const dotIndex = el.value.lastIndexOf(".");
    el.setSelectionRange(0, dotIndex > 0 ? dotIndex : el.value.length);
  }, []);

  const commit = () => {
    const val = inputRef.current?.value ?? "";
    onCommit(val);
  };

  return (
    <div className="flex min-h-7 items-center" style={{ paddingLeft }}>
      <input
        ref={inputRef}
        type="text"
        defaultValue={defaultValue}
        className="h-5.5 w-full min-w-0 rounded-[3px] border border-(--theme-accent,#4f8ef7) bg-(--theme-surface) px-1.5 text-[13px] leading-[1.35] text-(--theme-title) outline-none ring-2 ring-(--theme-accent,#4f8ef7)/20"
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
      />
    </div>
  );
}

function FileKindIcon({ kind }: { readonly kind: "markdown" | "asset" }) {
  const title = kind === "markdown" ? "Markdown 文件" : "图片文件";

  return (
    <span
      className={cx(
        "file-tree-icon inline-flex h-4 w-4 flex-none items-center justify-center text-(--theme-control-subtle)",
        kind === "asset" && "text-(--theme-control-text)"
      )}
      title={title}
      aria-label={title}
    >
      {kind === "markdown" ? (
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <rect x="1" y="1" width="11" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.2"/>
          <path d="M3.5 9V4.5L5.5 7L7.5 4.5V9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M9.5 4.5V9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
        </svg>
      ) : (
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <rect x="1" y="1" width="11" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.2"/>
          <circle cx="9" cy="4.5" r="1" fill="currentColor"/>
          <path d="M1.5 9.5L4 7L6 9L8 7.5L11.5 10.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      )}
    </span>
  );
}

interface FileTreeContextMenuProps {
  readonly menu: FileTreeContextMenuState;
  readonly parentPath: string;
  readonly onClose: () => void;
  readonly onStartCreate: (parentPath: string, kind: TreeItemKind) => void;
  readonly onStartRename: (node: MarkdownFileTreeNode) => void;
  readonly onDeleteTreeItem: (node: MarkdownFileTreeNode) => void;
}

function FileTreeContextMenu({
  menu,
  parentPath,
  onClose,
  onStartCreate,
  onStartRename,
  onDeleteTreeItem
}: FileTreeContextMenuProps) {
  const run = useCallback(
    (action: () => void) => {
      onClose();
      action();
    },
    [onClose]
  );

  return (
    <div
      className="fixed z-50 min-w-37.5 rounded-md border border-(--theme-border) bg-(--theme-surface) p-1 shadow-[0_12px_30px_rgba(51,51,51,0.14)]"
      style={{ left: menu.x, top: menu.y }}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      <ContextMenuItem onClick={() => run(() => onStartCreate(parentPath, "markdown"))}>
        新建文件
      </ContextMenuItem>
      <ContextMenuItem onClick={() => run(() => onStartCreate(parentPath, "directory"))}>
        新建文件夹
      </ContextMenuItem>
      {menu.node ? (
        <>
          <div className="m-1 h-px bg-(--theme-border)" />
          <ContextMenuItem onClick={() => run(() => onStartRename(menu.node!))}>
            重命名
          </ContextMenuItem>
          <ContextMenuItem danger onClick={() => run(() => onDeleteTreeItem(menu.node!))}>
            删除
          </ContextMenuItem>
        </>
      ) : null}
    </div>
  );
}

function ContextMenuItem({
  children,
  danger = false,
  onClick
}: {
  readonly children: React.ReactNode;
  readonly danger?: boolean;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={cx(
        "block min-h-7 w-full rounded-sm border-0 bg-transparent px-2 py-1 text-left text-[13px] leading-[1.35] text-(--theme-control-text) transition-colors hover:bg-(--theme-control-hover) hover:text-(--theme-title)",
        danger && "text-(--theme-danger-text)"
      )}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
