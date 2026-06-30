import { isTauri } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type DownloadEvent, type Update } from "@tauri-apps/plugin-updater";
import {
  appVersion,
  checkForUpdates,
  type UpdateStatus
} from "../settings/app-settings";

type ProgressReporter = (status: UpdateStatus) => void;

interface DownloadProgressUpdate {
  readonly state: "downloading" | "installing";
  readonly downloadedBytes: number;
  readonly totalBytes: number;
  readonly message: string;
}

let pendingUpdate: Update | null = null;

export async function checkForInstallableUpdate(currentVersion = appVersion()): Promise<UpdateStatus> {
  if (!isTauri()) {
    return checkForUpdates(currentVersion);
  }

  try {
    await clearPendingUpdate();
    const update = await check({ timeout: 30_000 });
    if (!update) {
      return {
        currentVersion,
        state: "up-to-date",
        message: `当前版本 ${currentVersion} 已是最新发布版本。`
      };
    }

    pendingUpdate = update;
    return {
      currentVersion,
      state: "available",
      latestVersion: update.version,
      installKind: "app",
      message: `发现新版本 ${update.version}，当前版本 ${currentVersion}。可以直接安装更新。`
    };
  } catch (error) {
    // Manifest 尚未发布或 updater 配置异常时，退回现有公开 release 检查，保留手动安装路径。
    const fallbackStatus = await checkForUpdates(currentVersion);
    if (fallbackStatus.state === "available") {
      return {
        ...fallbackStatus,
        message: `应用内更新暂不可用：${formatUpdateError(error)}。${fallbackStatus.message}`
      };
    }

    return {
      currentVersion,
      state: fallbackStatus.state === "error" ? "error" : "unconfigured",
      message: `应用内更新暂不可用：${formatUpdateError(error)}。${fallbackStatus.message}`
    };
  }
}

export async function installPendingUpdate(reportProgress: ProgressReporter): Promise<UpdateStatus> {
  const update = pendingUpdate;
  const currentVersion = appVersion();
  if (!update) {
    return {
      currentVersion,
      state: "error",
      message: "没有待安装的应用内更新，请先检查更新。"
    };
  }

  let downloadedBytes = 0;
  let totalBytes = 0;
  const baseStatus = {
    currentVersion,
    latestVersion: update.version,
    installKind: "app" as const
  };

  try {
    reportProgress({
      ...baseStatus,
      state: "downloading",
      downloadedBytes,
      totalBytes,
      message: `正在下载 Markdown Editor ${update.version}...`
    });

    await update.downloadAndInstall((event) => {
      const nextProgress = readDownloadProgress(event, downloadedBytes, totalBytes);
      downloadedBytes = nextProgress.downloadedBytes;
      totalBytes = nextProgress.totalBytes;
      reportProgress({
        ...baseStatus,
        state: nextProgress.state,
        downloadedBytes,
        totalBytes,
        message: nextProgress.message
      });
    });

    pendingUpdate = null;
    await update.close().catch(() => undefined);
    return {
      ...baseStatus,
      state: "installed",
      downloadedBytes,
      totalBytes,
      message: `Markdown Editor ${update.version} 已安装，重启应用后生效。`
    };
  } catch (error) {
    return {
      ...baseStatus,
      state: "error",
      downloadedBytes,
      totalBytes,
      message: `安装更新失败：${formatUpdateError(error)}`
    };
  }
}

export async function relaunchAfterUpdate(): Promise<void> {
  if (!isTauri()) {
    throw new Error("重启应用只在桌面端可用。");
  }
  await relaunch();
}

async function clearPendingUpdate(): Promise<void> {
  const update = pendingUpdate;
  pendingUpdate = null;
  await update?.close().catch(() => undefined);
}

function readDownloadProgress(
  event: DownloadEvent,
  downloadedBytes: number,
  totalBytes: number
): DownloadProgressUpdate {
  switch (event.event) {
    case "Started":
      return {
        state: "downloading",
        downloadedBytes: 0,
        totalBytes: event.data.contentLength ?? 0,
        message: "正在下载更新..."
      };
    case "Progress": {
      const nextDownloadedBytes = downloadedBytes + event.data.chunkLength;
      return {
        state: "downloading",
        downloadedBytes: nextDownloadedBytes,
        totalBytes,
        message: "正在下载更新..."
      };
    }
    case "Finished":
      return {
        state: "installing",
        downloadedBytes,
        totalBytes,
        message: "更新下载完成，正在安装..."
      };
  }
}

function formatUpdateError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
