// apps/utools/src/components/UtoolsFileTree.tsx
// uTools 专用轻量文件树侧边栏组件
// 100% 对齐桌面端 (apps/desktop/src/components/FileTreePanel) 的视觉排版、折叠语义与活跃高亮

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import type { MarkdownFileTreeNode, MarkdownFolder } from "@md-editor/file-system";
import {
  ChevronRightIcon,
  CloseIcon,
  FileKindIcon,
  FolderIcon,
  NewFileIcon,
  NewFolderIcon,
  RefreshIcon,
  SearchIcon,
  TrashIcon,
} from "./Icons";

export interface UtoolsFileTreeProps {
  folder: MarkdownFolder | null;
  activeFilePath: string | null;
  onSelectFile: (filePath: string) => void;
  onCreateItem: (parentPath: string, name: string, kind: "markdown" | "directory") => Promise<void>;
  onRenameItem?: (oldPath: string, newName: string) => Promise<void>;
  onDeleteNode: (path: string) => Promise<void>;
  onRefresh: () => void;
  onCloseFolder: () => void;
  onOpenFolder: () => void;
  onToast?: (msg: string) => void;
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, "/");
}

function getDirname(p: string): string {
  const norm = normalizePath(p);
  const lastIndex = norm.lastIndexOf("/");
  if (lastIndex === -1) return norm;
  return norm.slice(0, lastIndex) || "/";
}

function isSameOrChildPath(child: string, parent: string): boolean {
  const normChild = normalizePath(child);
  const normParent = normalizePath(parent);
  return (
    normChild === normParent ||
    normChild.startsWith(normParent.endsWith("/") ? normParent : normParent + "/")
  );
}

function getRelativePath(rootPath: string, targetPath: string): string {
  const normRoot = normalizePath(rootPath);
  const normTarget = normalizePath(targetPath);
  if (normTarget === normRoot) return ".";
  if (normTarget.startsWith(normRoot + "/")) {
    return normTarget.slice(normRoot.length + 1);
  }
  return normTarget;
}

async function copyToClipboard(text: string): Promise<void> {
  if (typeof window !== "undefined" && window.utools?.copyText) {
    window.utools.copyText(text);
    return;
  }
  if (navigator?.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
  }
}

function revealInFinder(targetPath: string): void {
  if (typeof window !== "undefined" && window.utools?.shellShowItemInFolder) {
    window.utools.shellShowItemInFolder(targetPath);
  }
}

const isMac =
  typeof navigator !== "undefined" &&
  (navigator.platform?.toLowerCase().includes("mac") ||
    navigator.userAgent?.toLowerCase().includes("mac"));

function collectAncestorDirectoryPaths(rootPath: string, filePath: string | null): Set<string> {
  const paths = new Set<string>([rootPath]);
  if (!filePath) {
    return paths;
  }

  let current = getDirname(filePath);
  while (isSameOrChildPath(current, rootPath)) {
    paths.add(current);
    if (current === rootPath) {
      break;
    }
    const next = getDirname(current);
    if (next === current) break;
    current = next;
  }

  return paths;
}

function visitDirectoryNodes(
  node: MarkdownFileTreeNode,
  visit: (node: MarkdownFileTreeNode) => void,
) {
  if (node.kind !== "directory") {
    return;
  }

  visit(node);
  for (const child of node.children ?? []) {
    visitDirectoryNodes(child, visit);
  }
}

function createDefaultCollapsedDirectoryPaths(
  root: MarkdownFileTreeNode,
  visibleFilePath: string | null,
): Set<string> {
  const expandedPaths = collectAncestorDirectoryPaths(root.path, visibleFilePath);
  const collapsedPaths = new Set<string>();

  visitDirectoryNodes(root, (node) => {
    if (node.path !== root.path && !expandedPaths.has(node.path)) {
      collapsedPaths.add(node.path);
    }
  });

  return collapsedPaths;
}

/**
 * 苹果风格行内编辑输入框：自动选中主干文件名，支持 Enter 提交与 Escape 撤销
 */
function InlineInput({
  defaultValue,
  paddingLeft,
  onCommit,
  onCancel,
}: {
  defaultValue: string;
  paddingLeft: number;
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    const dotIndex = el.value.lastIndexOf(".");
    el.setSelectionRange(0, dotIndex > 0 ? dotIndex : el.value.length);
  }, []);

  return (
    <div className="flex h-7 min-h-7 items-center pr-2" style={{ paddingLeft }}>
      <input
        ref={inputRef}
        type="text"
        defaultValue={defaultValue}
        className="h-6 w-full min-w-0 rounded-[5px] border border-[var(--theme-primary)] bg-[var(--theme-surface)] px-2 text-[13px] leading-tight text-[var(--theme-title)] shadow-xs ring-2 ring-[var(--theme-primary-soft)] outline-none"
        onBlur={() => onCommit(inputRef.current?.value ?? "")}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onCommit(inputRef.current?.value ?? "");
          } else if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
      />
    </div>
  );
}

function ContextMenuItem({
  children,
  danger = false,
  onClick,
}: {
  children: React.ReactNode;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`flex min-h-7 w-full cursor-pointer select-none items-center rounded-[6px] border-0 bg-transparent px-2.5 py-1 text-left text-xs leading-[1.35] transition-colors duration-100 focus-visible:outline-none ${
        danger
          ? "text-[var(--theme-danger-text)] hover:bg-[var(--theme-danger-bg)] hover:text-[var(--theme-danger-text)]"
          : "text-[var(--theme-control-text)] hover:bg-[var(--theme-control-hover)] hover:text-[var(--theme-title)]"
      }`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function UtoolsFileTree({
  folder,
  activeFilePath,
  onSelectFile,
  onCreateItem,
  onRenameItem,
  onDeleteNode,
  onRefresh,
  onCloseFolder,
  onOpenFolder,
  onToast,
}: UtoolsFileTreeProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [collapsedPaths, setCollapsedPaths] = useState<Set<string>>(() => {
    return folder ? createDefaultCollapsedDirectoryPaths(folder.tree, activeFilePath) : new Set();
  });
  const [creatingParent, setCreatingParent] = useState<{
    path: string;
    kind: "markdown" | "directory";
  } | null>(null);
  const [renamingNode, setRenamingNode] = useState<MarkdownFileTreeNode | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    node: MarkdownFileTreeNode | null;
  } | null>(null);

  // 监听全局点击与 Escape 关闭右键菜单
  useEffect(() => {
    if (!contextMenu) return;
    const handleClose = () => setContextMenu(null);
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setContextMenu(null);
    };
    window.addEventListener("click", handleClose);
    window.addEventListener("contextmenu", handleClose);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("click", handleClose);
      window.removeEventListener("contextmenu", handleClose);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [contextMenu]);

  const lastRootRef = useRef<string | null>(folder?.rootPath ?? null);

  // 当工作区根路径变化，或者首次加载时，初始化折叠状态
  useEffect(() => {
    if (!folder) {
      setCollapsedPaths(new Set());
      lastRootRef.current = null;
      return;
    }
    if (lastRootRef.current !== folder.rootPath) {
      lastRootRef.current = folder.rootPath;
      setCollapsedPaths(createDefaultCollapsedDirectoryPaths(folder.tree, activeFilePath));
    }
  }, [folder, activeFilePath]);

  // 当外部选中文件变动，确保其祖先目录在树上自动展开展示
  useEffect(() => {
    if (activeFilePath && folder && isSameOrChildPath(activeFilePath, folder.rootPath)) {
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
        return changed ? next : prev;
      });
    }
  }, [activeFilePath, folder]);

  const toggleCollapsed = useCallback((path: string) => {
    setCollapsedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const handleStartCreate = useCallback((parentPath: string, kind: "markdown" | "directory") => {
    setCreatingParent({ path: parentPath, kind });
    // 新建时确保父级目录展开
    setCollapsedPaths((prev) => {
      const next = new Set(prev);
      next.delete(parentPath);
      return next;
    });
  }, []);

  const handleConfirmCreate = useCallback(
    async (name: string) => {
      if (!creatingParent || !name.trim()) {
        setCreatingParent(null);
        return;
      }
      try {
        await onCreateItem(creatingParent.path, name.trim(), creatingParent.kind);
      } finally {
        setCreatingParent(null);
      }
    },
    [creatingParent, onCreateItem],
  );

  const filterTree = useCallback(
    (node: MarkdownFileTreeNode, query: string): MarkdownFileTreeNode | null => {
      if (!query) return node;
      const lowerQuery = query.toLowerCase();
      if (node.kind !== "directory") {
        return node.name.toLowerCase().includes(lowerQuery) ? node : null;
      }
      const filteredChildren = (node.children || [])
        .map((child) => filterTree(child, query))
        .filter((c): c is MarkdownFileTreeNode => c !== null);

      if (filteredChildren.length > 0 || node.name.toLowerCase().includes(lowerQuery)) {
        return { ...node, children: filteredChildren };
      }
      return null;
    },
    [],
  );

  const displayTree = useMemo(() => {
    if (!folder) return null;
    if (!searchQuery.trim()) return folder.tree;
    return filterTree(folder.tree, searchQuery.trim());
  }, [filterTree, folder, searchQuery]);

  const renderNode = (node: MarkdownFileTreeNode, depth = 0) => {
    const isDir = node.kind === "directory";
    const isCollapsed = collapsedPaths.has(node.path) && !searchQuery;
    const isActive = activeFilePath === node.path;
    const paddingLeft = 10 + depth * 14;

    // 行内重命名编辑状态
    if (renamingNode?.path === node.path) {
      return (
        <div key={node.path} className="px-1.5 py-[1px]">
          <InlineInput
            defaultValue={node.name}
            paddingLeft={paddingLeft + (isDir ? 22 : 6)}
            onCommit={async (newName) => {
              const trimmed = newName.trim();
              if (trimmed && trimmed !== node.name && onRenameItem) {
                await onRenameItem(node.path, trimmed);
              }
              setRenamingNode(null);
            }}
            onCancel={() => setRenamingNode(null)}
          />
        </div>
      );
    }

    if (!isDir) {
      return (
        <div key={node.path} className="relative px-1.5 py-[1px]">
          <button
            type="button"
            className={`group relative flex h-7 min-h-7 w-full select-none items-center gap-2 rounded-[6px] border-0 bg-transparent pr-2 text-left text-[13px] leading-[1.35] transition-all duration-120 ease-out focus-visible:outline-none cursor-pointer ${
              isActive
                ? "bg-[var(--theme-primary-soft)] font-semibold text-[var(--theme-primary)] shadow-2xs"
                : "text-[var(--theme-control-text)] hover:bg-[var(--theme-control-hover)] hover:text-[var(--theme-title)] focus-visible:bg-[var(--theme-control-hover)] focus-visible:text-[var(--theme-title)]"
            }`}
            style={{ paddingLeft: `${paddingLeft}px` }}
            title={node.path}
            onClick={() => onSelectFile(node.path)}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setContextMenu({ x: e.clientX, y: e.clientY, node });
            }}
          >
            {/* 桌面端经典蓝色左侧激活条 */}
            {isActive && (
              <span
                aria-hidden="true"
                className="absolute left-1 top-1.5 bottom-1.5 w-[2.5px] rounded-full bg-[var(--theme-primary)]"
              />
            )}

            <FileKindIcon kind={node.kind} name={node.name} isActive={isActive} />

            <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
              {node.name}
            </span>

            {/* 桌面端经典活跃蓝点 */}
            {isActive && (
              <span
                aria-hidden="true"
                className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--theme-primary)] opacity-75"
              />
            )}

            {/* 悬停删除快捷按钮 */}
            {node.path !== folder?.rootPath && (
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  if (window.confirm(`确定删除 ${node.name} 吗？`)) {
                    void onDeleteNode(node.path);
                  }
                }}
                title="删除"
                className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-[var(--theme-muted)] hover:text-[var(--theme-danger-text)] hover:bg-[var(--theme-control-active)] transition-opacity"
              >
                <TrashIcon className="size-3.5" />
              </span>
            )}
          </button>
        </div>
      );
    }

    return (
      <div key={node.path}>
        <div className="px-1.5 py-[1px]">
          <button
            type="button"
            className="group flex h-7 min-h-7 w-full select-none items-center gap-1.5 rounded-[6px] border-0 bg-transparent text-left text-[13px] leading-[1.35] text-[var(--theme-control-subtle)] transition-all duration-120 ease-out hover:bg-[var(--theme-control-hover)] hover:text-[var(--theme-title)] focus-visible:bg-[var(--theme-control-hover)] focus-visible:text-[var(--theme-title)] focus-visible:outline-none cursor-pointer"
            style={{ paddingLeft: `${paddingLeft}px` }}
            title={node.path}
            aria-expanded={!isCollapsed}
            onClick={() => toggleCollapsed(node.path)}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setContextMenu({ x: e.clientX, y: e.clientY, node });
            }}
          >
            {/* 平滑 90 度旋转折叠 Chevron */}
            <span
              className={`file-tree-icon inline-flex h-4 w-4 flex-none items-center justify-center text-[var(--theme-control-subtle)] transition-transform duration-150 ease-out ${
                !isCollapsed ? "rotate-90 text-[var(--theme-control-text)]" : ""
              }`}
            >
              <ChevronRightIcon className="size-2.5 stroke-[2.5]" aria-hidden="true" />
            </span>

            {/* 开合状态自适应文件夹图标 */}
            <span className="file-tree-icon inline-flex h-4 w-4 flex-none items-center justify-center text-[var(--theme-control-subtle)] group-hover:text-[var(--theme-control-text)]">
              <FolderIcon isExpanded={!isCollapsed} />
            </span>

            <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap font-medium text-[var(--theme-control-text)] group-hover:text-[var(--theme-title)]">
              {node.name}
            </span>

            {/* 目录悬停快捷操作：新建文件、新建文件夹、删除 */}
            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity ml-auto pr-1">
              <span
                title="新建文件"
                onClick={(e) => {
                  e.stopPropagation();
                  handleStartCreate(node.path, "markdown");
                }}
                className="p-1 rounded text-[var(--theme-muted)] hover:text-[var(--theme-primary)] hover:bg-[var(--theme-control-hover)]"
              >
                <NewFileIcon className="size-3.5" />
              </span>
              <span
                title="新建文件夹"
                onClick={(e) => {
                  e.stopPropagation();
                  handleStartCreate(node.path, "directory");
                }}
                className="p-1 rounded text-[var(--theme-muted)] hover:text-[var(--theme-primary)] hover:bg-[var(--theme-control-hover)]"
              >
                <NewFolderIcon className="size-3.5" />
              </span>
              {node.path !== folder?.rootPath && (
                <span
                  title="删除"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (window.confirm(`确定删除文件夹 ${node.name} 及其全部内容吗？`)) {
                      void onDeleteNode(node.path);
                    }
                  }}
                  className="p-1 rounded text-[var(--theme-muted)] hover:text-[var(--theme-danger-text)] hover:bg-[var(--theme-control-hover)]"
                >
                  <TrashIcon className="size-3.5" />
                </span>
              )}
            </div>
          </button>
        </div>

        {!isCollapsed && (
          <div className="relative">
            {creatingParent?.path === node.path && (
              <InlineInput
                defaultValue={creatingParent.kind === "markdown" ? "untitled.md" : "untitled"}
                paddingLeft={10 + (depth + 1) * 14 + 6}
                onCommit={(name) => void handleConfirmCreate(name)}
                onCancel={() => setCreatingParent(null)}
              />
            )}
            {node.children?.map((child) => renderNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <aside className="w-60 h-full flex flex-col bg-[var(--theme-surface)] border-r border-[var(--theme-border)] shrink-0 overflow-hidden select-none">
      {/* 顶部标题与工作区操作 */}
      <div className="flex h-[38px] items-center justify-between px-3 border-b border-[var(--theme-border)] shrink-0">
        <span className="text-[13px] font-semibold text-[var(--theme-title)] truncate flex items-center gap-1.5">
          <FolderIcon isExpanded={true} className="size-3.5 text-[var(--theme-primary)] shrink-0" />
          <span className="truncate" title={folder?.rootName ?? "工作区"}>
            {folder?.rootName ?? "工作区"}
          </span>
        </span>

        <div className="flex items-center gap-0.5">
          {folder ? (
            <>
              <button
                type="button"
                onClick={onRefresh}
                title="刷新目录"
                className="p-1 rounded-[5px] text-[var(--theme-muted)] hover:text-[var(--theme-text)] hover:bg-[var(--theme-control-hover)] flex items-center justify-center cursor-pointer transition-colors"
              >
                <RefreshIcon className="size-3.5" />
              </button>
              <button
                type="button"
                onClick={onCloseFolder}
                title="关闭工作区"
                className="p-1 rounded-[5px] text-[var(--theme-muted)] hover:text-[var(--theme-danger-text)] hover:bg-[var(--theme-control-hover)] flex items-center justify-center cursor-pointer transition-colors"
              >
                <CloseIcon className="size-3.5" />
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={onOpenFolder}
              className="px-2.5 py-1 bg-[var(--theme-primary)] text-white rounded-[5px] text-xs font-medium cursor-pointer hover:opacity-90 transition-opacity"
            >
              打开
            </button>
          )}
        </div>
      </div>

      {folder ? (
        <>
          {/* 搜索框 */}
          <div className="p-2 border-b border-[var(--theme-border)] shrink-0">
            <div className="flex items-center gap-1.5 px-2 py-1 bg-[var(--theme-control-hover)] border border-[var(--theme-border)] rounded-[6px] focus-within:border-[var(--theme-primary)] focus-within:ring-1 focus-within:ring-[var(--theme-primary-soft)] transition-all">
              <SearchIcon className="size-3.5 text-[var(--theme-muted)] shrink-0" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索当前工作区..."
                className="w-full text-[12px] bg-transparent border-0 text-[var(--theme-text)] placeholder-[var(--theme-muted)] outline-none p-0 leading-tight"
              />
            </div>
          </div>

          {/* 树形列表 */}
          <div
            className="flex-1 overflow-y-auto overflow-x-hidden py-1 file-tree-scrollbar"
            onContextMenu={(e) => {
              e.preventDefault();
              setContextMenu({ x: e.clientX, y: e.clientY, node: null });
            }}
          >
            {displayTree ? (
              renderNode(displayTree, 0)
            ) : (
              <div className="p-4 text-xs text-[var(--theme-muted)] text-center">无匹配文件</div>
            )}
          </div>
        </>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center p-4 text-center text-[var(--theme-muted)] text-xs">
          <p className="mb-3">当前未挂载本地工作区</p>
          <button
            type="button"
            onClick={onOpenFolder}
            className="px-3.5 py-1.5 bg-[var(--theme-primary-soft)] text-[var(--theme-primary)] hover:bg-[var(--theme-primary-selected)] rounded-[6px] font-medium cursor-pointer transition-colors"
          >
            打开本地文件夹
          </button>
        </div>
      )}

      {/* 苹果风格毛玻璃右键上下文菜单 */}
      {contextMenu && folder && (
        <div
          className="fixed z-50 min-w-44 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-surface)]/95 p-1.5 shadow-[0_12px_32px_rgba(20,18,15,0.18),0_0_0_1px_rgba(20,18,15,0.06)] backdrop-blur-xl select-none animate-in fade-in zoom-in-95 duration-100"
          style={{
            left: Math.min(
              contextMenu.x,
              (typeof window !== "undefined" ? window.innerWidth : 800) - 188,
            ),
            top: Math.min(
              contextMenu.y,
              (typeof window !== "undefined" ? window.innerHeight : 600) -
                (contextMenu.node ? 230 : 90),
            ),
          }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <ContextMenuItem
            onClick={() => {
              const targetParent = contextMenu.node
                ? contextMenu.node.kind === "directory"
                  ? contextMenu.node.path
                  : getDirname(contextMenu.node.path)
                : folder.rootPath;
              handleStartCreate(targetParent, "markdown");
              setContextMenu(null);
            }}
          >
            新建文件
          </ContextMenuItem>
          <ContextMenuItem
            onClick={() => {
              const targetParent = contextMenu.node
                ? contextMenu.node.kind === "directory"
                  ? contextMenu.node.path
                  : getDirname(contextMenu.node.path)
                : folder.rootPath;
              handleStartCreate(targetParent, "directory");
              setContextMenu(null);
            }}
          >
            新建文件夹
          </ContextMenuItem>

          {contextMenu.node && (
            <>
              <div className="my-1 h-px bg-[var(--theme-border)]/60" />
              <ContextMenuItem
                onClick={() => {
                  const node = contextMenu.node!;
                  const rel = getRelativePath(folder.rootPath, node.path);
                  void copyToClipboard(rel);
                  onToast?.("已复制相对路径");
                  setContextMenu(null);
                }}
              >
                复制相对路径
              </ContextMenuItem>
              <ContextMenuItem
                onClick={() => {
                  const node = contextMenu.node!;
                  void copyToClipboard(node.path);
                  onToast?.("已复制绝对路径");
                  setContextMenu(null);
                }}
              >
                复制绝对路径
              </ContextMenuItem>
              <ContextMenuItem
                onClick={() => {
                  const node = contextMenu.node!;
                  revealInFinder(node.path);
                  setContextMenu(null);
                }}
              >
                {isMac ? "在访达中显示" : "在文件资源管理器中显示"}
              </ContextMenuItem>

              {contextMenu.node.path !== folder.rootPath && (
                <>
                  <div className="my-1 h-px bg-[var(--theme-border)]/60" />
                  <ContextMenuItem
                    onClick={() => {
                      const node = contextMenu.node!;
                      setContextMenu(null);
                      setRenamingNode(node);
                    }}
                  >
                    重命名
                  </ContextMenuItem>
                  <ContextMenuItem
                    danger
                    onClick={() => {
                      const node = contextMenu.node!;
                      setContextMenu(null);
                      const isFolder = node.kind === "directory";
                      const prompt = isFolder
                        ? `确定删除文件夹 "${node.name}" 及其全部内容吗？`
                        : `确定删除文件 "${node.name}" 吗？`;
                      if (window.confirm(prompt)) {
                        void onDeleteNode(node.path);
                      }
                    }}
                  >
                    删除
                  </ContextMenuItem>
                </>
              )}
            </>
          )}
        </div>
      )}
    </aside>
  );
}
