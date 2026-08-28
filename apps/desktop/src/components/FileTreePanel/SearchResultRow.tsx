import type { MarkdownFileTreeNode } from "@md-editor/file-system";
import { cx } from "../../lib/cx";
import { FileKindIcon } from "./FileKindIcon";
import { relativePathFromRoot } from "./utils";
import type { SearchResultNode } from "./types";

export interface SearchResultRowProps {
  readonly node: SearchResultNode;
  readonly rootPath: string;
  readonly activeFilePath: string | null;
  readonly onOpenFile: (filePath: string) => void;
  readonly onOpenAsset: (node: MarkdownFileTreeNode) => void;
  readonly onOpenContextMenu: (event: React.MouseEvent, node: MarkdownFileTreeNode) => void;
}

export function SearchResultRow({
  node,
  rootPath,
  activeFilePath,
  onOpenFile,
  onOpenAsset,
  onOpenContextMenu,
}: SearchResultRowProps) {
  const isMarkdown = node.kind === "markdown";
  const relativePath = relativePathFromRoot(rootPath, node.path);
  const isActive = node.path === activeFilePath;

  return (
    <div className="relative px-1.5 py-[1px]">
      <button
        type="button"
        className={cx(
          "group relative flex min-h-9 w-full select-none items-center gap-2 rounded-[6px] border-0 bg-transparent px-2.5 py-1.5 text-left text-[13px] leading-[1.3] transition-all duration-120 ease-out focus-visible:outline-none",
          isActive
            ? "bg-[var(--theme-primary-soft)] font-semibold text-[var(--theme-primary)] shadow-2xs"
            : "text-[var(--theme-control-text)] hover:bg-[var(--theme-control-hover)] hover:text-[var(--theme-title)] focus-visible:bg-[var(--theme-control-hover)] focus-visible:text-[var(--theme-title)]",
        )}
        title={node.path}
        onClick={() => (isMarkdown ? onOpenFile(node.path) : onOpenAsset(node))}
        onContextMenu={(event) => onOpenContextMenu(event, node)}
      >
        {isActive && (
          <span
            aria-hidden="true"
            className="absolute left-1 top-2 bottom-2 w-[2.5px] rounded-full bg-[var(--theme-primary)]"
          />
        )}
        <FileKindIcon kind={node.kind} name={node.name} isActive={isActive} />
        <span className="min-w-0 flex-1">
          <span
            className={cx(
              "block overflow-hidden text-ellipsis whitespace-nowrap",
              isActive
                ? "font-semibold text-[var(--theme-primary)]"
                : "font-medium text-[var(--theme-title)]",
            )}
          >
            {node.name}
          </span>
          <span className="block overflow-hidden text-ellipsis whitespace-nowrap text-[11px] font-normal text-[var(--theme-control-subtle)]">
            {relativePath}
          </span>
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
