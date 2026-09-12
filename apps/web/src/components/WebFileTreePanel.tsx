import { useState, useMemo, useEffect, useRef, useCallback, type ReactNode } from "react";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  FolderIcon,
  FolderOpenIcon,
  PlusIcon,
  ArrowPathIcon,
} from "@heroicons/react/24/outline";
import {
  type MarkdownFileTreeNode,
  type MarkdownFolder,
  createDefaultCollapsedDirectoryPaths,
  collectAncestorDirectoryPaths,
  readCollapsedPaths,
  writeCollapsedPaths,
  isSameOrChildPath,
  findFirstMarkdownPath,
} from "@md-editor/file-system";
import { FileKindIcon } from "./FileKindIcon";
import { WebFileContextMenu, type ContextMenuPosition } from "./WebFileContextMenu";
import { cx } from "../lib/cx";

export interface WebFileTreePanelProps {
  readonly folder: MarkdownFolder | null;
  readonly activeFilePath: string | null;
  readonly searchQuery: string;
  readonly onOpenFile: (path: string) => void;
  readonly onOpenAsset: (path: string) => void;
  readonly onOpenFolder: () => void;
  readonly onOpenSingleFile: () => void;
  readonly onNewDraft: () => void;
  readonly onRefreshFolder: () => void;
  readonly onCreateItem: (
    parentPath: string,
    name: string,
    kind: "markdown" | "directory",
  ) => Promise<void>;
  readonly onRenameItem: (node: MarkdownFileTreeNode, newName: string) => Promise<void>;
  readonly onDeleteItem: (node: MarkdownFileTreeNode) => Promise<void>;
}

export function WebFileTreePanel({
  folder,
  activeFilePath,
  searchQuery,
  onOpenFile,
  onOpenAsset,
  onOpenFolder,
  onOpenSingleFile,
  onNewDraft,
  onRefreshFolder,
  onCreateItem,
  onRenameItem,
  onDeleteItem,
}: WebFileTreePanelProps) {
  const [collapsedPaths, setCollapsedPaths] = useState<ReadonlySet<string>>(() => new Set());
  const [contextMenu, setContextMenu] = useState<ContextMenuPosition | null>(null);
  const [inlineAction, setInlineAction] = useState<{
    parentPath: string;
    kind: "markdown" | "directory";
    defaultValue?: string;
    isRename?: boolean;
    targetNode?: MarkdownFileTreeNode;
  } | null>(null);
  const [inputVal, setInputVal] = useState("");
  const collapsedRootRef = useRef<string | null>(null);

  // 1. 初始化或切换工作区根目录时，优先恢复本地记忆；无记忆时计算智能默认折叠
  useEffect(() => {
    const nextRootPath = folder?.rootPath ?? null;
    if (collapsedRootRef.current === nextRootPath) {
      return;
    }
    collapsedRootRef.current = nextRootPath;

    if (!folder) {
      setCollapsedPaths(new Set());
      return;
    }

    const stored = readCollapsedPaths(folder.rootPath);
    if (stored) {
      setCollapsedPaths(stored);
      return;
    }

    const targetFile =
      activeFilePath && isSameOrChildPath(activeFilePath, folder.rootPath)
        ? activeFilePath
        : findFirstMarkdownPath(folder.tree);

    const defaultCollapsed = createDefaultCollapsedDirectoryPaths(folder.tree, targetFile);
    setCollapsedPaths(defaultCollapsed);
  }, [folder, activeFilePath]);

  // 2. 外部导航或新建打开深层文件时，自动展开其所有祖先父目录
  useEffect(() => {
    if (!folder || !activeFilePath || !isSameOrChildPath(activeFilePath, folder.rootPath)) {
      return;
    }

    const ancestors = collectAncestorDirectoryPaths(folder.rootPath, activeFilePath);
    setCollapsedPaths((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const p of ancestors) {
        if (next.has(p)) {
          next.delete(p);
          changed = true;
        }
      }
      if (changed) {
        writeCollapsedPaths(folder.rootPath, next);
        return next;
      }
      return prev;
    });
  }, [activeFilePath, folder]);

  // 3. 点击切换目录展开 / 折叠
  const toggleCollapse = useCallback(
    (path: string) => {
      setCollapsedPaths((prev) => {
        const next = new Set(prev);
        if (next.has(path)) {
          next.delete(path);
        } else {
          next.add(path);
        }
        if (folder?.rootPath) {
          writeCollapsedPaths(folder.rootPath, next);
        }
        return next;
      });
    },
    [folder?.rootPath],
  );

  const handleContextMenu = (
    e: React.MouseEvent,
    node: MarkdownFileTreeNode | null,
    parentPath: string,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      node,
      parentPath,
    });
  };

  const submitInlineAction = async () => {
    if (!inlineAction) return;
    const name = inputVal.trim();
    if (name) {
      if (inlineAction.isRename && inlineAction.targetNode) {
        await onRenameItem(inlineAction.targetNode, name);
      } else {
        await onCreateItem(inlineAction.parentPath, name, inlineAction.kind);
      }
    }
    setInlineAction(null);
    setInputVal("");
  };

  // 搜索过滤
  const visibleTree = useMemo(() => {
    if (!folder) return null;
    const q = searchQuery.trim().toLowerCase();
    if (!q) return folder.tree;

    const filter = (node: MarkdownFileTreeNode): MarkdownFileTreeNode | null => {
      if (node.kind !== "directory") {
        return node.name.toLowerCase().includes(q) ? node : null;
      }
      const filteredChildren = (node.children || [])
        .map(filter)
        .filter(Boolean) as MarkdownFileTreeNode[];
      if (filteredChildren.length > 0 || node.name.toLowerCase().includes(q)) {
        return { ...node, children: filteredChildren };
      }
      return null;
    };

    return filter(folder.tree);
  }, [folder, searchQuery]);

  // 未打开文件夹时的欢迎引导卡片
  if (!folder) {
    return (
      <div className="flex h-full flex-col justify-center p-4 text-center">
        <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-2xl bg-[var(--theme-primary-soft)] text-[var(--theme-primary)]">
          <FolderIcon className="size-6 stroke-[1.5]" />
        </div>
        <h3 className="text-sm font-semibold text-[var(--theme-title)]">工作区未加载</h3>
        <p className="mt-1.5 text-xs leading-relaxed text-[var(--theme-muted)]">
          通过浏览器原生文件系统，直接管理本地 Markdown 文档库。无需上传云端，完全本地安全保密。
        </p>
        <div className="mt-5 flex flex-col gap-2">
          <button
            type="button"
            onClick={onOpenFolder}
            className="flex h-8 w-full items-center justify-center gap-1.5 rounded-lg bg-[var(--theme-primary)] px-3 text-xs font-medium text-white shadow-sm transition-all hover:opacity-90 active:scale-98"
          >
            <FolderOpenIcon className="size-4" />
            打开本地文件夹
          </button>
          <button
            type="button"
            onClick={onOpenSingleFile}
            className="flex h-8 w-full items-center justify-center gap-1.5 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-surface)] px-3 text-xs font-medium text-[var(--theme-text)] transition-colors hover:bg-[var(--theme-control-hover)] active:scale-98"
          >
            打开单文件
          </button>
          <button
            type="button"
            onClick={onNewDraft}
            className="flex h-8 w-full items-center justify-center gap-1.5 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-surface)] px-3 text-xs font-medium text-[var(--theme-text)] transition-colors hover:bg-[var(--theme-control-hover)] active:scale-98"
          >
            新建空白草稿
          </button>
        </div>
      </div>
    );
  }

  // 渲染节点
  const renderTree = (node: MarkdownFileTreeNode, depth = 0): ReactNode => {
    const isDir = node.kind === "directory";
    const isCollapsed = collapsedPaths.has(node.path);
    const isActive = activeFilePath === node.path;
    const paddingLeft = 12 + depth * 16;

    if (isDir) {
      const isInlineCreatingHere =
        inlineAction && !inlineAction.isRename && inlineAction.parentPath === node.path;

      return (
        <div key={node.path} className="select-none">
          <div
            className="group flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-2 text-[13px] text-[var(--theme-control-text)] transition-colors hover:bg-[var(--theme-control-hover)] hover:text-[var(--theme-title)]"
            style={{ paddingLeft }}
            onClick={() => toggleCollapse(node.path)}
            onContextMenu={(e) => handleContextMenu(e, node, node.path)}
          >
            <span className="text-[var(--theme-control-subtle)]">
              {isCollapsed ? (
                <ChevronRightIcon className="size-3.5 stroke-[2]" />
              ) : (
                <ChevronDownIcon className="size-3.5 stroke-[2]" />
              )}
            </span>
            <span className="text-[var(--theme-primary)]">
              {isCollapsed ? (
                <FolderIcon className="size-4 stroke-[1.5]" />
              ) : (
                <FolderOpenIcon className="size-4 stroke-[1.5]" />
              )}
            </span>
            <span className="min-w-0 flex-1 truncate font-medium">{node.name}</span>
          </div>

          {/* 子节点 */}
          {!isCollapsed && (
            <div>
              {/* 行内新建输入框 */}
              {isInlineCreatingHere && (
                <div
                  className="flex h-7 items-center px-2"
                  style={{ paddingLeft: paddingLeft + 16 }}
                >
                  <input
                    type="text"
                    autoFocus
                    placeholder={
                      inlineAction.kind === "directory" ? "新文件夹名称" : "新文件名称 (.md)"
                    }
                    value={inputVal}
                    onChange={(e) => setInputVal(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void submitInlineAction();
                      if (e.key === "Escape") setInlineAction(null);
                    }}
                    onBlur={() => void submitInlineAction()}
                    className="h-6 w-full rounded border border-[var(--theme-primary)] bg-[var(--theme-surface)] px-1.5 text-xs text-[var(--theme-title)] shadow-sm outline-none"
                  />
                </div>
              )}

              {(node.children || []).map((child) => renderTree(child, depth + 1))}
            </div>
          )}
        </div>
      );
    }

    // 文件节点
    const isInlineRenaming = inlineAction?.isRename && inlineAction.targetNode?.path === node.path;

    if (isInlineRenaming) {
      return (
        <div
          key={node.path}
          className="flex h-7 items-center px-2"
          style={{ paddingLeft: paddingLeft + 16 }}
        >
          <input
            type="text"
            autoFocus
            value={inputVal}
            onChange={(e) => setInputVal(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submitInlineAction();
              if (e.key === "Escape") setInlineAction(null);
            }}
            onBlur={() => void submitInlineAction()}
            className="h-6 w-full rounded border border-[var(--theme-primary)] bg-[var(--theme-surface)] px-1.5 text-xs text-[var(--theme-title)] shadow-sm outline-none"
          />
        </div>
      );
    }

    return (
      <div
        key={node.path}
        className={cx(
          "group flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-2 text-[13px] transition-colors",
          isActive
            ? "bg-[var(--theme-primary-selected)] font-semibold text-[var(--theme-title)]"
            : "text-[var(--theme-control-text)] hover:bg-[var(--theme-control-hover)] hover:text-[var(--theme-title)]",
        )}
        style={{ paddingLeft: paddingLeft + 16 }}
        onClick={() => {
          if (node.kind === "markdown") {
            onOpenFile(node.path);
          } else if (node.kind === "asset") {
            onOpenAsset(node.path);
          }
        }}
        onContextMenu={(e) => {
          const lastSlash = node.path.lastIndexOf("/");
          const parent = lastSlash >= 0 ? node.path.slice(0, lastSlash) : folder.rootPath;
          handleContextMenu(e, node, parent);
        }}
      >
        <FileKindIcon kind={node.kind} name={node.name} isActive={isActive} />
        <span className="min-w-0 flex-1 truncate">{node.name}</span>
      </div>
    );
  };

  return (
    <div
      className="flex h-full flex-col overflow-y-auto px-1.5 py-1"
      onContextMenu={(e) => handleContextMenu(e, null, folder.rootPath)}
    >
      {/* 根目录信息栏与快捷新建 */}
      <div className="mb-1 flex h-7 items-center justify-between px-2 text-xs font-semibold text-[var(--theme-title)]">
        <span className="truncate">{folder.rootName}</span>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            title="新建文件"
            onClick={() => {
              setInlineAction({ parentPath: folder.rootPath, kind: "markdown" });
              setInputVal("untitled.md");
            }}
            className="flex size-6 items-center justify-center rounded text-[var(--theme-control-text)] hover:bg-[var(--theme-control-hover)] hover:text-[var(--theme-title)]"
          >
            <PlusIcon className="size-3.5" />
          </button>
          <button
            type="button"
            title="重新扫描刷新"
            onClick={onRefreshFolder}
            className="flex size-6 items-center justify-center rounded text-[var(--theme-control-text)] hover:bg-[var(--theme-control-hover)] hover:text-[var(--theme-title)]"
          >
            <ArrowPathIcon className="size-3.5" />
          </button>
        </div>
      </div>

      {/* 树主体 */}
      <div className="flex-1 space-y-0.5">
        {/* 根目录下的行内新建输入框 */}
        {inlineAction && !inlineAction.isRename && inlineAction.parentPath === folder.rootPath && (
          <div className="flex h-7 items-center px-2">
            <input
              type="text"
              autoFocus
              placeholder={inlineAction.kind === "directory" ? "新文件夹名称" : "新文件名称 (.md)"}
              value={inputVal}
              onChange={(e) => setInputVal(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submitInlineAction();
                if (e.key === "Escape") setInlineAction(null);
              }}
              onBlur={() => void submitInlineAction()}
              className="h-6 w-full rounded border border-[var(--theme-primary)] bg-[var(--theme-surface)] px-1.5 text-xs text-[var(--theme-title)] shadow-sm outline-none"
            />
          </div>
        )}

        {visibleTree && (visibleTree.children || []).map((child) => renderTree(child, 0))}
      </div>

      {/* 右键上下文菜单 */}
      {contextMenu && (
        <WebFileContextMenu
          menu={contextMenu}
          onClose={() => setContextMenu(null)}
          onNewFile={(parentPath, isMdx) => {
            if (folder) {
              const ancestors = collectAncestorDirectoryPaths(folder.rootPath, parentPath);
              setCollapsedPaths((prev) => {
                const next = new Set(prev);
                for (const p of ancestors) {
                  next.delete(p);
                }
                writeCollapsedPaths(folder.rootPath, next);
                return next;
              });
            }
            setInlineAction({
              parentPath,
              kind: "markdown",
            });
            setInputVal(isMdx ? "untitled.mdx" : "untitled.md");
          }}
          onNewFolder={(parentPath) => {
            if (folder) {
              const ancestors = collectAncestorDirectoryPaths(folder.rootPath, parentPath);
              setCollapsedPaths((prev) => {
                const next = new Set(prev);
                for (const p of ancestors) {
                  next.delete(p);
                }
                writeCollapsedPaths(folder.rootPath, next);
                return next;
              });
            }
            setInlineAction({
              parentPath,
              kind: "directory",
            });
            setInputVal("new-folder");
          }}
          onRename={(node) => {
            setInlineAction({
              parentPath: "",
              kind: "markdown",
              isRename: true,
              targetNode: node,
            });
            setInputVal(node.name);
          }}
          onDelete={(node) => {
            if (window.confirm(`确认删除「${node.name}」？此操作不可撤销。`)) {
              void onDeleteItem(node);
            }
          }}
          onCopyPath={(node) => {
            void navigator.clipboard.writeText(node.path);
          }}
        />
      )}
    </div>
  );
}
