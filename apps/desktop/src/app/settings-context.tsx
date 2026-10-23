import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { isTauri } from "@tauri-apps/api/core";
import {
  appVersion,
  createAppThemePreviewCoordinator,
  createDefaultSettings,
  loadAppSettings,
  listenToAppSettingsChanged,
  listenToAppThemePreviewChanged,
  listenToAppLanguagePreviewChanged,
  type AppSettings,
  type UpdateStatus,
} from "./settings/app-settings";
import { applyCustomThemeCss } from "./settings/theme-css";
import {
  checkForInstallableUpdate,
  downloadPendingUpdate,
  installDownloadedUpdate,
  relaunchAfterUpdate,
} from "./updates/app-updater";
import { isUpdateActionBusy, isUpdateReadyToApply } from "./updates/update-status";
import {
  listenUpdatePromptStateChanged,
  loadUpdatePromptState,
  normalizeVersion,
  saveUpdatePromptState,
  type UpdatePromptState,
} from "./updates/prompt-state";
import {
  selectUpdatePresentation,
  shouldAutoDownloadUpdate,
  shouldPresentUpdateNotice,
  type UpdateNoticeChoice,
} from "./updates/presentation";
import { readReleaseNotesEntry } from "./updates/release-notes";
import { openSettingsWindow } from "../desktop/settings-window";
import { mergeLocalAiModelStatus, readLocalAiModelStatus } from "./ai/local-ai-model";
import { changeLanguage, t } from "@md-editor/i18n";
import type { ChangelogEntry } from "@md-editor/changelog";
import { syncSentryWithSettings } from "./error-reporting/sentry";

const AUTO_UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

export interface AppSettingsContextValue {
  readonly settings: AppSettings;
  readonly hasLoadedSettings: boolean;
  readonly updateStatus: UpdateStatus;
  readonly isSettingsOpen: boolean;
  readonly openSettings: () => void;
  readonly closeSettings: () => void;
  readonly checkForUpdate: () => Promise<UpdateStatus>;
  readonly relaunchUpdate: () => Promise<void>;
  readonly downloadUpdate: () => Promise<UpdateStatus>;
  readonly applyDownloadedUpdate: () => Promise<UpdateStatus>;
  /** 需要展示「本次更新内容」时非 null；同版本关闭后不再出现 */
  readonly updateNotice: {
    readonly version: string;
    readonly entry: ChangelogEntry | null;
  } | null;
  readonly resolveUpdateNotice: (choice: UpdateNoticeChoice, version: string) => Promise<void>;
  /** 跳过当前最新版本：之后不再自动提示/自动下载该版本（手动检查仍可见） */
  readonly skipUpdateVersion: (version?: string) => Promise<void>;
  /** 提示簿记（已提示/已跳过），设置页据此隐藏已经生效的动作 */
  readonly updatePromptState: UpdatePromptState;
  /** 最近一次检查完成的时间（本地化展示用）；从未检查为 null */
  readonly lastCheckedAt: string | null;
}

interface UpdateCheckOptions {
  readonly automatic?: boolean;
  readonly downloadAvailableUpdate?: boolean;
}

const AppSettingsContext = createContext<AppSettingsContextValue | null>(null);

export function useAppSettings(): AppSettingsContextValue {
  const ctx = useContext(AppSettingsContext);
  if (!ctx) {
    throw new Error("useAppSettings must be used inside AppSettingsProvider");
  }
  return ctx;
}

interface AppSettingsProviderProps {
  readonly children: React.ReactNode;
  readonly showToast: (message: string | null) => void;
  // "main" = 主编辑窗口，"settings-window" = 独立设置窗口
  readonly surface?: "main" | "settings-window";
}

export function AppSettingsProvider({
  children,
  showToast,
  surface = "main",
}: AppSettingsProviderProps) {
  const [settings, setSettings] = useState<AppSettings>(() => createDefaultSettings());
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [previewTheme, setPreviewTheme] = useState<AppSettings["theme"] | null>(null);
  const [hasLoadedSettings, setHasLoadedSettings] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>(() => ({
    currentVersion: appVersion(),
    state: "idle",
  }));
  const updateStatusRef = useRef<UpdateStatus>(updateStatus);
  const isAutoUpdateRunningRef = useRef(false);
  // 更新提示簿记：只有「已提示/已跳过」两个版本号，持久化在独立文件里。
  const [promptState, setPromptState] = useState<UpdatePromptState>({});
  const promptStateRef = useRef<UpdatePromptState>({});
  const [hasLoadedPromptState, setHasLoadedPromptState] = useState(false);
  // 首帧闸门：主题与主窗口首帧就绪前不弹模态，避免遮罩白屏。
  const [hasPaintedFirstFrame, setHasPaintedFirstFrame] = useState(false);
  const toastedVersionsRef = useRef(new Set<string>());
  const hasRunInitialCheckRef = useRef(false);
  const [lastCheckedAt, setLastCheckedAt] = useState<string | null>(null);

  useEffect(() => {
    updateStatusRef.current = updateStatus;
  }, [updateStatus]);

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

  // 读取提示簿记（仅主窗口需要）；读完之前不发起自动检查，避免对已提示版本重复弹窗。
  useEffect(() => {
    if (surface !== "main") {
      setHasLoadedPromptState(true);
      return;
    }

    let disposed = false;
    void loadUpdatePromptState().then((state) => {
      if (disposed) return;
      promptStateRef.current = state;
      setPromptState(state);
      setHasLoadedPromptState(true);
    });
    // 设置窗口里的「跳过此版本」写的是同一份文件；这里跟随刷新，避免同一会话内重复提示。
    const stopListening = listenUpdatePromptStateChanged((state) => {
      if (disposed) return;
      promptStateRef.current = state;
      setPromptState(state);
    });
    return () => {
      disposed = true;
      stopListening?.();
    };
  }, [surface]);

  // 加载设置（含本地模型状态水合）
  useEffect(() => {
    let cancelled = false;
    void loadAppSettings()
      .then(async (loaded) => {
        if (cancelled) return;
        try {
          const modelStatus = await readLocalAiModelStatus(loaded.ai.localModel.modelId);
          if (cancelled) return;
          const hydrated: AppSettings = {
            ...loaded,
            ai: {
              ...loaded.ai,
              localModel: mergeLocalAiModelStatus(loaded.ai.localModel, modelStatus),
            },
          };
          setSettings(hydrated);
        } catch {
          setSettings(loaded);
        }
        setHasLoadedSettings(true);
      })
      .catch((error: unknown) => {
        if (!cancelled) showToast(error instanceof Error ? error.message : "设置读取失败。");
      });
    return () => {
      cancelled = true;
    };
  }, [showToast]);

  // 跨窗口设置同步（另一窗口保存后广播）
  useEffect(() => listenToAppSettingsChanged(setSettings), []);

  // 语言环境与持久化设置同步
  useEffect(() => {
    void changeLanguage(settings.language);
  }, [settings.language]);

  // Sentry 错误上报与用户设置同步
  useEffect(() => {
    syncSentryWithSettings(settings.errorReporting);
  }, [settings.errorReporting]);

  // 主窗口接收设置窗口的语言即时预览
  useEffect(() => {
    if (surface !== "main") return;
    return listenToAppLanguagePreviewChanged((lang) => {
      void changeLanguage(lang ?? settings.language);
    });
  }, [settings.language, surface]);

  // 主窗口接收设置窗口的主题预览
  useEffect(() => {
    if (surface !== "main") return;
    const coordinator = createAppThemePreviewCoordinator({
      loadPersistedSettings: loadAppSettings,
      onPersistedSettings: setSettings,
      onPreviewTheme: setPreviewTheme,
    });
    const stopListening = listenToAppThemePreviewChanged((event) => {
      void coordinator.handle(event).catch((error: unknown) => {
        showToast(error instanceof Error ? error.message : "设置重新读取失败。");
      });
    });

    return () => {
      coordinator.dispose();
      stopListening?.();
    };
  }, [showToast, surface]);

  // 应用主题 CSS（非预览：已保存主题或跨窗口预览）
  useEffect(() => {
    if (surface === "settings-window" || isSettingsOpen) return;
    return applyCustomThemeCss(previewTheme ?? settings.theme);
  }, [isSettingsOpen, previewTheme, settings.theme, surface]);

  const openSettings = useCallback(() => {
    void openSettingsWindow()
      .then((opened) => {
        if (!opened) setIsSettingsOpen(true); // 无原生窗口时降级为内嵌
      })
      .catch((error: unknown) => {
        showToast(error instanceof Error ? error.message : "设置窗口打开失败。");
      });
  }, [showToast]);

  const closeSettings = useCallback(() => {
    setIsSettingsOpen(false);
  }, []);

  const downloadUpdate = useCallback(async () => {
    const result = await downloadPendingUpdate(setUpdateStatus);
    setUpdateStatus(result);
    return result;
  }, []);

  const applyDownloadedUpdate = useCallback(async () => {
    const installingStatus: UpdateStatus = {
      ...updateStatusRef.current,
      currentVersion: updateStatusRef.current.currentVersion || appVersion(),
      state: "installing",
    };
    setUpdateStatus(installingStatus);
    const result = await installDownloadedUpdate();
    setUpdateStatus(result);
    return result;
  }, []);

  const relaunchUpdate = useCallback(async () => {
    await relaunchAfterUpdate();
  }, []);

  const runUpdateCheck = useCallback(
    async ({ automatic = false, downloadAvailableUpdate = false }: UpdateCheckOptions = {}) => {
      const current = updateStatusRef.current;
      if (
        isAutoUpdateRunningRef.current ||
        isUpdateActionBusy(current) ||
        isUpdateReadyToApply(current)
      )
        return current;

      isAutoUpdateRunningRef.current = true;
      const checkingStatus: UpdateStatus = {
        ...current,
        currentVersion: current.currentVersion || appVersion(),
        state: "checking",
      };
      setUpdateStatus(checkingStatus);

      try {
        if (automatic && current.state === "available" && current.installKind === "app") {
          // 该分支的提示已在上一轮处理过（noticePending=false），这里只判断是否该继续下载。
          const shouldDownload = shouldAutoDownloadUpdate({
            status: current,
            promptState: promptStateRef.current,
            automaticDownload: downloadAvailableUpdate,
            noticePending: false,
          });
          if (!shouldDownload) {
            setUpdateStatus(current);
            return current;
          }
          const downloaded = await downloadPendingUpdate(setUpdateStatus);
          if (downloaded.state === "error") {
            console.warn("自动下载更新失败", downloaded.error ?? downloaded.state);
            setUpdateStatus(current);
            return downloaded;
          }
          setUpdateStatus(downloaded);
          return downloaded;
        }

        const next = await checkForInstallableUpdate(appVersion());
        if (next.state === "error" || next.state === "unconfigured") {
          if (automatic) {
            console.warn("自动检测更新失败", next.error ?? next.state);
            setUpdateStatus(current);
          } else {
            setUpdateStatus(next);
          }
          return next;
        }

        // 需要向用户展示更新内容时，先让提示出现；自动下载推迟到提示关闭之后。
        // 旧版本 manifest 的 notes 可能只是占位（Inkpoint x.y.z），此时不弹空弹窗。
        const willPresentNotice =
          shouldPresentUpdateNotice(next, promptStateRef.current) &&
          readReleaseNotesEntry(next) !== null;
        const shouldDownload = shouldAutoDownloadUpdate({
          status: next,
          promptState: promptStateRef.current,
          automaticDownload: downloadAvailableUpdate,
          noticePending: willPresentNotice,
        });
        setUpdateStatus(next);
        if (shouldDownload) {
          const downloaded = await downloadPendingUpdate(setUpdateStatus);
          if (downloaded.state === "error") {
            console.warn("自动下载更新失败", downloaded.error ?? downloaded.state);
            setUpdateStatus(next);
            return downloaded;
          }
          setUpdateStatus(downloaded);
          return downloaded;
        }

        return next;
      } catch (error) {
        console.warn("自动检测更新失败", error);
        const failedStatus: UpdateStatus = {
          currentVersion: appVersion(),
          state: "error",
          error: formatUpdateCheckError(error),
        };
        if (automatic) {
          setUpdateStatus(current);
        } else {
          setUpdateStatus(failedStatus);
        }
        return failedStatus;
      } finally {
        isAutoUpdateRunningRef.current = false;
        setLastCheckedAt(new Date().toLocaleTimeString());
      }
    },
    [],
  );

  const checkForUpdate = useCallback(async () => runUpdateCheck(), [runUpdateCheck]);

  const runAutomaticUpdateCheck = useCallback(async () => {
    if (!isTauri() || !settings.update.automaticCheck) return;
    await runUpdateCheck({
      automatic: true,
      downloadAvailableUpdate: settings.update.automaticDownload,
    });
  }, [runUpdateCheck, settings.update.automaticCheck, settings.update.automaticDownload]);

  // 关掉自动检测再打开时，用户期望马上生效：复位首检标记，让下面的 effect 立即检查一次。
  const previousAutomaticCheckRef = useRef(settings.update.automaticCheck);
  useEffect(() => {
    if (!previousAutomaticCheckRef.current && settings.update.automaticCheck) {
      hasRunInitialCheckRef.current = false;
    }
    previousAutomaticCheckRef.current = settings.update.automaticCheck;
  }, [settings.update.automaticCheck]);

  // 自动更新：设置与提示簿记就绪后立即检查一次，之后按固定周期检查（仅主窗口）。
  useEffect(() => {
    if (
      surface !== "main" ||
      !hasLoadedSettings ||
      !hasLoadedPromptState ||
      !settings.update.automaticCheck ||
      !isTauri()
    )
      return;

    if (!hasRunInitialCheckRef.current) {
      hasRunInitialCheckRef.current = true;
      void runAutomaticUpdateCheck();
    }

    const interval = window.setInterval(
      () => void runAutomaticUpdateCheck(),
      AUTO_UPDATE_CHECK_INTERVAL_MS,
    );
    return () => window.clearInterval(interval);
  }, [
    hasLoadedPromptState,
    hasLoadedSettings,
    runAutomaticUpdateCheck,
    settings.update.automaticCheck,
    surface,
  ]);

  /** 写入提示簿记的唯一入口：状态同一份 ref 与 state 必须同步更新。 */
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

      commitPromptState({
        ...promptStateRef.current,
        lastNotifiedVersion: version,
        skippedVersion: version,
      });
      showToast(t("settings.updates.toasts.skipped", { version }));
    },
    [commitPromptState, showToast],
  );

  // 关闭提示：记录已提示版本；「跳过」交给 skipUpdateVersion，保证两个入口写同一种状态。
  const resolveUpdateNotice = useCallback(
    async (choice: UpdateNoticeChoice, version: string) => {
      if (choice === "skip") {
        await skipUpdateVersion(version);
        return;
      }

      commitPromptState({ ...promptStateRef.current, lastNotifiedVersion: version });

      // 「立即更新」或开启自动下载时，提示关闭后立刻转入后台下载。
      if (choice === "update" || settings.update.automaticDownload) {
        void downloadUpdate();
      }
    },
    [commitPromptState, downloadUpdate, settings.update.automaticDownload, skipUpdateVersion],
  );

  const updateNotice = useMemo(() => {
    const entry = readReleaseNotesEntry(updateStatus);
    const presentation = selectUpdatePresentation({
      status: updateStatus,
      promptState,
      hasPaintedFirstFrame,
      hasReleaseNotes: entry !== null,
    });
    if (presentation.notice !== "release-notes") {
      return null;
    }
    const version = normalizeVersion(updateStatus.latestVersion);
    if (!version) {
      return null;
    }
    return { version, entry };
  }, [hasPaintedFirstFrame, promptState, updateStatus]);

  // 第二段提醒：下载完成后只提示一次 toast，不再弹模态打断。
  useEffect(() => {
    const version = normalizeVersion(updateStatus.latestVersion);
    if (updateStatus.state !== "downloaded" || !version) return;
    if (toastedVersionsRef.current.has(version)) return;

    toastedVersionsRef.current.add(version);
    showToast(t("settings.updates.toasts.downloaded", { version }));
  }, [showToast, updateStatus.latestVersion, updateStatus.state]);

  const value: AppSettingsContextValue = {
    settings,
    hasLoadedSettings,
    updateStatus,
    isSettingsOpen,
    openSettings,
    closeSettings,
    checkForUpdate,
    relaunchUpdate,
    downloadUpdate,
    applyDownloadedUpdate,
    updateNotice,
    resolveUpdateNotice,
    skipUpdateVersion,
    updatePromptState: promptState,
    lastCheckedAt,
  };

  return <AppSettingsContext.Provider value={value}>{children}</AppSettingsContext.Provider>;
}

function formatUpdateCheckError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
