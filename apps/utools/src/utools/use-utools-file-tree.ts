import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { DocumentState } from "@md-editor/core";
import { resolveReplaceIntent } from "@md-editor/core";
import type { MarkdownFileTreeNode, MarkdownFolder } from "@md-editor/file-system";
import { fileAccess, movedPath } from "./file-access";
import type { EditorMode, GrantedDocument } from "./types";

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
}

export function useUtoolsFileTree({
  docState,
  setMode,
  setIsSidebarOpen,
  showToast,
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
          fileAccess.saveMarkdown(current.filePath, current.markdown);
        } catch (err) {
          showToast(`保存失败: ${err instanceof Error ? err.message : String(err)}`);
          return;
        }
      }
      if (window.inkpointNodeBridge) {
        try {
          const content = fileAccess.openWorkspaceDocument(path).markdown;
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
        const createdPath = fileAccess.createTreeItem(parentPath, name, kind);
        const updated = fileAccess.refreshWorkspace(folder.rootPath);
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
        fileAccess.deleteTreeItem(path);
        const currentSnap = docState.getSnapshot();
        if (currentSnap.filePath && movedPath(currentSnap.filePath, path, path)) {
          docState.replaceDocument(
            {
              markdown: "",
              savedMarkdown: "",
              filePath: null,
              mode: currentSnap.mode,
              replaceIntent: resolveReplaceIntent(currentSnap.filePath, null),
            },
            { kind: "command", commandId: "utools.deleteTreeItem" },
          );
        }
        setFolder(fileAccess.refreshWorkspace(folder.rootPath));
      } catch (err) {
        showToast(`删除失败: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [docState, folder, showToast],
  );

  const handleRenameTreeItem = useCallback(
    async (oldPath: string, newName: string) => {
      if (!folder || !window.inkpointNodeBridge) return;
      try {
        const newPath = fileAccess.renameTreeItem(oldPath, newName);
        const currentSnap = docState.getSnapshot();
        const newDocPath =
          currentSnap.filePath && movedPath(currentSnap.filePath, oldPath, newPath);
        if (newDocPath) {
          docState.setDocumentPath({
            filePath: newDocPath,
            expectedGeneration: currentSnap.documentGeneration,
            expectedStateRevision: currentSnap.stateRevision,
            origin: { kind: "command", commandId: "file.rename" },
          });
        }
        setFolder(fileAccess.refreshWorkspace(folder.rootPath));
      } catch (err) {
        showToast(`重命名失败: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [docState, folder, showToast],
  );

  const handleRefreshFolder = useCallback(() => {
    if (!folder || !window.inkpointNodeBridge) return;
    try {
      const updated = fileAccess.refreshWorkspace(folder.rootPath);
      setFolder(updated);
    } catch (err) {
      showToast(`刷新失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [folder, showToast]);

  const showDocument = useCallback(
    (opened: GrantedDocument) => {
      const current = docState.getSnapshot();
      docState.replaceDocument(
        {
          markdown: opened.markdown,
          savedMarkdown: opened.markdown,
          filePath: opened.filePath,
          mode: current.mode,
          replaceIntent: resolveReplaceIntent(current.filePath, opened.filePath),
        },
        { kind: "command", commandId: "utools.openDocument" },
      );
      setMode("file");
    },
    [docState, setMode],
  );

  const showWorkspace = useCallback(
    (opened: MarkdownFolder) => {
      setFolder(opened);
      setIsSidebarOpen(true);
      const first = findFirstMarkdown(opened.tree);
      if (first) showDocument(fileAccess.openWorkspaceDocument(first.path));
    },
    [setIsSidebarOpen, showDocument],
  );

  const saveBeforeOpen = useCallback(() => {
    const current = docState.getSnapshot();
    if (current.filePath && current.isDirty)
      fileAccess.saveMarkdown(current.filePath, current.markdown);
  }, [docState]);

  const handleOpenFile = useCallback(() => {
    try {
      saveBeforeOpen();
      const opened = fileAccess.pickDocument();
      if (opened) showDocument(opened);
    } catch (err) {
      showToast(`打开失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [saveBeforeOpen, showDocument, showToast]);

  const handleOpenFolder = useCallback(() => {
    try {
      saveBeforeOpen();
      const opened = fileAccess.pickWorkspace();
      if (opened) showWorkspace(opened);
    } catch (err) {
      showToast(`打开失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [saveBeforeOpen, showWorkspace, showToast]);

  return {
    folder,
    setFolder,
    folderRef,
    handleSelectTreeFile,
    handleCreateTreeItem,
    handleDeleteTreeNode,
    handleRenameTreeItem,
    handleRefreshFolder,
    showDocument,
    showWorkspace,
    handleOpenFile,
    handleOpenFolder,
  };
}
