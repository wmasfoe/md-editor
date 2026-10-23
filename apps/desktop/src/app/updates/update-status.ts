import type { UpdateStatus } from "../settings/app-settings";
import { isVersionSkipped, type UpdateNoticeKind } from "./presentation";
import type { UpdatePromptState } from "./prompt-state";

export function isUpdateReadyToApply(status: UpdateStatus): boolean {
  return status.state === "downloaded" || status.state === "installed";
}

export function isUpdateActionBusy(status: UpdateStatus): boolean {
  return (
    status.state === "downloading" || status.state === "installing" || status.state === "checking"
  );
}

/**
 * 标题栏是否显示更新 CTA。
 *
 * 用户跳过某版本后不应继续用主色按钮提醒：那正是「跳过」要消除的打扰。
 * 但已下载/安装中的状态必须保留入口，否则用户没有重启路径。
 */
export function shouldShowEditorUpdateAction(
  status: UpdateStatus,
  promptState: UpdatePromptState = {},
): boolean {
  if (status.installKind !== "app") {
    return false;
  }

  switch (status.state) {
    case "downloaded":
    case "installing":
    case "installed":
      return true;
    case "available":
    case "downloading":
      return !isVersionSkipped(status, promptState);
    default:
      return false;
  }
}

export type { UpdateNoticeKind };
