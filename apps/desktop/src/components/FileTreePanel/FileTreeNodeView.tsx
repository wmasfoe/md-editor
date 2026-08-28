import { ChevronRightIcon } from "@heroicons/react/24/outline";
import type { MarkdownFileTreeNode } from "@md-editor/file-system";
import { cx } from "../../lib/cx";
import { FileKindIcon } from "./FileKindIcon";
import { InlineInput } from "./InlineInput";
import type { EditingState } from "./types";

export interface FileTreeNodeViewProps {
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

/**
 * 现代 Apple HIG 风格文件树节点视图：
 * 1. 浮动胶囊排版 (Floating Pill Row)：内凹 6px 圆角，避免直贴侧栏边缘；
 * 2. 文件夹旋转折叠动效：单 Chevron 三角平滑 90° 旋转与开合文件夹图标切换；
 * 3. 悬停与选中状态：120ms 阻尼微高光过渡与深浅主题自适应；
 * 4. 树状层级引导线：在嵌套目录提供微弱半透引导线。
 */
export function FileTreeNodeView({
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
  onCancelEdit,
}: FileTreeNodeViewProps) {
  const paddingLeft = 10 + depth * 14;
  const isRenaming = editing?.mode === "rename" && editing.node.path === node.path;

  if (node.kind === "markdown" || node.kind === "asset") {
    const isMarkdown = node.kind === "markdown";
    const isActive = node.path === activeFilePath;

    if (isRenaming) {
      return (
        <InlineInput
          defaultValue={node.name}
          paddingLeft={paddingLeft + 6}
          onCommit={onCommitEdit}
          onCancel={onCancelEdit}
        />
      );
    }

    return (
      <div className="relative px-1.5 py-[1px]">
        <button
          type="button"
          className={cx(
            "group relative flex h-7 min-h-7 w-full select-none items-center gap-2 rounded-[6px] border-0 bg-transparent pr-2 text-left text-[13px] leading-[1.35] transition-all duration-120 ease-out focus-visible:outline-none",
            isActive
              ? "bg-[var(--theme-primary-soft)] font-semibold text-[var(--theme-primary)] shadow-2xs"
              : "text-[var(--theme-control-text)] hover:bg-[var(--theme-control-hover)] hover:text-[var(--theme-title)] focus-visible:bg-[var(--theme-control-hover)] focus-visible:text-[var(--theme-title)]",
          )}
          style={{ paddingLeft }}
          title={node.path}
          onClick={() => (isMarkdown ? onOpenFile(node.path) : onOpenAsset(node))}
          onContextMenu={(event) => onOpenContextMenu(event, node)}
        >
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
          {isActive && (
            <span
              aria-hidden="true"
              className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--theme-primary)] opacity-75"
            />
          )}
        </button>
      </div>
    );
  }

  const isCollapsed = collapsedPaths.has(node.path);
  const isCreatingInside = editing?.mode === "create" && editing.parentPath === node.path;

  if (isRenaming) {
    return (
      <div className="px-1.5 py-[1px]">
        <InlineInput
          defaultValue={node.name}
          paddingLeft={paddingLeft + 6}
          onCommit={onCommitEdit}
          onCancel={onCancelEdit}
        />
      </div>
    );
  }

  return (
    <div>
      <div className="px-1.5 py-[1px]">
        <button
          type="button"
          className="group flex h-7 min-h-7 w-full select-none items-center gap-1.5 rounded-[6px] border-0 bg-transparent text-left text-[13px] leading-[1.35] text-[var(--theme-control-subtle)] transition-all duration-120 ease-out hover:bg-[var(--theme-control-hover)] hover:text-[var(--theme-title)] focus-visible:bg-[var(--theme-control-hover)] focus-visible:text-[var(--theme-title)] focus-visible:outline-none"
          style={{ paddingLeft }}
          title={node.path}
          aria-expanded={!isCollapsed}
          onClick={() => onToggleCollapsed(node.path)}
          onContextMenu={(event) => onOpenContextMenu(event, node)}
        >
          <span
            className={cx(
              "file-tree-icon inline-flex h-4 w-4 flex-none items-center justify-center text-[var(--theme-control-subtle)] transition-transform duration-150 ease-out",
              !isCollapsed && "rotate-90 text-[var(--theme-control-text)]",
            )}
          >
            <ChevronRightIcon className="size-2.5 stroke-[2.5]" aria-hidden="true" />
          </span>

          <span className="file-tree-icon inline-flex h-4 w-4 flex-none items-center justify-center text-[var(--theme-control-subtle)] group-hover:text-[var(--theme-control-text)]">
            <FolderNodeIcon isCollapsed={isCollapsed} />
          </span>

          <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap font-medium text-[var(--theme-control-text)] group-hover:text-[var(--theme-title)]">
            {node.name}
          </span>
        </button>
      </div>

      {!isCollapsed && (
        <div className="relative">
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
            <div className="px-1.5 py-[1px]">
              <InlineInput
                defaultValue={editing.defaultName}
                paddingLeft={10 + (depth + 1) * 14 + 6}
                onCommit={onCommitEdit}
                onCancel={onCancelEdit}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * 苹果 macOS 质感文件夹图标（Finder 经典标签页外形）
 */
function FolderNodeIcon({ isCollapsed }: { isCollapsed: boolean }) {
  return (
    <svg viewBox="0 0 16 16" className="size-3.5 shrink-0" fill="none" aria-hidden="true">
      <path
        d="M2 3.75A1.25 1.25 0 0 1 3.25 2.5h2.4a1.25 1.25 0 0 1 .88.37l1.1 1.13h5.12A1.25 1.25 0 0 1 14 5.25v7.5A1.25 1.25 0 0 1 12.75 14H3.25A1.25 1.25 0 0 1 2 12.75v-9Z"
        className="fill-[var(--theme-control-hover)] stroke-current stroke-[1.15]"
      />
      {!isCollapsed ? (
        <path
          d="M1.75 6.5h12.5l-1.2 6.2a1 1 0 0 1-.98.8H3.93a1 1 0 0 1-.98-.8L1.75 6.5Z"
          className="fill-[var(--theme-surface)] stroke-current stroke-[1.15]"
        />
      ) : (
        <path
          d="M2 5.5h12"
          className="stroke-current stroke-[1.15]"
        />
      )}
    </svg>
  );
}
