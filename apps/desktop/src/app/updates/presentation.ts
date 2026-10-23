/**
 * @fileoverview 由更新状态推导「弹窗 / 标题栏 / 提示」的呈现结果
 *
 * 纯函数、无副作用，便于用状态矩阵覆盖 AC2–AC4：
 * - `notice`：是否展示「本次更新内容」对话框（同版本只提示一次、跳过即不再提示）；
 * - `titleBar`：标题栏更新按钮的语义（可更新 / 待重启）；
 * 弹窗还必须等待首帧，避免启动瞬间闪出未应用主题的遮罩。
 */

import type { UpdateStatus } from "../settings/app-settings";
import { normalizeVersion, type UpdatePromptState } from "./prompt-state";

/** 更新内容对话框是否展示。 */
export type UpdateNoticeKind = "none" | "release-notes";

/** 标题栏更新按钮语义。 */
export type UpdateTitleBarAction = "none" | "available" | "restart";

/** 用户在更新提示里的选择。 */
export type UpdateNoticeChoice = "later" | "skip" | "update";

export interface UpdatePresentation {
  readonly notice: UpdateNoticeKind;
  readonly titleBar: UpdateTitleBarAction;
}

export interface UpdatePresentationInput {
  readonly status: UpdateStatus;
  readonly promptState: UpdatePromptState;
  /** 首帧与主题已应用；否则不展示任何模态。 */
  readonly hasPaintedFirstFrame: boolean;
}

/** 统一的呈现推导入口。 */
export function selectUpdatePresentation({
  status,
  promptState,
  hasPaintedFirstFrame,
}: UpdatePresentationInput): UpdatePresentation {
  if (status.installKind !== "app") {
    return { notice: "none", titleBar: "none" };
  }

  return {
    notice:
      hasPaintedFirstFrame && shouldPresentUpdateNotice(status, promptState)
        ? "release-notes"
        : "none",
    titleBar: resolveTitleBarAction(status.state),
  };
}

/**
 * 是否应当首次提示该版本（与首帧无关，供检查流程判断是否延后自动下载）。
 */
export function shouldPresentUpdateNotice(
  status: UpdateStatus,
  promptState: UpdatePromptState,
): boolean {
  if (status.installKind !== "app" || status.state !== "available") {
    return false;
  }

  const version = normalizeVersion(status.latestVersion);
  if (!version) {
    return false;
  }

  // 同版本只提示一次；「跳过此版本」同样视为已处理。
  return version !== promptState.lastNotifiedVersion && version !== promptState.skippedVersion;
}

function resolveTitleBarAction(state: UpdateStatus["state"]): UpdateTitleBarAction {
  switch (state) {
    case "downloaded":
    case "installed":
      return "restart";
    case "available":
    case "downloading":
    case "installing":
      return "available";
    default:
      return "none";
  }
}
