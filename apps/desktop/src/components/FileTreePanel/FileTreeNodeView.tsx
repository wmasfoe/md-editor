import { ChevronDownIcon, ChevronRightIcon } from "@heroicons/react/24/outline";
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
            <ChevronRightIcon className="size-2.5 stroke-[2]" aria-hidden="true" />
          ) : (
            <ChevronDownIcon className="size-2.5 stroke-[2]" aria-hidden="true" />
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
