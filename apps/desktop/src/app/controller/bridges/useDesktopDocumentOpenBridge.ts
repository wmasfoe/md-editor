import { useLayoutEffect } from "react";
import { useDocumentUiStore } from "../../stores/document-ui-store";
import type { DocumentActionsController } from "../useDocumentActionsController";

interface UseDesktopDocumentOpenBridgeOptions {
  readonly documentActions: Pick<
    DocumentActionsController,
    "openDocumentFromTree" | "openRecentFile"
  >;
}

export function useDesktopDocumentOpenBridge({
  documentActions,
}: UseDesktopDocumentOpenBridgeOptions) {
  const { openDocumentFromTree, openRecentFile } = documentActions;

  // 打开文档需要 discard 检查和文件服务，复用 documentActions 后再暴露给 store 读者。
  useLayoutEffect(() => {
    useDocumentUiStore.setState({
      openDocumentFromTree,
      openRecentFile,
    });
  }, [openDocumentFromTree, openRecentFile]);
}
