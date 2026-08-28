import { useCallback } from "react";
import type { FileTreeContextMenuState } from "../../types";
import {
  FILE_TREE_CONTEXT_MENU_ACTION,
  type FileTreeContextMenuAction,
} from "../../desktop/file-tree-context-menu";
import { ContextMenuItem } from "./ContextMenuItem";

export interface FileTreeContextMenuProps {
  readonly menu: FileTreeContextMenuState;
  readonly onClose: () => void;
  readonly onRunAction: (menu: FileTreeContextMenuState, action: FileTreeContextMenuAction) => void;
}

/**
 * 苹果风格毛玻璃右键上下文菜单
 */
export function FileTreeContextMenu({ menu, onClose, onRunAction }: FileTreeContextMenuProps) {
  const run = useCallback(
    (action: FileTreeContextMenuAction) => {
      onClose();
      onRunAction(menu, action);
    },
    [menu, onClose, onRunAction],
  );

  return (
    <div
      className="fixed z-50 min-w-44 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-surface)]/95 p-1.5 shadow-[0_12px_32px_rgba(20,18,15,0.12),0_0_0_1px_rgba(20,18,15,0.04)] backdrop-blur-xl animate-in fade-in zoom-in-95 duration-100"
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
          <div className="my-1 h-px bg-[var(--theme-border)]/60" />
          <ContextMenuItem onClick={() => run(FILE_TREE_CONTEXT_MENU_ACTION.copyRelativePath)}>
            复制相对路径
          </ContextMenuItem>
          <ContextMenuItem onClick={() => run(FILE_TREE_CONTEXT_MENU_ACTION.copyAbsolutePath)}>
            复制绝对路径
          </ContextMenuItem>
          <ContextMenuItem onClick={() => run(FILE_TREE_CONTEXT_MENU_ACTION.revealInFinder)}>
            在 Finder 中显示
          </ContextMenuItem>
          <div className="my-1 h-px bg-[var(--theme-border)]/60" />
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
