import { Menu, MenuButton, MenuItem, MenuItems } from "@headlessui/react";
import { useCallback, useEffect, useState } from "react";
import type { MarkdownFileTreeNode, MarkdownFolder } from "@md-editor/file-system";
import { cx } from "../lib/cx";
import type { FileTreeContextMenuState, TreeItemKind } from "../types";

interface FileTreePanelProps {
  readonly folder: MarkdownFolder | null;
  readonly activeFilePath: string | null;
  readonly onOpenFolder: () => void;
  readonly onOpenFile: (filePath: string) => void;
  readonly onOpenAsset: (node: MarkdownFileTreeNode) => void;
  readonly onCreateTreeItem: (parentPath: string, kind: TreeItemKind) => void;
  readonly onRenameTreeItem: (node: MarkdownFileTreeNode) => void;
  readonly onDeleteTreeItem: (node: MarkdownFileTreeNode) => void;
}

export function FileTreePanel({
  folder,
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

  useEffect(() => {
    setCollapsedPaths(new Set());
  }, [folder?.rootPath]);

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

  if (!folder) {
    return (
      <div className="p-4 text-[13px] text-[var(--theme-muted)]">
        <button
          type="button"
          className="w-full rounded border border-transparent bg-transparent px-2 py-1.5 text-left text-[13px] leading-[1.4] text-[var(--theme-control-text)] hover:bg-[var(--theme-control-hover)]"
          onClick={onOpenFolder}
        >
          打开文件夹
        </button>
      </div>
    );
  }

  const contextParentPath =
    contextMenu?.node?.kind === "directory" ? contextMenu.node.path : folder.rootPath;

  return (
    <div
      className="min-h-0 flex-1 overflow-auto py-2"
      onContextMenu={(event) => openContextMenu(event, null)}
    >
      <div
        className="overflow-hidden px-3 pb-2 pt-1 text-[12px] font-semibold text-ellipsis whitespace-nowrap text-[var(--theme-muted)]"
        title={folder.rootPath}
      >
        {folder.rootName}
      </div>
      <FileTreeNodeView
        node={folder.tree}
        activeFilePath={activeFilePath}
        collapsedPaths={collapsedPaths}
        onToggleCollapsed={toggleCollapsed}
        onOpenFile={onOpenFile}
        onOpenAsset={onOpenAsset}
        onOpenContextMenu={openContextMenu}
      />
      {contextMenu ? (
        <FileTreeContextMenu
          menu={contextMenu}
          parentPath={contextParentPath}
          onClose={() => setContextMenu(null)}
          onCreateTreeItem={onCreateTreeItem}
          onRenameTreeItem={onRenameTreeItem}
          onDeleteTreeItem={onDeleteTreeItem}
        />
      ) : null}
    </div>
  );
}

interface FileTreeNodeViewProps {
  readonly node: MarkdownFileTreeNode;
  readonly activeFilePath: string | null;
  readonly collapsedPaths: ReadonlySet<string>;
  readonly depth?: number;
  readonly onToggleCollapsed: (path: string) => void;
  readonly onOpenFile: (filePath: string) => void;
  readonly onOpenAsset: (node: MarkdownFileTreeNode) => void;
  readonly onOpenContextMenu: (event: React.MouseEvent, node: MarkdownFileTreeNode) => void;
}

function FileTreeNodeView({
  node,
  activeFilePath,
  collapsedPaths,
  depth = 0,
  onToggleCollapsed,
  onOpenFile,
  onOpenAsset,
  onOpenContextMenu
}: FileTreeNodeViewProps) {
  const paddingLeft = 12 + depth * 14;

  if (node.kind === "markdown" || node.kind === "asset") {
    const isMarkdown = node.kind === "markdown";

    return (
      <button
        type="button"
        className={cx(
          "flex min-h-7 w-full items-center gap-1.5 border-0 bg-transparent text-left text-[13px] leading-[1.35] text-[var(--theme-control-text)] hover:bg-[var(--theme-control-hover)]",
          node.path === activeFilePath && "bg-[var(--theme-primary-soft)] text-[var(--theme-text)]"
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

  return (
    <div>
      <button
        type="button"
        className="flex min-h-7 w-full items-center gap-1.5 border-0 bg-transparent text-left text-[13px] leading-[1.35] text-[var(--theme-muted)] hover:bg-[var(--theme-control-hover)]"
        style={{ paddingLeft }}
        title={node.path}
        aria-expanded={!isCollapsed}
        onClick={() => onToggleCollapsed(node.path)}
        onContextMenu={(event) => onOpenContextMenu(event, node)}
      >
        <span className="inline-flex h-4 w-4 flex-none items-center justify-center text-[var(--theme-muted)]">
          {isCollapsed ? "▸" : "▾"}
        </span>
        <span className="overflow-hidden text-ellipsis whitespace-nowrap">{node.name}</span>
      </button>
      {isCollapsed
        ? null
        : node.children?.map((child) => (
            <FileTreeNodeView
              key={child.path}
              node={child}
              activeFilePath={activeFilePath}
              collapsedPaths={collapsedPaths}
              depth={depth + 1}
              onToggleCollapsed={onToggleCollapsed}
              onOpenFile={onOpenFile}
              onOpenAsset={onOpenAsset}
              onOpenContextMenu={onOpenContextMenu}
            />
          ))}
    </div>
  );
}

function FileKindIcon({ kind }: { readonly kind: "markdown" | "asset" }) {
  const title = kind === "markdown" ? "Markdown 文件" : "图片文件";

  return (
    <span
      className={cx(
        "file-tree-icon inline-flex h-4 w-4 flex-none items-center justify-center text-[var(--theme-muted)]",
        kind === "asset" && "text-[#667085]"
      )}
      title={title}
      aria-label={title}
    >
      {kind === "markdown" ? (
        <svg className="h-[15px] w-[15px]" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M3.5 1.75h6.25l2.75 2.75v9.75H3.5z" />
          <path d="M9.75 1.75V4.5h2.75" />
          <path d="M5.25 10.75V6.25l2 2 2-2v4.5" />
        </svg>
      ) : (
        <svg className="h-[15px] w-[15px]" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M2.75 3.25h10.5v9.5H2.75z" />
          <circle cx="10.75" cy="5.75" r="1" />
          <path d="M4.25 11.25 7 8.5l1.75 1.75 1.25-1.5 1.75 2.5" />
        </svg>
      )}
    </span>
  );
}

interface FileTreeContextMenuProps {
  readonly menu: FileTreeContextMenuState;
  readonly parentPath: string;
  readonly onClose: () => void;
  readonly onCreateTreeItem: (parentPath: string, kind: TreeItemKind) => void;
  readonly onRenameTreeItem: (node: MarkdownFileTreeNode) => void;
  readonly onDeleteTreeItem: (node: MarkdownFileTreeNode) => void;
}

function FileTreeContextMenu({
  menu,
  parentPath,
  onClose,
  onCreateTreeItem,
  onRenameTreeItem,
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
    <Menu>
      <MenuButton
        className="fixed h-px w-px opacity-0"
        style={{ left: menu.x, top: menu.y }}
        aria-label="文件树菜单"
      />
      <MenuItems
        static
        anchor="bottom start"
        className="fixed z-50 min-w-[150px] rounded-md border border-[var(--theme-border)] bg-[var(--theme-surface)] p-1 shadow-[var(--theme-shadow)]"
        style={{ left: menu.x, top: menu.y }}
        onClick={(event) => event.stopPropagation()}
        onContextMenu={(event) => event.preventDefault()}
      >
        <ContextMenuItem onClick={() => run(() => onCreateTreeItem(parentPath, "markdown"))}>
          新建文件
        </ContextMenuItem>
        <ContextMenuItem onClick={() => run(() => onCreateTreeItem(parentPath, "directory"))}>
          新建文件夹
        </ContextMenuItem>
        {menu.node ? (
          <>
            <div className="m-1 h-px bg-[var(--theme-border)]" />
            <ContextMenuItem onClick={() => run(() => onRenameTreeItem(menu.node!))}>
              重命名
            </ContextMenuItem>
            <ContextMenuItem danger onClick={() => run(() => onDeleteTreeItem(menu.node!))}>
              删除
            </ContextMenuItem>
          </>
        ) : null}
      </MenuItems>
    </Menu>
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
    <MenuItem>
      <button
        type="button"
        className={cx(
          "block min-h-7 w-full rounded border-0 bg-transparent px-2 py-1 text-left text-[13px] leading-[1.35] text-[var(--theme-control-text)] hover:bg-[var(--theme-control-hover)] hover:text-[var(--theme-text)] data-focus:bg-[var(--theme-control-hover)] data-focus:text-[var(--theme-text)]",
          danger && "text-[var(--theme-danger-text)]"
        )}
        onClick={onClick}
      >
        {children}
      </button>
    </MenuItem>
  );
}
