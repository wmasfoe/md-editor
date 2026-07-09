import type { MarkdownFileTreeNode } from "@md-editor/file-system";
import type { TreeItemKind } from "../../types";

export type EditingState =
  | { mode: "create"; parentPath: string; kind: TreeItemKind; defaultName: string }
  | { mode: "rename"; node: MarkdownFileTreeNode };

export type SearchResultNode = MarkdownFileTreeNode & { kind: "markdown" | "asset" };
