// Translate editor display paths to the session IDs issued by preload.
import type { GrantedDocument, GrantedFolder, GrantedTreeNode, PluginEntry } from "./types";

let document: Pick<GrantedDocument, "filePath" | "id"> | null = null;
let workspace: GrantedFolder | null = null;

function bridge() {
  if (!window.inkpointNodeBridge) throw new Error("uTools 原生文件访问不可用");
  return window.inkpointNodeBridge;
}

function rememberDocument(opened: GrantedDocument | null) {
  if (opened) document = { filePath: opened.filePath, id: opened.id };
  return opened;
}

function findNode(node: GrantedTreeNode, target: string): GrantedTreeNode | undefined {
  if (node.path === target) return node;
  for (const child of node.children ?? []) {
    const found = findNode(child, target);
    if (found) return found;
  }
}

function nodeId(target: string) {
  const node = workspace && findNode(workspace.tree, target);
  if (!node) throw new Error("工作区项目已变化，请刷新后重试");
  return node.id;
}

function documentId(filePath: string) {
  if (!document || document.filePath !== filePath) throw new Error("文档已切换，请重试");
  return document.id;
}

export const fileAccess = {
  subscribeLifecycle(onEnter: (entry: PluginEntry) => void, onOut: () => void) {
    return window.inkpointNodeBridge?.subscribeLifecycle((entry) => {
      if (entry.document) rememberDocument(entry.document);
      if (entry.folder) workspace = entry.folder;
      onEnter(entry);
    }, onOut);
  },
  pickDocument() {
    return rememberDocument(bridge().pickDocument());
  },
  pickWorkspace() {
    const selected = bridge().pickWorkspace();
    if (selected) workspace = selected;
    return selected;
  },
  openWorkspaceDocument(filePath: string) {
    const opened = bridge().openWorkspaceDocument(nodeId(filePath));
    rememberDocument(opened);
    return opened;
  },
  saveMarkdown(filePath: string | null, markdown: string) {
    if (filePath !== null) return bridge().writeCurrentDocument(documentId(filePath), markdown);
    const saved = bridge().saveNewDocument(markdown);
    if (saved) document = saved;
    return saved?.filePath ?? null;
  },
  insertImage(filePath: string, mime: string, buffer: ArrayBuffer) {
    return bridge().saveDocumentImage(documentId(filePath), mime, buffer);
  },
  resolveImage(filePath: string | null, src: string) {
    if (/^(https?:\/\/|data:image\/)/iu.test(src)) return src;
    const id = document && document.filePath === filePath ? document.id : null;
    return (
      window.inkpointNodeBridge?.resolveDocumentImage(id, src) ??
      "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"
    );
  },
  closeDocument() {
    window.inkpointNodeBridge?.closeDocument();
    document = null;
  },
  closeWorkspace() {
    window.inkpointNodeBridge?.closeWorkspace();
    workspace = null;
  },
  refreshWorkspace(rootPath: string) {
    if (workspace?.rootPath !== rootPath) throw new Error("工作区已切换，请重试");
    workspace = bridge().refreshWorkspace();
    return workspace;
  },
  createTreeItem(parentPath: string, name: string, kind: "markdown" | "directory") {
    return bridge().createWorkspaceItem(nodeId(parentPath), name, kind);
  },
  renameTreeItem(oldPath: string, name: string) {
    const newPath = bridge().renameWorkspaceItem(nodeId(oldPath), name);
    const currentPath = document?.filePath;
    if (document && currentPath)
      document = { ...document, filePath: movedPath(currentPath, oldPath, newPath) ?? currentPath };
    return newPath;
  },
  deleteTreeItem(path: string) {
    bridge().deleteWorkspaceItem(nodeId(path));
    if (document && movedPath(document.filePath, path, path)) document = null;
  },
};

export function movedPath(filePath: string, source: string, destination: string) {
  if (filePath === source) return destination;
  const separator = /^[a-z]:[\\/]|^\\\\/iu.test(source) ? "\\" : "/";
  if (filePath.startsWith(source + separator)) return destination + filePath.slice(source.length);
  return null;
}
