import { invoke, isTauri } from "@tauri-apps/api/core";
import { listenToDesktopMenuActions } from "./menu-events";

export const FILE_TREE_CONTEXT_MENU_ACTION = {
  newMarkdown: "new-markdown",
  newMdx: "new-mdx",
  newFolder: "new-folder",
  copyRelativePath: "copy-relative-path",
  copyAbsolutePath: "copy-absolute-path",
  revealInFinder: "reveal-in-finder",
  rename: "rename",
  delete: "delete",
} as const;

export type FileTreeContextMenuAction =
  (typeof FILE_TREE_CONTEXT_MENU_ACTION)[keyof typeof FILE_TREE_CONTEXT_MENU_ACTION];

const FILE_TREE_CONTEXT_MENU_ACTIONS = Object.values(FILE_TREE_CONTEXT_MENU_ACTION);

export const FILE_TREE_MENU_ACTION_PREFIX = "md-editor:file-tree:";

export function isDesktopNativeFileTreeContextMenuAvailable(): boolean {
  return isTauri();
}

export async function showNativeFileTreeContextMenu(input: {
  readonly x: number;
  readonly y: number;
  readonly hasNode: boolean;
}): Promise<void> {
  if (!isTauri()) {
    return;
  }

  await invoke("show_file_tree_context_menu", {
    x: input.x,
    y: input.y,
    hasNode: input.hasNode,
  });
}

export async function writeTextToClipboard(text: string): Promise<void> {
  if (typeof window !== "undefined") {
    window.focus();
  }

  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // 在 Windows 原生菜单关闭后，WebView2 短暂失去焦点可能导致 writeText 异常，降级回退
    }
  }

  if (typeof document !== "undefined") {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    textarea.style.pointerEvents = "none";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    try {
      document.execCommand("copy");
    } finally {
      document.body.removeChild(textarea);
    }
  }
}

export async function copyNativeFileTreePath(input: {
  readonly rootPath: string;
  readonly path: string;
  readonly relative: boolean;
}): Promise<void> {
  if (!isTauri()) {
    return;
  }

  const text = await invoke<string>("copy_file_tree_path", {
    rootPath: input.rootPath,
    path: input.path,
    relative: input.relative,
  });
  await writeTextToClipboard(text);
}

export async function revealNativeFileTreeItemInFinder(input: {
  readonly rootPath: string;
  readonly path: string;
}): Promise<void> {
  if (!isTauri()) {
    return;
  }

  await invoke("reveal_file_tree_item_in_finder", {
    rootPath: input.rootPath,
    path: input.path,
  });
}

export function listenToNativeFileTreeContextMenuActions(
  handler: (action: FileTreeContextMenuAction) => void,
): (() => void) | undefined {
  return listenToDesktopMenuActions((action) => {
    if (!action.startsWith(FILE_TREE_MENU_ACTION_PREFIX)) {
      return;
    }

    const menuAction = action.slice(FILE_TREE_MENU_ACTION_PREFIX.length);
    if (isFileTreeContextMenuAction(menuAction)) {
      handler(menuAction);
    }
  });
}

function isFileTreeContextMenuAction(action: string): action is FileTreeContextMenuAction {
  return FILE_TREE_CONTEXT_MENU_ACTIONS.includes(action as FileTreeContextMenuAction);
}
