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

  return (
    <button
      type="button"
      className={cx(
        "flex min-h-9 w-full items-center gap-2 border-0 bg-transparent px-3 py-1 text-left text-[13px] leading-[1.3] text-[var(--theme-control-text)] transition-colors duration-150 ease-out hover:bg-[var(--theme-control-hover)] hover:text-[var(--theme-title)] focus-visible:bg-[var(--theme-control-hover)] focus-visible:text-[var(--theme-title)] focus-visible:outline-none",
        node.path === activeFilePath &&
          "bg-[var(--theme-control-active)] font-[560] text-[var(--theme-title)]",
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
