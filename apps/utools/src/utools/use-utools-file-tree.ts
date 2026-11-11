import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { DocumentState } from "@md-editor/core";
import { resolveReplaceIntent } from "@md-editor/core";
import type { MarkdownFileTreeNode, MarkdownFolder } from "@md-editor/file-system";
import { saveLastOpenedFile, saveLastOpenedFolder } from "./db-storage";
import type { EditorMode } from "./types";

export function findFirstMarkdown(node: MarkdownFileTreeNode): MarkdownFileTreeNode | null {
  if (node.kind === "markdown") return node;
  if (node.kind === "directory" && node.children) {
    const readme = node.children.find((c) => c.kind === "markdown" && /^readme\.md$/i.test(c.name));
    if (readme) return readme;
    for (const child of node.children) {
      const found = findFirstMarkdown(child);
      if (found) return found;
    }
  }
  return null;
}

export interface UseUtoolsFileTreeOptions {
  readonly docState: DocumentState;
  readonly setMode: Dispatch<SetStateAction<EditorMode>>;
  readonly setIsSidebarOpen: Dispatch<SetStateAction<boolean>>;
  readonly showToast: (msg: string | null) => void;
  readonly onNewFile: () => void;
}

export function useUtoolsFileTree({
  docState,
  setMode,
  setIsSidebarOpen,
  showToast,
  onNewFile,
}: UseUtoolsFileTreeOptions) {
  const [folder, setFolder] = useState<MarkdownFolder | null>(null);
  const folderRef = useRef(folder);
  folderRef.current = folder;

  const handleSelectTreeFile = useCallback(
    (path: string) => {
      if (path === docState.getSnapshot().filePath) return;
      const current = docState.getSnapshot();
      if (current.filePath && current.isDirty && window.inkpointNodeBridge) {
        try {
          window.inkpointNodeBridge.writeFile(current.filePath, current.markdown);
        } catch (err) {
          console.error("保存旧文件失败:", err);
        }
      }
      if (window.inkpointNodeBridge) {
        try {
          const content = window.inkpointNodeBridge.readFile(path);
          docState.replaceDocument(
            {
              markdown: content,
              savedMarkdown: content,
              filePath: path,
              mode: docState.getSnapshot().mode,
            },
            { kind: "command", commandId: "utools.selectTreeFile" },
          );
          setMode("file");
          saveLastOpenedFile(path);
        } catch (err) {
          showToast(`读取失败: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    },
    [docState, setMode, showToast],
  );

  const handleCreateTreeItem = useCallback(
    async (parentPath: string, name: string, kind: "markdown" | "directory") => {
      if (!folder || !window.inkpointNodeBridge) return;
      try {
        const createdPath = window.inkpointNodeBridge.createTreeItem(parentPath, name, kind);
        const updated = window.inkpointNodeBridge.scanFolder(folder.rootPath);
        setFolder(updated);
        if (kind === "markdown") {
          handleSelectTreeFile(createdPath);
        }
      } catch (err) {
        showToast(`创建失败: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [folder, handleSelectTreeFile, showToast],
  );

  const handleDeleteTreeNode = useCallback(
    async (path: string) => {
      if (!folder || !window.inkpointNodeBridge) return;
      try {
        window.inkpointNodeBridge.deleteTreeItem(path);
        const updated = window.inkpointNodeBridge.scanFolder(folder.rootPath);
        setFolder(updated);
        const currentSnap = docState.getSnapshot();
        if (
          currentSnap.filePath === path ||
          (currentSnap.filePath && currentSnap.filePath.startsWith(path + "/"))
        ) {
          onNewFile();
        }
      } catch (err) {
        showToast(`删除失败: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [docState, folder, onNewFile, showToast],
  );

  const handleRenameTreeItem = useCallback(
    async (oldPath: string, newName: string) => {
      if (!folder || !window.inkpointNodeBridge) return;
      try {
        const newPath = window.inkpointNodeBridge.renameTreeItem(oldPath, newName);
        const updated = window.inkpointNodeBridge.scanFolder(folder.rootPath);
        setFolder(updated);
        const currentSnap = docState.getSnapshot();
        if (currentSnap.filePath === oldPath) {
          docState.setDocumentPath({
            filePath: newPath,
            expectedGeneration: currentSnap.documentGeneration,
            expectedStateRevision: currentSnap.stateRevision,
            origin: { kind: "command", commandId: "file.rename" },
          });
          saveLastOpenedFile(newPath);
        } else if (currentSnap.filePath && currentSnap.filePath.startsWith(oldPath + "/")) {
          const newDocPath = newPath + currentSnap.filePath.slice(oldPath.length);
          docState.setDocumentPath({
            filePath: newDocPath,
            expectedGeneration: currentSnap.documentGeneration,
            expectedStateRevision: currentSnap.stateRevision,
            origin: { kind: "command", commandId: "file.rename" },
          });
          saveLastOpenedFile(newDocPath);
        }
      } catch (err) {
        showToast(`重命名失败: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [docState, folder, showToast],
  );

  const handleRefreshFolder = useCallback(() => {
    if (!folder || !window.inkpointNodeBridge) return;
    try {
      const updated = window.inkpointNodeBridge.scanFolder(folder.rootPath);
      setFolder(updated);
    } catch (err) {
      showToast(`刷新失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [folder, showToast]);

  const handleOpenFile = useCallback(() => {
    if (typeof window === "undefined" || typeof window.utools === "undefined") {
      showToast("当前环境不支持文件选择器");
      return;
    }
    const paths = window.utools.showOpenDialog({
      filters: [{ name: "Markdown", extensions: ["md", "markdown", "mdx", "txt"] }],
      properties: ["openFile"],
    });
    if (!paths || paths.length === 0) {
      return;
    }
    const targetPath = paths[0];
    if (window.inkpointNodeBridge) {
      try {
        const content = window.inkpointNodeBridge.readFile(targetPath);
        docState.replaceDocument(
          {
            markdown: content,
            savedMarkdown: content,
            filePath: targetPath,
            mode: docState.getSnapshot().mode,
            replaceIntent: resolveReplaceIntent(docState.getSnapshot().filePath, targetPath),
          },
          { kind: "command", commandId: "utools.openFilePicker" },
        );
        setMode("file");

        const parentDir = window.inkpointNodeBridge.getDirname(targetPath);
        if (parentDir && window.inkpointNodeBridge.isDirectory(parentDir)) {
          try {
            const scanned = window.inkpointNodeBridge.scanFolder(parentDir);
            setFolder(scanned);
            setIsSidebarOpen(true);
          } catch {
            // 忽略
          }
        }
      } catch (err) {
        showToast(`读取失败: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }, [docState, setIsSidebarOpen, setMode, showToast]);

  const handleOpenFolder = useCallback(() => {
    if (typeof window === "undefined" || typeof window.utools === "undefined") {
      showToast("当前环境不支持选择文件夹");
      return;
    }
    const paths = window.utools.showOpenDialog({
      properties: ["openDirectory"],
    });
    if (!paths || paths.length === 0) return;
    const targetDir = paths[0];
    if (window.inkpointNodeBridge) {
      try {
        const scanned = window.inkpointNodeBridge.scanFolder(targetDir);
        setFolder(scanned);
        setIsSidebarOpen(true);
        setMode("file");
        saveLastOpenedFolder(targetDir);

        const firstMd = findFirstMarkdown(scanned.tree);
        if (firstMd) {
          const content = window.inkpointNodeBridge.readFile(firstMd.path);
          docState.replaceDocument(
            {
              markdown: content,
              savedMarkdown: content,
              filePath: firstMd.path,
              mode: docState.getSnapshot().mode,
              replaceIntent: resolveReplaceIntent(docState.getSnapshot().filePath, firstMd.path),
            },
            { kind: "command", commandId: "utools.openFolderPicker" },
          );
        }
      } catch (err) {
        showToast(`打开失败: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }, [docState, setIsSidebarOpen, setMode, showToast]);

  return {
    folder,
    setFolder,
    folderRef,
    handleSelectTreeFile,
    handleCreateTreeItem,
    handleDeleteTreeNode,
    handleRenameTreeItem,
    handleRefreshFolder,
    handleOpenFile,
    handleOpenFolder,
  };
}
