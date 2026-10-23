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

/** 用户在更新提示里的选择。 */
export type UpdateNoticeChoice = "later" | "skip" | "update";

export interface UpdatePresentation {
  readonly notice: UpdateNoticeKind;
}

export interface UpdatePresentationInput {
  readonly status: UpdateStatus;
  readonly promptState: UpdatePromptState;
  /** 首帧与主题已应用；否则不展示任何模态。 */
  readonly hasPaintedFirstFrame: boolean;
  /** notes 是否含有可展示内容；没有内容时不弹空弹窗，也不阻塞自动下载。 */
  readonly hasReleaseNotes: boolean;
}

/** 统一的呈现推导入口。 */
export function selectUpdatePresentation({
  status,
  promptState,
  hasPaintedFirstFrame,
  hasReleaseNotes,
}: UpdatePresentationInput): UpdatePresentation {
  if (status.installKind !== "app") {
    return { notice: "none" };
  }

  return {
    notice:
      hasPaintedFirstFrame && hasReleaseNotes && shouldPresentUpdateNotice(status, promptState)
        ? "release-notes"
        : "none",
  };
}

/**
 * 该版本是否已被用户跳过。
 *
 * 「跳过此版本」是用户对**自动行为**的拒绝：既不自动提示，也不自动下载。
 * 手动检查仍可看到该版本，因此这里不能用于隐藏标题栏按钮或设置页信息。
 */
export function isVersionSkipped(status: UpdateStatus, promptState: UpdatePromptState): boolean {
  const version = normalizeVersion(status.latestVersion);
  return version !== undefined && version === promptState.skippedVersion;
}

/**
 * 自动下载是否应当启动。
 *
 * 三条独立否决：通道不支持应用内安装、用户关掉了自动下载、用户跳过了该版本；
 * 另外「更新内容提示待展示」时也要先让人读到内容再下载。
 * 抽成纯函数是因为它同时决定「跳过」是否真的生效，必须可行为断言。
 */
export function shouldAutoDownloadUpdate(input: {
  readonly status: UpdateStatus;
  readonly promptState: UpdatePromptState;
  readonly automaticDownload: boolean;
  readonly noticePending: boolean;
}): boolean {
  const { status, promptState, automaticDownload, noticePending } = input;
  if (!automaticDownload || noticePending) {
    return false;
  }
  if (status.installKind !== "app" || status.state !== "available") {
    return false;
  }
  return !isVersionSkipped(status, promptState);
}

/**
 * 是否应当首次提示该版本（与首帧无关，供检查流程判断是否延后自动下载）。
 *
 * 调用方需同时确认 notes 有可展示内容：没有内容时弹窗只是空壳，
 * 这时应当让标题栏按钮承担提示，并允许自动下载继续。
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
