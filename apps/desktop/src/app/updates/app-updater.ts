import { isTauri } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type DownloadEvent, type Update } from "@tauri-apps/plugin-updater";
import { appVersion, checkForUpdates, type UpdateStatus } from "../settings/app-settings";
export {
  isUpdateActionBusy,
  isUpdateReadyToApply,
  shouldShowEditorUpdateAction,
} from "./update-status";

type ProgressReporter = (status: UpdateStatus) => void;

interface DownloadProgressUpdate {
  readonly state: "downloading";
  readonly downloadedBytes: number;
  readonly totalBytes: number;
}

let pendingUpdate: Update | null = null;
let downloadedUpdate: Update | null = null;

export async function checkForInstallableUpdate(
  currentVersion = appVersion(),
): Promise<UpdateStatus> {
  if (!isTauri()) {
    return checkForUpdates(currentVersion);
  }

  try {
    if (downloadedUpdate) {
      return createDownloadedUpdateStatus(downloadedUpdate.version, currentVersion);
    }

    await clearPendingUpdate();
    const update = await check({ timeout: 30_000 });
    if (!update) {
      return {
        currentVersion,
        state: "up-to-date",
      };
    }

    pendingUpdate = update;
    return createAvailableUpdateStatus(update.version, currentVersion);
  } catch (error) {
    // Manifest 尚未发布或 updater 配置异常时，退回现有公开 release 检查，保留手动安装路径。
    const fallbackStatus = await checkForUpdates(currentVersion);
    if (fallbackStatus.state === "available") {
      return fallbackStatus;
    }

    return {
      currentVersion,
      state: fallbackStatus.state === "error" ? "error" : "unconfigured",
      error: formatUpdateError(error),
    };
  }
}

export async function downloadPendingUpdate(
  reportProgress: ProgressReporter,
): Promise<UpdateStatus> {
  const update = pendingUpdate;
  const currentVersion = appVersion();
  if (!update) {
    return {
      currentVersion,
      state: "error",
      error: "missing-pending-update",
    };
  }

  let downloadedBytes = 0;
  let totalBytes = 0;
  const baseStatus = {
    currentVersion,
    latestVersion: update.version,
    installKind: "app" as const,
  };

  try {
    reportProgress({
      ...baseStatus,
      state: "downloading",
      downloadedBytes,
      totalBytes,
    });

    await update.download((event) => {
      const nextProgress = readDownloadProgress(event, downloadedBytes, totalBytes);
      downloadedBytes = nextProgress.downloadedBytes;
      totalBytes = nextProgress.totalBytes;
      reportProgress({
        ...baseStatus,
        state: nextProgress.state,
        downloadedBytes,
        totalBytes,
      });
    });

    pendingUpdate = null;
    downloadedUpdate = update;
    return {
      ...baseStatus,
      state: "downloaded",
      downloadedBytes,
      totalBytes,
    };
  } catch (error) {
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
    return {
      currentVersion,
      state: "error",
      error: "missing-downloaded-update",
    };
  }

  const baseStatus = {
    currentVersion,
    latestVersion: update.version,
    installKind: "app" as const,
  };

  try {
    await update.install();
    downloadedUpdate = null;
    await update.close().catch(() => undefined);
    return {
      ...baseStatus,
      state: "installed",
    };
  } catch (error) {
    return {
      ...baseStatus,
      state: "error",
      error: formatUpdateError(error),
    };
  }
}

export async function installPendingUpdate(
  reportProgress: ProgressReporter,
): Promise<UpdateStatus> {
  const downloadStatus = await downloadPendingUpdate(reportProgress);
  if (downloadStatus.state !== "downloaded") {
    return downloadStatus;
  }
  reportProgress({
    ...downloadStatus,
    state: "installing",
  });
  return installDownloadedUpdate();
}

export async function relaunchAfterUpdate(): Promise<void> {
  if (!isTauri()) {
    throw new Error("tauri-runtime-unavailable");
  }
  await relaunch();
}

function createAvailableUpdateStatus(version: string, currentVersion: string): UpdateStatus {
  return {
    currentVersion,
    state: "available",
    latestVersion: version,
    installKind: "app",
  };
}

function createDownloadedUpdateStatus(version: string, currentVersion: string): UpdateStatus {
  return {
    currentVersion,
    state: "downloaded",
    latestVersion: version,
    installKind: "app",
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
): DownloadProgressUpdate {
  switch (event.event) {
    case "Started":
      return {
        state: "downloading",
        downloadedBytes: 0,
        totalBytes: event.data.contentLength ?? 0,
      };
    case "Progress": {
      const nextDownloadedBytes = downloadedBytes + event.data.chunkLength;
      return {
        state: "downloading",
        downloadedBytes: nextDownloadedBytes,
        totalBytes,
      };
    }
    case "Finished":
      return {
        state: "downloading",
        downloadedBytes,
        totalBytes,
      };
  }
}

function formatUpdateError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
