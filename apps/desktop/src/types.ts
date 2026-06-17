import type { MarkdownFileTreeNode } from "@md-editor/file-system";

export type SidebarMode = "files" | "outline";
export type TreeItemKind = "markdown" | "directory";
export type OpenedAsset = Pick<MarkdownFileTreeNode, "name" | "path">;

export interface FileTreeContextMenuState {
  readonly x: number;
  readonly y: number;
  readonly node: MarkdownFileTreeNode | null;
}

export interface PastedImageInput {
  readonly file: File;
  readonly mimeType: string;
}

export interface PastedImageFile {
  readonly markdownPath: string;
}

export interface KeyboardShortcut {
  readonly matches: (event: KeyboardEvent) => boolean;
  readonly run: (event: KeyboardEvent) => void;
}
