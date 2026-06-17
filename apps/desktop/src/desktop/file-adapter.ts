import { invoke, isTauri } from "@tauri-apps/api/core";
import type {
  FileServiceAdapter,
  FileTreeMutationResult,
  MarkdownDocumentFile,
  MarkdownFolder,
  SaveMarkdownInput
} from "@md-editor/file-system";
import type { PastedImageFile, PastedImageInput } from "../types";

export function createDesktopFileAdapter(): FileServiceAdapter {
  return {
    openMarkdownFile() {
      assertDesktopRuntime();
      return invoke<MarkdownDocumentFile | null>("open_markdown_document");
    },
    openMarkdownFolder() {
      assertDesktopRuntime();
      return invoke<MarkdownFolder | null>("open_markdown_folder");
    },
    readMarkdownFile(path) {
      assertDesktopRuntime();
      return invoke<MarkdownDocumentFile>("open_markdown_document_at_path", { path });
    },
    saveMarkdownFile(input: SaveMarkdownInput) {
      assertDesktopRuntime();
      return invoke<MarkdownDocumentFile | null>("save_markdown_document", {
        filePath: input.filePath,
        markdown: input.markdown,
        forceDialog: input.forceDialog ?? false
      });
    },
    refreshMarkdownFolder(rootPath) {
      assertDesktopRuntime();
      return invoke<MarkdownFolder>("refresh_markdown_folder", { rootPath });
    },
    createMarkdownTreeItem(input) {
      assertDesktopRuntime();
      return invoke<FileTreeMutationResult>("create_markdown_tree_item", {
        rootPath: input.rootPath,
        parentPath: input.parentPath,
        name: input.name,
        kind: input.kind
      });
    },
    renameMarkdownTreeItem(input) {
      assertDesktopRuntime();
      return invoke<FileTreeMutationResult>("rename_markdown_tree_item", {
        rootPath: input.rootPath,
        path: input.path,
        name: input.name
      });
    },
    deleteMarkdownTreeItem(input) {
      assertDesktopRuntime();
      return invoke<FileTreeMutationResult>("delete_markdown_tree_item", {
        rootPath: input.rootPath,
        path: input.path
      });
    }
  };
}

export async function savePastedImage(
  documentPath: string,
  image: PastedImageInput
): Promise<PastedImageFile> {
  assertDesktopRuntime();
  return invoke<PastedImageFile>("save_pasted_image", {
    documentPath,
    mimeType: image.mimeType,
    bytes: Array.from(new Uint8Array(await image.file.arrayBuffer()))
  });
}

export function assertDesktopRuntime() {
  if (!isTauri()) {
    throw new Error("File operations are available in the Tauri desktop app.");
  }
}
