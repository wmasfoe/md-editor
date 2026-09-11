import { useEffect, useState } from "react";
import { ConfirmActionDialog } from "@md-editor/editor-ui";
import { CommandPalette } from "./CommandPalette";
import { MdxComponentMenu } from "./MdxComponentMenu";
import { InsertTableDialog } from "./InsertTableDialog";
import { isMacPlatform } from "../app/AppWindowChrome";
import { useDesktopEditorActions } from "../app/context/DesktopEditorActionsContext";
import { runtime } from "../app/runtime/editor-runtime";
import { useConfirmationStore } from "../app/stores/confirmation-store";
import { useDocumentUiStore } from "../app/stores/document-ui-store";

/**
 * 桌面端全局模态弹窗与浮层管理组件。
 *
 * 聚合以下全局对话框：
 * 1. ConfirmActionDialog: 操作确认对话框（如覆盖保存、删除文件确认等）；
 * 2. CommandPalette: 命令面板，支持 Cmd/Ctrl+K 全局快捷键唤起，动作经由 dispatchCommand 分发；
 * 3. MdxComponentMenu: MDX 自定义组件插入菜单；
 * 4. InsertTableDialog: 插入表格行数列数配置对话框。
 */
export function DesktopModals() {
  const { confirmation, resolveConfirmation } = useConfirmationStore();
  const {
    isMdxComponentMenuOpen,
    closeMdxComponentMenu,
    isInsertTableDialogOpen,
    closeInsertTableDialog,
  } = useDocumentUiStore();
  const { dispatchCommand, insertMdxComponent, insertTable } = useDesktopEditorActions();
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);

  // 全局快捷键 Cmd/Ctrl+K 开关命令面板
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = isMacPlatform() ? event.metaKey : event.ctrlKey;
      if (mod && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setIsCommandPaletteOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <>
      {/* 操作确认对话框 */}
      <ConfirmActionDialog confirmation={confirmation} onResolve={resolveConfirmation} />

      {/* 命令面板：统一的 UI 动作入口，分发至宿主 dispatchCommand */}
      <CommandPalette
        open={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
        onRun={(commandId) => void dispatchCommand(commandId)}
      />

      {/* MDX 组件插入面板 */}
      <MdxComponentMenu
        open={isMdxComponentMenuOpen}
        plugins={runtime.mdxComponents.listInsertable()}
        onClose={closeMdxComponentMenu}
        onInsert={insertMdxComponent}
      />

      {/* 插入表格对话框 */}
      <InsertTableDialog
        open={isInsertTableDialogOpen}
        onClose={closeInsertTableDialog}
        onConfirm={insertTable}
      />
    </>
  );
}
