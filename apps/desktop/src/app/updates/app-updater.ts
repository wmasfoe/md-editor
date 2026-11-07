/**
 * @fileoverview 应用内更新的执行层：封装 tauri-plugin-updater 的检查 / 下载 / 安装
 *
 * 约定：
 * - 检查失败（R2 与备用 endpoint 都不可用、当前平台没有更新条目等）按「已是最新」处理，
 *   失败原因写日志并放在 `checkFailed` 里：自动检查静默忽略，手动检查由调用方给轻提示，
 *   避免用户在断网时误以为已是最新。
 * - 下载好的更新包只存在于发起下载的 webview 资源表里（插件按 webview 隔离），
 *   因此只有主窗口调用本模块；设置窗口经 `update-bridge` 把动作转交主窗口。
 */

import { isTauri } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type DownloadEvent, type Update } from "@tauri-apps/plugin-updater";
import { appVersion, type UpdateStatus } from "../settings/app-settings";

type ProgressReporter = (status: UpdateStatus) => void;

/** 拉取 updater manifest 的超时。 */
const CHECK_TIMEOUT_MS = 30_000;

/**
 * 下载总超时。
 *
 * 插件把它交给 reqwest 的 `timeout`，覆盖整个请求（含响应体），不是空闲超时；
 * 取值保证最大的更新包（Linux AppImage ≈ 100MB）在约 60KB/s 的慢速网络下仍能下完。
 * 目的只是防止网络卡死后永久停在「下载中」，进而挡住后续所有检查。
 */
const DOWNLOAD_TIMEOUT_MS = 30 * 60_000;

/** 下载进度上报的最小间隔：每个 chunk 都上报会引发大量重渲染与跨窗口广播。 */
const PROGRESS_REPORT_INTERVAL_MS = 100;

let pendingUpdate: Update | null = null;
let downloadedUpdate: Update | null = null;

/** 检查结果：`checkFailed` 存在表示检查本身失败（状态仍按「已是最新」给出）。 */
export interface UpdateCheckResult {
  readonly status: UpdateStatus;
  readonly checkFailed?: string;
}

export async function checkForInstallableUpdate(
  currentVersion = appVersion(),
): Promise<UpdateCheckResult> {
  const upToDate: UpdateStatus = { currentVersion, state: "up-to-date" };
  if (!isTauri()) {
    return { status: upToDate };
  }

  // 已下载但未安装：继续沿用这份包，避免重复下载。
  if (downloadedUpdate) {
    return { status: createUpdateStatus(downloadedUpdate, currentVersion, "downloaded") };
  }

  try {
    await clearPendingUpdate();
    const update = await check({ timeout: CHECK_TIMEOUT_MS });
    if (!update) {
      return { status: upToDate };
    }
    pendingUpdate = update;
    return { status: createUpdateStatus(update, currentVersion, "available") };
  } catch (error) {
    const reason = formatUpdateError(error);
    console.warn("检查更新失败，按已是最新处理", reason);
    return { status: upToDate, checkFailed: reason };
  }
}

export async function downloadPendingUpdate(
  reportProgress: ProgressReporter,
): Promise<UpdateStatus> {
  const update = pendingUpdate;
  const currentVersion = appVersion();
  if (!update) {
    return { currentVersion, state: "error", error: "missing-pending-update" };
  }

  const baseStatus = createUpdateStatus(update, currentVersion, "downloading");
  let downloadedBytes = 0;
  let totalBytes = 0;
  let lastReportedAt = 0;

  try {
    reportProgress({ ...baseStatus, downloadedBytes, totalBytes });

    await update.download(
      (event) => {
        ({ downloadedBytes, totalBytes } = readDownloadProgress(
          event,
          downloadedBytes,
          totalBytes,
        ));
        const now = Date.now();
        if (event.event === "Progress" && now - lastReportedAt < PROGRESS_REPORT_INTERVAL_MS) {
          return;
        }
        lastReportedAt = now;
        reportProgress({ ...baseStatus, downloadedBytes, totalBytes });
      },
      { timeout: DOWNLOAD_TIMEOUT_MS },
    );

    pendingUpdate = null;
    downloadedUpdate = update;
    return { ...baseStatus, state: "downloaded", downloadedBytes, totalBytes };
  } catch (error) {
    // pendingUpdate 保留：用户可以直接重试，不必重新检查。
    return {
      ...baseStatus,
      state: "error",
      downloadedBytes,
      totalBytes,
      error: formatUpdateError(error),
    };
  }
}

export async function installDownloadedUpdate(): Promise<UpdateStatus> {
  const update = downloadedUpdate;
  const currentVersion = appVersion();
  if (!update) {
    return { currentVersion, state: "error", error: "missing-downloaded-update" };
  }

  try {
    await update.install();
    downloadedUpdate = null;
    await update.close().catch(() => undefined);
    return createUpdateStatus(update, currentVersion, "installed");
  } catch (error) {
    return {
      ...createUpdateStatus(update, currentVersion, "error"),
      error: formatUpdateError(error),
    };
  }
}

export async function relaunchAfterUpdate(): Promise<void> {
  if (!isTauri()) {
    throw new Error("tauri-runtime-unavailable");
  }
  await relaunch();
}

function createUpdateStatus(
  update: Update,
  currentVersion: string,
  state: UpdateStatus["state"],
): UpdateStatus {
  return {
    currentVersion,
    state,
    latestVersion: update.version,
    releaseNotes: update.body ?? undefined,
  };
}

async function clearPendingUpdate(): Promise<void> {
  const update = pendingUpdate;
  pendingUpdate = null;
  await update?.close().catch(() => undefined);
}

function readDownloadProgress(
  event: DownloadEvent,
  downloadedBytes: number,
  totalBytes: number,
): { readonly downloadedBytes: number; readonly totalBytes: number } {
  switch (event.event) {
    case "Started":
      return { downloadedBytes: 0, totalBytes: event.data.contentLength ?? 0 };
    case "Progress":
      return { downloadedBytes: downloadedBytes + event.data.chunkLength, totalBytes };
    case "Finished":
      return { downloadedBytes, totalBytes };
  }
}

function formatUpdateError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
