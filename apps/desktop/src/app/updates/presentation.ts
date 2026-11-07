/**
 * @fileoverview 由更新状态推导「是否展示更新内容弹窗」以及自动下载的准入条件
 *
 * 纯函数、无副作用，便于用状态矩阵覆盖验收条件：
 * - `notice`：是否展示「本次更新内容」对话框（同版本只提示一次、跳过即不再提示、
 *   本次运行内「稍后」不再提示、没有可展示内容时不弹空壳）；
 * - `isVersionSkipped` / `shouldAutoDownloadUpdate`：跳过 / 稍后语义与自动下载准入。
 * 弹窗还必须等待首帧，避免启动瞬间闪出未应用主题的遮罩。
 */

import type { UpdateStatus } from "../settings/app-settings";
import { normalizeVersion, type UpdatePromptState } from "./prompt-state";

/** 更新内容对话框是否展示。 */
export type UpdateNoticeKind = "none" | "release-notes";

/**
 * 用户在更新提示里的选择。
 * - `update`：立即下载；
 * - `later`：本次运行内既不下载也不再提示，下次启动重新提示（不持久化）；
 * - `skip`：持久化跳过该版本，直到出现更新的版本。
 */
export type UpdateNoticeChoice = "later" | "skip" | "update";

/**
 * 提示与自动下载的决策上下文。
 * `postponedVersion` 是本次运行内被「稍后」的版本，只存在内存里，重启即失效。
 */
export interface UpdateDecisionContext {
  readonly promptState: UpdatePromptState;
  readonly postponedVersion?: string;
}

export interface UpdatePresentation {
  readonly notice: UpdateNoticeKind;
}

export interface UpdatePresentationInput extends UpdateDecisionContext {
  readonly status: UpdateStatus;
  /** 首帧与主题已应用；否则不展示任何模态。 */
  readonly hasPaintedFirstFrame: boolean;
  /** notes 是否含有可展示内容；没有内容时不弹空弹窗，也不阻塞自动下载。 */
  readonly hasReleaseNotes: boolean;
}

/** 用户在提示里做出选择后，需要写入的簿记与需要触发的动作。 */
export interface UpdateNoticeResolution {
  /** 需要持久化的提示簿记；与入参相同表示无需写盘 */
  readonly promptState: UpdatePromptState;
  /** 本次运行内「稍后」的版本；undefined 表示不变 */
  readonly postponedVersion?: string;
  /** 是否立即开始下载 */
  readonly download: boolean;
}

/**
 * 把用户选择翻译成状态变更。
 *
 * 「稍后」刻意**不写** `lastNotifiedVersion`：它只在内存里推迟到本次运行结束，
 * 写盘会让下次启动也不再提示，等同于「跳过」。
 * 「稍后」也不触发下载，无论是否开启了自动下载；这是该选项存在的意义。
 */
export function resolveUpdateNoticeChoice(
  choice: UpdateNoticeChoice,
  version: string,
  promptState: UpdatePromptState,
): UpdateNoticeResolution {
  switch (choice) {
    case "update":
      return {
        promptState: { ...promptState, lastNotifiedVersion: version },
        download: true,
      };
    case "later":
      return { promptState, postponedVersion: version, download: false };
    case "skip":
      return {
        promptState: { ...promptState, lastNotifiedVersion: version, skippedVersion: version },
        download: false,
      };
  }
}

/** 统一的呈现推导入口。 */
export function selectUpdatePresentation({
  status,
  promptState,
  postponedVersion,
  hasPaintedFirstFrame,
  hasReleaseNotes,
}: UpdatePresentationInput): UpdatePresentation {
  const shouldShow =
    hasPaintedFirstFrame &&
    hasReleaseNotes &&
    shouldPresentUpdateNotice(status, { promptState, postponedVersion });
  return { notice: shouldShow ? "release-notes" : "none" };
}

/**
 * 该版本是否已被用户跳过。
 *
 * 「跳过此版本」是用户对**自动行为**的拒绝：既不自动提示，也不自动下载。
 * 手动检查仍可看到该版本，因此这里不能用于隐藏设置页信息。
 */
export function isVersionSkipped(status: UpdateStatus, promptState: UpdatePromptState): boolean {
  const version = normalizeVersion(status.latestVersion);
  return version !== undefined && version === promptState.skippedVersion;
}

/** 该版本是否在本次运行内被「稍后」。 */
function isVersionPostponed(status: UpdateStatus, postponedVersion: string | undefined): boolean {
  const version = normalizeVersion(status.latestVersion);
  return version !== undefined && version === normalizeVersion(postponedVersion);
}

/**
 * 自动下载是否应当启动。
 *
 * 独立否决项：用户关掉了自动下载、跳过了该版本、本次运行内选了「稍后」；
 * 另外「更新内容提示待展示」时也要先让人读到内容、由用户选择后再下载。
 * 抽成纯函数是因为它同时决定「跳过 / 稍后」是否真的生效，必须可行为断言。
 */
export function shouldAutoDownloadUpdate(
  input: UpdateDecisionContext & {
    readonly status: UpdateStatus;
    readonly automaticDownload: boolean;
    readonly noticePending: boolean;
  },
): boolean {
  const { status, promptState, postponedVersion, automaticDownload, noticePending } = input;
  if (!automaticDownload || noticePending || status.state !== "available") {
    return false;
  }
  return !isVersionSkipped(status, promptState) && !isVersionPostponed(status, postponedVersion);
}

/**
 * 是否应当提示该版本（与首帧无关，供检查流程判断是否延后自动下载）。
 *
 * 调用方需同时确认 notes 有可展示内容：没有内容时弹窗只是空壳，
 * 这时应当让标题栏按钮承担提示，并允许自动下载继续。
 */
export function shouldPresentUpdateNotice(
  status: UpdateStatus,
  { promptState, postponedVersion }: UpdateDecisionContext,
): boolean {
  if (status.state !== "available") {
    return false;
  }

  const version = normalizeVersion(status.latestVersion);
  if (!version) {
    return false;
  }

  // 同版本只提示一次；「跳过此版本」与本次运行内的「稍后」同样视为已处理。
  return (
    version !== promptState.lastNotifiedVersion &&
    version !== promptState.skippedVersion &&
    !isVersionPostponed(status, postponedVersion)
  );
}
