/**
 * @fileoverview 桌面端应用内更新的状态机 hook
 *
 * 职责边界：
 * - 主窗口（`surface === "main"`）是唯一执行者：启动即检查、每 6 小时检查、按偏好自动下载、
 *   响应设置窗口发来的动作，并把状态快照广播出去；
 * - 设置窗口只镜像主窗口的快照，按钮动作经 `update-bridge` 转交主窗口，
 *   保证全应用只有一份待安装的更新、只下载一次。
 *
 * 「稍后」只在内存里记住版本（`postponedVersion`）：本次运行内不下载、不再弹窗，重启后重新提示。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { t } from "@md-editor/i18n";
import type { ChangelogEntry } from "@md-editor/changelog";
import { appVersion, type AppUpdateSettings, type UpdateStatus } from "../settings/app-settings";
import {
  checkForInstallableUpdate,
  downloadPendingUpdate,
  installDownloadedUpdate,
  relaunchAfterUpdate,
} from "./app-updater";
import { isUpdateActionBusy, isUpdateReadyToApply } from "./update-status";
import {
  listenUpdatePromptStateChanged,
  loadUpdatePromptState,
  normalizeVersion,
  saveUpdatePromptState,
  type UpdatePromptState,
} from "./prompt-state";
import {
  resolveUpdateNoticeChoice,
  selectUpdatePresentation,
  shouldAutoDownloadUpdate,
  shouldPresentUpdateNotice,
  type UpdateNoticeChoice,
} from "./presentation";
import { readReleaseNotesEntry } from "./release-notes";
import {
  listenUpdateCommands,
  listenUpdateSnapshot,
  publishUpdateSnapshot,
  sendUpdateCommand,
} from "./update-bridge";

const AUTO_UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

export interface UpdateNotice {
  readonly version: string;
  readonly entry: ChangelogEntry | null;
}

export interface AppUpdatesValue {
  readonly updateStatus: UpdateStatus;
  /** 最近一次检查完成时间（ISO 字符串，展示时再按语言格式化）；从未检查为 null */
  readonly lastCheckedAt: string | null;
  /** 提示簿记（已提示/已跳过），设置页据此隐藏已经生效的动作 */
  readonly updatePromptState: UpdatePromptState;
  /** 需要展示「本次更新内容」时非 null */
  readonly updateNotice: UpdateNotice | null;
  readonly checkForUpdate: () => Promise<UpdateStatus>;
  readonly downloadUpdate: () => Promise<UpdateStatus>;
  /** 安装已下载的更新；只在主窗口有效，调用方负责未保存文档确认与重启 */
  readonly applyDownloadedUpdate: () => Promise<UpdateStatus>;
  readonly relaunchUpdate: () => Promise<void>;
  readonly resolveUpdateNotice: (choice: UpdateNoticeChoice, version: string) => Promise<void>;
  /** 跳过当前最新版本：之后不再自动提示/自动下载该版本（手动检查仍可见） */
  readonly skipUpdateVersion: (version?: string) => Promise<void>;
}

interface UseAppUpdatesInput {
  readonly surface: "main" | "settings-window";
  readonly updateSettings: AppUpdateSettings;
  readonly hasLoadedSettings: boolean;
  readonly showToast: (message: string | null) => void;
}

export function useAppUpdates({
  surface,
  updateSettings,
  hasLoadedSettings,
  showToast,
}: UseAppUpdatesInput): AppUpdatesValue {
  const isUpdateOwner = surface === "main";

  // 状态与 ref 同步写入：异步流程里读 ref 必须拿到最新值，不能等 effect 回填。
  const [updateStatus, setUpdateStatusState] = useState<UpdateStatus>(() => ({
    currentVersion: appVersion(),
    state: "idle",
  }));
  const updateStatusRef = useRef(updateStatus);
  const setUpdateStatus = useCallback((next: UpdateStatus) => {
    updateStatusRef.current = next;
    setUpdateStatusState(next);
  }, []);

  const [lastCheckedAt, setLastCheckedAtState] = useState<string | null>(null);
  const lastCheckedAtRef = useRef<string | null>(null);
  const setLastCheckedAt = useCallback((next: string | null) => {
    lastCheckedAtRef.current = next;
    setLastCheckedAtState(next);
  }, []);

  // 提示簿记：只有「已提示/已跳过」两个版本号，持久化在独立文件里。
  const [promptState, setPromptState] = useState<UpdatePromptState>({});
  const promptStateRef = useRef<UpdatePromptState>({});
  const [hasLoadedPromptState, setHasLoadedPromptState] = useState(false);

  // 本次运行内被「稍后」的版本：不持久化，重启即失效。
  const [postponedVersion, setPostponedVersion] = useState<string | undefined>(undefined);
  const postponedVersionRef = useRef<string | undefined>(undefined);

  // 首帧闸门：主题与主窗口首帧就绪前不弹模态，避免遮罩白屏。
  const [hasPaintedFirstFrame, setHasPaintedFirstFrame] = useState(false);
  const toastedVersionsRef = useRef(new Set<string>());
  const isCheckingRef = useRef(false);
  const hasRunInitialCheckRef = useRef(false);

  // 周期检查读取最新偏好，不让偏好变化重建检查回调。
  const automaticDownloadRef = useRef(updateSettings.automaticDownload);
  useEffect(() => {
    automaticDownloadRef.current = updateSettings.automaticDownload;
  }, [updateSettings.automaticDownload]);

  // 首帧闸门：双重 rAF 之后才允许呈现更新提示，避免启动瞬间闪出无主题的遮罩。
  useEffect(() => {
    if (typeof requestAnimationFrame !== "function") {
      setHasPaintedFirstFrame(true);
      return;
    }
    let secondFrame = 0;
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => setHasPaintedFirstFrame(true));
    });
    return () => {
      cancelAnimationFrame(firstFrame);
      if (secondFrame !== 0) cancelAnimationFrame(secondFrame);
    };
  }, []);

  // 读取提示簿记；主窗口读完之前不发起自动检查，避免对已提示版本重复弹窗。
  // 另一窗口写入簿记后跟随刷新，避免同一会话内重复提示。
  useEffect(() => {
    let disposed = false;
    void loadUpdatePromptState().then((state) => {
      if (disposed) return;
      promptStateRef.current = state;
      setPromptState(state);
      setHasLoadedPromptState(true);
    });
    const stopListening = listenUpdatePromptStateChanged((state) => {
      if (disposed) return;
      promptStateRef.current = state;
      setPromptState(state);
    });
    return () => {
      disposed = true;
      stopListening?.();
    };
  }, []);

  /**
   * 执行下载。失败时回到「可更新」：标题栏入口保留，待下载的更新也保留，用户可以直接重试。
   * 用户主动发起的下载失败要给出反馈；自动下载失败只记日志，等下次检查再试。
   */
  const runDownload = useCallback(
    async ({ manual }: { readonly manual: boolean }): Promise<UpdateStatus> => {
      const before = updateStatusRef.current;
      const result = await downloadPendingUpdate(setUpdateStatus);
      if (result.state !== "error") {
        setUpdateStatus(result);
        return result;
      }

      console.warn("下载更新失败", result.error);
      const reverted: UpdateStatus =
        before.state === "available"
          ? { ...before, error: manual ? result.error : undefined }
          : before;
      setUpdateStatus(reverted);
      if (manual) {
        showToast(t("settings.updates.toasts.downloadFailed", { error: result.error ?? "" }));
      }
      return reverted;
    },
    [setUpdateStatus, showToast],
  );

  const runUpdateCheck = useCallback(
    async ({ automatic = false }: { readonly automatic?: boolean } = {}): Promise<UpdateStatus> => {
      const current = updateStatusRef.current;
      if (isCheckingRef.current || isUpdateActionBusy(current) || isUpdateReadyToApply(current)) {
        return current;
      }

      isCheckingRef.current = true;
      setUpdateStatus({ ...current, state: "checking", error: undefined });
      let next: UpdateStatus;
      try {
        // 检查失败（R2 与备用 endpoint 都不可用）在 app-updater 内已按「已是最新」处理；
        // 手动检查额外给轻提示，且不刷新「上次检查」时间，避免断网时看起来像刚确认过已是最新。
        const result = await checkForInstallableUpdate(appVersion());
        next = result.status;
        setUpdateStatus(next);
        if (result.checkFailed) {
          if (!automatic) showToast(t("settings.updates.toasts.checkFailed"));
        } else {
          setLastCheckedAt(new Date().toISOString());
        }
      } finally {
        isCheckingRef.current = false;
      }

      // 需要向用户展示更新内容时，先让提示出现；是否下载由用户在提示里决定。
      // 旧版本 manifest 的 notes 可能只是占位（Inkpoint x.y.z），此时不弹空弹窗。
      const context = {
        promptState: promptStateRef.current,
        postponedVersion: postponedVersionRef.current,
      };
      const willPresentNotice =
        shouldPresentUpdateNotice(next, context) && readReleaseNotesEntry(next) !== null;
      const shouldDownload =
        automatic &&
        shouldAutoDownloadUpdate({
          status: next,
          ...context,
          automaticDownload: automaticDownloadRef.current,
          noticePending: willPresentNotice,
        });
      return shouldDownload ? runDownload({ manual: false }) : next;
    },
    [runDownload, setLastCheckedAt, setUpdateStatus, showToast],
  );

  const checkForUpdate = useCallback(async () => {
    if (!isUpdateOwner) {
      sendUpdateCommand("check");
      return updateStatusRef.current;
    }
    return runUpdateCheck();
  }, [isUpdateOwner, runUpdateCheck]);

  const downloadUpdate = useCallback(async () => {
    if (!isUpdateOwner) {
      sendUpdateCommand("download");
      return updateStatusRef.current;
    }
    const current = updateStatusRef.current;
    if (current.state !== "available") return current;
    return runDownload({ manual: true });
  }, [isUpdateOwner, runDownload]);

  const applyDownloadedUpdate = useCallback(async () => {
    const current = updateStatusRef.current;
    setUpdateStatus({ ...current, state: "installing" });
    const result = await installDownloadedUpdate();
    if (result.state === "error") {
      console.warn("安装更新失败", result.error);
      setUpdateStatus(current);
      showToast(t("settings.updates.toasts.installFailed", { error: result.error ?? "" }));
      return result;
    }
    setUpdateStatus(result);
    return result;
  }, [setUpdateStatus, showToast]);

  const relaunchUpdate = useCallback(async () => {
    await relaunchAfterUpdate();
  }, []);

  // 关掉自动检测再打开时，用户期望马上生效：复位首检标记，让下面的 effect 立即检查一次。
  const previousAutomaticCheckRef = useRef(updateSettings.automaticCheck);
  useEffect(() => {
    if (!previousAutomaticCheckRef.current && updateSettings.automaticCheck) {
      hasRunInitialCheckRef.current = false;
    }
    previousAutomaticCheckRef.current = updateSettings.automaticCheck;
  }, [updateSettings.automaticCheck]);

  // 自动更新：设置与提示簿记就绪后立即检查一次，之后按固定周期检查（仅主窗口）。
  useEffect(() => {
    if (
      !isUpdateOwner ||
      !hasLoadedSettings ||
      !hasLoadedPromptState ||
      !updateSettings.automaticCheck ||
      !isTauri()
    )
      return;

    if (!hasRunInitialCheckRef.current) {
      hasRunInitialCheckRef.current = true;
      void runUpdateCheck({ automatic: true });
    }

    const interval = window.setInterval(
      () => void runUpdateCheck({ automatic: true }),
      AUTO_UPDATE_CHECK_INTERVAL_MS,
    );
    return () => window.clearInterval(interval);
  }, [
    hasLoadedPromptState,
    hasLoadedSettings,
    isUpdateOwner,
    runUpdateCheck,
    updateSettings.automaticCheck,
  ]);

  // 主窗口：状态变化即广播快照，设置窗口据此镜像。
  useEffect(() => {
    if (!isUpdateOwner) return;
    publishUpdateSnapshot({ status: updateStatus, lastCheckedAt });
  }, [isUpdateOwner, lastCheckedAt, updateStatus]);

  // 主窗口：执行设置窗口转交的动作（「安装并重启」由编辑器控制器处理，它负责未保存文档确认）。
  useEffect(() => {
    if (!isUpdateOwner) return;
    return listenUpdateCommands((command) => {
      if (command === "sync") {
        publishUpdateSnapshot({
          status: updateStatusRef.current,
          lastCheckedAt: lastCheckedAtRef.current,
        });
      } else if (command === "check") {
        void runUpdateCheck();
      } else if (command === "download") {
        void downloadUpdate();
      }
    });
  }, [downloadUpdate, isUpdateOwner, runUpdateCheck]);

  // 设置窗口：镜像主窗口的状态。
  useEffect(() => {
    if (isUpdateOwner) return;
    return listenUpdateSnapshot((snapshot) => {
      setUpdateStatus(snapshot.status);
      setLastCheckedAt(snapshot.lastCheckedAt);
    });
  }, [isUpdateOwner, setLastCheckedAt, setUpdateStatus]);

  /** 写入提示簿记的唯一入口：ref 与 state 必须同步更新。 */
  const commitPromptState = useCallback((next: UpdatePromptState) => {
    promptStateRef.current = next;
    setPromptState(next);
    void saveUpdatePromptState(next);
  }, []);

  const skipUpdateVersion = useCallback(
    async (targetVersion?: string) => {
      // 设置页调用时没有「当前提示版本」上下文，回落到状态里的最新版本。
      const version = normalizeVersion(targetVersion ?? updateStatusRef.current.latestVersion);
      if (!version) return;

      commitPromptState(
        resolveUpdateNoticeChoice("skip", version, promptStateRef.current).promptState,
      );
      showToast(t("settings.updates.toasts.skipped", { version }));
    },
    [commitPromptState, showToast],
  );

  const resolveUpdateNotice = useCallback(
    async (choice: UpdateNoticeChoice, version: string) => {
      if (choice === "skip") {
        await skipUpdateVersion(version);
        return;
      }

      const resolution = resolveUpdateNoticeChoice(choice, version, promptStateRef.current);
      if (resolution.promptState !== promptStateRef.current) {
        commitPromptState(resolution.promptState);
      }
      if (resolution.postponedVersion) {
        postponedVersionRef.current = resolution.postponedVersion;
        setPostponedVersion(resolution.postponedVersion);
      }
      if (resolution.download) {
        await downloadUpdate();
      }
    },
    [commitPromptState, downloadUpdate, skipUpdateVersion],
  );

  const updateNotice = useMemo<UpdateNotice | null>(() => {
    if (!isUpdateOwner) return null;
    const entry = readReleaseNotesEntry(updateStatus);
    const presentation = selectUpdatePresentation({
      status: updateStatus,
      promptState,
      postponedVersion,
      hasPaintedFirstFrame,
      hasReleaseNotes: entry !== null,
    });
    const version = normalizeVersion(updateStatus.latestVersion);
    return presentation.notice === "release-notes" && version ? { version, entry } : null;
  }, [hasPaintedFirstFrame, isUpdateOwner, postponedVersion, promptState, updateStatus]);

  // 第二段提醒：下载完成后只在主窗口提示一次 toast，不再弹模态打断。
  useEffect(() => {
    if (!isUpdateOwner) return;
    const version = normalizeVersion(updateStatus.latestVersion);
    if (updateStatus.state !== "downloaded" || !version) return;
    if (toastedVersionsRef.current.has(version)) return;

    toastedVersionsRef.current.add(version);
    showToast(t("settings.updates.toasts.downloaded", { version }));
  }, [isUpdateOwner, showToast, updateStatus.latestVersion, updateStatus.state]);

  return {
    updateStatus,
    lastCheckedAt,
    updatePromptState: promptState,
    updateNotice,
    checkForUpdate,
    downloadUpdate,
    applyDownloadedUpdate,
    relaunchUpdate,
    resolveUpdateNotice,
    skipUpdateVersion,
  };
}
