import { Suspense, lazy, useEffect, useState } from "react";
import { ConfirmActionDialog } from "@md-editor/editor-ui";
import { CommandPalette } from "./CommandPalette";
import { MdxComponentMenu } from "./MdxComponentMenu";
import { InsertTableDialog } from "./InsertTableDialog";
import { UpdateNoticeDialog } from "./updates/UpdateNoticeDialog";
import { isMacPlatform } from "../app/AppWindowChrome";
import { useDesktopEditorActions } from "../app/context/DesktopEditorActionsContext";
import { runtime } from "../app/runtime/editor-runtime";
import { useConfirmationStore } from "../app/stores/confirmation-store";
import { useDocumentUiStore } from "../app/stores/document-ui-store";
import { useToastStore } from "../app/stores/toast-store";
import { useAppSettings } from "../app/settings-context";

const HistoryDrawer = lazy(() =>
  import("./history/HistoryDrawer").then((m) => ({ default: m.HistoryDrawer })),
);

/**
 * 查询命令当前生效的快捷键:用户在设置里的自定义覆盖优先,其次是内置 keymap。
 * 覆盖项的 id 与内置 keymap id 一致(见 command-bindings.ts),按 keymap id 合并。
 */
function findCommandShortcut(
  commandId: string,
  customShortcuts: readonly {
    readonly id: string;
    readonly commandId: string;
    readonly key: string;
  }[],
): string | undefined {
  const builtIn = runtime.keymaps.list().find((keymap) => keymap.commandId === commandId);
  const custom = customShortcuts.find(
    (shortcut) => shortcut.commandId === commandId || shortcut.id === builtIn?.id,
  );
  return custom?.key || builtIn?.key || undefined;
}

/**
 * 桌面端全局模态弹窗与浮层管理组件。
 *
 * 聚合以下全局对话框：
 * 1. ConfirmActionDialog: 操作确认对话框（如覆盖保存、删除文件确认等）；
 * 2. CommandPalette: 命令面板，支持 Cmd/Ctrl+K 全局快捷键唤起，动作经由 dispatchCommand 分发；
 * 3. MdxComponentMenu: MDX 自定义组件插入菜单；
 * 4. InsertTableDialog: 插入表格行数列数配置对话框；
 * 5. UpdateNoticeDialog: 检测到新版本后的「本次更新内容」提示（同版本只提示一次）。
 */
export function DesktopModals() {
  const { confirmation, resolveConfirmation } = useConfirmationStore();
  const {
    isMdxComponentMenuOpen,
    closeMdxComponentMenu,
    isInsertTableDialogOpen,
    closeInsertTableDialog,
    isHistoryDrawerOpen,
    closeHistoryDrawer,
  } = useDocumentUiStore();
  const { showToast } = useToastStore();
  const { dispatchCommand, insertMdxComponent, insertTable } = useDesktopEditorActions();
  const { settings, updateNotice, resolveUpdateNotice } = useAppSettings();
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
        getShortcut={(commandId) => findCommandShortcut(commandId, settings.shortcuts)}
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

      {/* 新版本提示：展示本次更新内容，关闭后同版本不再自动出现 */}
      <UpdateNoticeDialog
        version={updateNotice?.version ?? null}
        entry={updateNotice?.entry ?? null}
        onResolve={(choice) => {
          if (!updateNotice) return;
          void resolveUpdateNotice(choice, updateNotice.version);
        }}
      />
      {/* 历史版本快照抽屉 */}
      {isHistoryDrawerOpen && (
        <Suspense fallback={null}>
          <HistoryDrawer
            open={isHistoryDrawerOpen}
            filePath={runtime.document.getSnapshot().filePath}
            onClose={closeHistoryDrawer}
            onShowToast={showToast}
          />
        </Suspense>
      )}
    </>
  );
}
