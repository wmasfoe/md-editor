import { useCallback, useLayoutEffect } from "react";
import type { ConfirmationChoice, ConfirmationState } from "@md-editor/editor-ui";
import type { UpdateStatus } from "../../settings/app-settings";
import { runtime } from "../../runtime/editor-runtime";
import {
  isUpdateActionBusy,
  shouldShowEditorUpdateAction
} from "../../updates/update-status";
import { useDocumentUiStore } from "../../stores/document-ui-store";

interface UseDesktopUpdateActionBridgeOptions {
  readonly applyDownloadedUpdate: () => Promise<UpdateStatus>;
  readonly downloadUpdate: () => Promise<UpdateStatus>;
  readonly relaunchUpdate: () => Promise<void>;
  readonly requestConfirmation: (confirmation: ConfirmationState) => Promise<ConfirmationChoice>;
  readonly updateStatus: UpdateStatus;
}

export function useDesktopUpdateActionBridge({
  applyDownloadedUpdate,
  downloadUpdate,
  relaunchUpdate,
  requestConfirmation,
  updateStatus,
}: UseDesktopUpdateActionBridgeOptions) {
  // 标题栏按钮从 store 触发，但更新流程依赖 settings provider 和当前文档 dirty 状态。
  const runEditorUpdateAction = useCallback(async () => {
    if (!shouldShowEditorUpdateAction(updateStatus) || isUpdateActionBusy(updateStatus)) {
      return;
    }

    let nextStatus = updateStatus;

    const ensureSavedBeforeApply = async () => {
      if (!runtime.document.getSnapshot().isDirty) {
        return true;
      }
      await requestConfirmation({
        title: "请先保存文档",
        description: "当前文档还有未保存的更改。请先保存，再继续更新 App。",
        confirmLabel: "知道了"
      });
      return false;
    };

    if (nextStatus.state === "available") {
      const choice = await requestConfirmation({
        title: "下载更新",
        description: `发现 Markdown Editor ${nextStatus.latestVersion ?? "新版本"}。下载完成后，你可以继续退出并更新。`,
        confirmLabel: "下载更新"
      });
      if (choice !== "confirm") return;
      const result = await downloadUpdate();
      if (result.state !== "downloaded") return;
      nextStatus = result;
    }

    if (!await ensureSavedBeforeApply()) return;

    if (nextStatus.state === "installed") {
      const choice = await requestConfirmation({
        title: "重启 App",
        description: "更新已安装。重启 App 后，新版本会生效。",
        confirmLabel: "重启 App"
      });
      if (choice === "confirm") await relaunchUpdate();
      return;
    }

    const choice = await requestConfirmation({
      title: "退出并更新",
      description: `Markdown Editor ${nextStatus.latestVersion ?? "新版本"} 已准备好。继续后会退出 App 并进行更新。`,
      confirmLabel: "退出并更新"
    });
    if (choice !== "confirm") return;

    const result = await applyDownloadedUpdate();
    if (result.state === "installed") await relaunchUpdate();
  }, [
    applyDownloadedUpdate,
    downloadUpdate,
    relaunchUpdate,
    requestConfirmation,
    updateStatus,
  ]);

  // 只桥接 provider 依赖；更新流程本身保持在这个 desktop hook 中，避免散落到组件。
  useLayoutEffect(() => {
    useDocumentUiStore.setState({ runEditorUpdateAction });
  }, [runEditorUpdateAction]);

  return runEditorUpdateAction;
}
