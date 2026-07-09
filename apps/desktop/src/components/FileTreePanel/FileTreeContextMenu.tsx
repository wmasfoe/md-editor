import { useCallback } from "react";
import type { FileTreeContextMenuState } from "../../types";
import {
  FILE_TREE_CONTEXT_MENU_ACTION,
  type FileTreeContextMenuAction
} from "../../desktop/file-tree-context-menu";
import { ContextMenuItem } from "./ContextMenuItem";

export interface FileTreeContextMenuProps {
  readonly menu: FileTreeContextMenuState;
  readonly onClose: () => void;
  readonly onRunAction: (menu: FileTreeContextMenuState, action: FileTreeContextMenuAction) => void;
}

export function FileTreeContextMenu({
  menu,
  onClose,
  onRunAction
}: FileTreeContextMenuProps) {
  const run = useCallback(
    (action: FileTreeContextMenuAction) => {
      onClose();
      onRunAction(menu, action);
    },
    [menu, onClose, onRunAction]
  );

  return (
    <div
      className="fixed z-50 min-w-37.5 rounded-md border border-(--theme-border) bg-(--theme-surface) p-1 shadow-[0_12px_30px_rgba(51,51,51,0.14)]"
      style={{ left: menu.x, top: menu.y }}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      <ContextMenuItem onClick={() => run(FILE_TREE_CONTEXT_MENU_ACTION.newMarkdown)}>
        新建文件
      </ContextMenuItem>
      <ContextMenuItem onClick={() => run(FILE_TREE_CONTEXT_MENU_ACTION.newMdx)}>
        新建 MDX 文件
      </ContextMenuItem>
      <ContextMenuItem onClick={() => run(FILE_TREE_CONTEXT_MENU_ACTION.newFolder)}>
        新建文件夹
      </ContextMenuItem>
      {menu.node ? (
        <>
          <div className="m-1 h-px bg-(--theme-border)" />
          <ContextMenuItem onClick={() => run(FILE_TREE_CONTEXT_MENU_ACTION.copyRelativePath)}>
            复制路径
          </ContextMenuItem>
          <ContextMenuItem onClick={() => run(FILE_TREE_CONTEXT_MENU_ACTION.copyAbsolutePath)}>
            复制绝对路径
          </ContextMenuItem>
          <ContextMenuItem onClick={() => run(FILE_TREE_CONTEXT_MENU_ACTION.revealInFinder)}>
            在 Finder 中显示
          </ContextMenuItem>
          <div className="m-1 h-px bg-(--theme-border)" />
          <ContextMenuItem onClick={() => run(FILE_TREE_CONTEXT_MENU_ACTION.rename)}>
            重命名
          </ContextMenuItem>
          <ContextMenuItem danger onClick={() => run(FILE_TREE_CONTEXT_MENU_ACTION.delete)}>
            删除
          </ContextMenuItem>
        </>
      ) : null}
    </div>
  );
}
