import { describe, expect, it, vi } from "vitest";
import { useFileTreeStore } from "../src/app/stores/file-tree-store";
import { listenToFolderChanged, FOLDER_CHANGED_EVENT } from "../src/desktop/folder-watcher-events";
import { watchFolder, unwatchFolder } from "../src/desktop/file-adapter";
import type { RuntimeFileService, MarkdownFolder } from "@md-editor/file-system";

describe("folder watcher and tree sync", () => {
  it("gracefully handles watchFolder and unwatchFolder in non-Tauri environment", async () => {
    await expect(watchFolder("/test/path")).resolves.toBeUndefined();
    await expect(unwatchFolder()).resolves.toBeUndefined();
  });

  it("returns undefined for listenToFolderChanged outside Tauri", () => {
    const cleanup = listenToFolderChanged(() => {});
    expect(cleanup).toBeUndefined();
    expect(FOLDER_CHANGED_EVENT).toBe("md-editor-folder-changed");
  });

  it("refreshes opened folder even without active document", async () => {
    const mockFolder: MarkdownFolder = {
      rootName: "notes",
      rootPath: "/workspace/notes",
      tree: {
        name: "notes",
        path: "/workspace/notes",
        kind: "directory",
        children: [{ name: "intro.md", path: "/workspace/notes/intro.md", kind: "markdown" }],
      },
    };

    const refreshedFolder: MarkdownFolder = {
      ...mockFolder,
      tree: {
        ...mockFolder.tree,
        children: [
          { name: "intro.md", path: "/workspace/notes/intro.md", kind: "markdown" },
          { name: "imgs", path: "/workspace/notes/imgs", kind: "directory", children: [] },
        ],
      },
    };

    useFileTreeStore.setState({ folder: mockFolder });

    const fileService: Partial<RuntimeFileService> = {
      refreshFolder: vi.fn(async (_rootPath) => refreshedFolder),
    };

    await useFileTreeStore.getState().refreshOpenedFolder(fileService as RuntimeFileService);

    expect(fileService.refreshFolder).toHaveBeenCalledWith("/workspace/notes");
    expect(useFileTreeStore.getState().folder?.tree.children?.length).toBe(2);
  });
});
