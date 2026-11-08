import { useCallback } from "react";
import { useTranslation } from "@md-editor/i18n";
import type { FileTreeContextMenuState } from "../../types";
import {
  FILE_TREE_CONTEXT_MENU_ACTION,
  type FileTreeContextMenuAction,
} from "../../desktop/file-tree-context-menu";
import { ContextMenuItem } from "./ContextMenuItem";

export interface FileTreeContextMenuProps {
  readonly menu: FileTreeContextMenuState;
  /** 风格学习开启时针对选中节点显示的菜单项 */
  readonly styleLearning?: "exclude" | "restore" | null;
  readonly onClose: () => void;
  readonly onRunAction: (menu: FileTreeContextMenuState, action: FileTreeContextMenuAction) => void;
}

/**
 * 苹果风格毛玻璃右键上下文菜单
 */
export function FileTreeContextMenu({
  menu,
  onClose,
  onRunAction,
  styleLearning,
}: FileTreeContextMenuProps) {
  const { t } = useTranslation();
  const run = useCallback(
    (action: FileTreeContextMenuAction) => {
      onClose();
      onRunAction(menu, action);
    },
    [menu, onClose, onRunAction],
  );

  const isMac =
    typeof navigator !== "undefined" &&
    (navigator.platform?.toLowerCase().includes("mac") ||
      navigator.userAgent?.toLowerCase().includes("mac"));

  return (
    <div
      className="fixed z-50 min-w-44 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-surface)] p-1 shadow-[var(--theme-shadow)] animate-in fade-in zoom-in-95 duration-100"
      style={{ left: menu.x, top: menu.y }}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      <ContextMenuItem onClick={() => run(FILE_TREE_CONTEXT_MENU_ACTION.newMarkdown)}>
        {t("fileTree.contextMenu.newFile")}
      </ContextMenuItem>
      <ContextMenuItem onClick={() => run(FILE_TREE_CONTEXT_MENU_ACTION.newMdx)}>
        {t("fileTree.contextMenu.newMdxFile")}
      </ContextMenuItem>
      <ContextMenuItem onClick={() => run(FILE_TREE_CONTEXT_MENU_ACTION.newFolder)}>
        {t("fileTree.contextMenu.newFolder")}
      </ContextMenuItem>
      {menu.node ? (
        <>
          <div className="my-1 h-px bg-[var(--theme-border)]/60" />
          <ContextMenuItem onClick={() => run(FILE_TREE_CONTEXT_MENU_ACTION.copyRelativePath)}>
            {t("fileTree.contextMenu.copyRelativePath")}
          </ContextMenuItem>
          <ContextMenuItem onClick={() => run(FILE_TREE_CONTEXT_MENU_ACTION.copyAbsolutePath)}>
            {t("fileTree.contextMenu.copyAbsolutePath")}
          </ContextMenuItem>
          <ContextMenuItem onClick={() => run(FILE_TREE_CONTEXT_MENU_ACTION.revealInFinder)}>
            {isMac
              ? t("fileTree.contextMenu.revealInFinder")
              : t("fileTree.contextMenu.revealInExplorer")}
          </ContextMenuItem>
          <div className="my-1 h-px bg-[var(--theme-border)]/60" />
          <ContextMenuItem onClick={() => run(FILE_TREE_CONTEXT_MENU_ACTION.rename)}>
            {t("fileTree.contextMenu.rename")}
          </ContextMenuItem>
          <ContextMenuItem danger onClick={() => run(FILE_TREE_CONTEXT_MENU_ACTION.delete)}>
            {t("fileTree.contextMenu.delete")}
          </ContextMenuItem>
          {styleLearning ? (
            <>
              <div className="my-1 h-px bg-[var(--theme-border)]/60" />
              <ContextMenuItem
                onClick={() =>
                  run(
                    styleLearning === "exclude"
                      ? FILE_TREE_CONTEXT_MENU_ACTION.styleExclude
                      : FILE_TREE_CONTEXT_MENU_ACTION.styleRestore,
                  )
                }
              >
                {styleLearning === "exclude"
                  ? t("styleLearning.contextExclude")
                  : t("styleLearning.contextRestore")}
              </ContextMenuItem>
            </>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
