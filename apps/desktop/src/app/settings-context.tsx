import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import {
  appVersion,
  createDefaultSettings,
  loadAppSettings,
  listenToAppSettingsChanged,
  listenToAppThemePreviewChanged,
  type AppSettings,
  type UpdateStatus
} from "./settings/app-settings";
import { applyCustomThemeCss } from "./settings/theme-css";
import {
  checkForInstallableUpdate,
  downloadPendingUpdate,
  installDownloadedUpdate,
  installPendingUpdate,
  relaunchAfterUpdate
} from "./updates/app-updater";
import {
  isUpdateActionBusy,
  isUpdateReadyToApply
} from "./updates/update-status";
import { openSettingsWindow } from "../desktop/settings-window";
import { mergeLocalAiModelStatus, readLocalAiModelStatus } from "./ai/local-ai-model";

const AUTO_UPDATE_INITIAL_CHECK_DELAY_MS = 30_000;
const AUTO_UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

export interface AppSettingsContextValue {
  readonly settings: AppSettings;
  readonly updateStatus: UpdateStatus;
  readonly isSettingsOpen: boolean;
  readonly openSettings: () => void;
  readonly closeSettings: () => void;
  readonly relaunchUpdate: () => Promise<void>;
  readonly downloadUpdate: () => Promise<UpdateStatus>;
  readonly applyDownloadedUpdate: () => Promise<UpdateStatus>;
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
    state: "idle"
  }));
  const updateStatusRef = useRef<UpdateStatus>(updateStatus);
  const isAutoUpdateRunningRef = useRef(false);

  useEffect(() => {
    updateStatusRef.current = updateStatus;
  }, [updateStatus]);

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
            ai: { ...loaded.ai, localModel: mergeLocalAiModelStatus(loaded.ai.localModel, modelStatus) }
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
    return () => { cancelled = true; };
  }, [showToast]);

  // 跨窗口设置同步（另一窗口保存后广播）
  useEffect(() => listenToAppSettingsChanged(setSettings), []);

  // 主窗口接收设置窗口的主题预览
  useEffect(() => {
    if (surface !== "main") return;
    return listenToAppThemePreviewChanged(setPreviewTheme);
  }, [surface]);

  // 应用主题 CSS（非预览：已保存主题或跨窗口预览）
  useEffect(() => {
    if (surface === "settings-window" || isSettingsOpen) return;
    applyCustomThemeCss(previewTheme ?? settings.theme);
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
      state: "installing"
    };
    setUpdateStatus(installingStatus);
    const result = await installDownloadedUpdate();
    setUpdateStatus(result);
    return result;
  }, []);

  const relaunchUpdate = useCallback(async () => {
    await relaunchAfterUpdate();
  }, []);

  const installUpdate = useCallback(async () => {
    const current = updateStatusRef.current;
    const result = current.state === "downloaded"
      ? await installDownloadedUpdate()
      : await installPendingUpdate(setUpdateStatus);
    setUpdateStatus(result);
    if (result.state === "installed") {
      showToast("更新已安装，重启应用后生效。");
    }
  }, [showToast]);

  const runAutomaticUpdateCheck = useCallback(async () => {
    const current = updateStatusRef.current;
    if (
      !isTauri() ||
      !settings.update.automaticCheck ||
      isAutoUpdateRunningRef.current ||
      isUpdateActionBusy(current) ||
      isUpdateReadyToApply(current)
    ) return;

    isAutoUpdateRunningRef.current = true;
    try {
      if (current.state === "available" && current.installKind === "app") {
        if (!settings.update.automaticDownload) return;
        const downloaded = await downloadPendingUpdate(setUpdateStatus);
        if (downloaded.state === "error") {
          console.warn("自动下载更新失败", downloaded.error ?? downloaded.state);
          setUpdateStatus(current);
          return;
        }
        setUpdateStatus(downloaded);
        return;
      }

      const next = await checkForInstallableUpdate(appVersion());
      if (next.state === "error" || next.state === "unconfigured") {
        console.warn("自动检测更新失败", next.error ?? next.state);
        return;
      }
      setUpdateStatus(next);
      if (next.state === "available" && next.installKind === "app" && settings.update.automaticDownload) {
        const downloaded = await downloadPendingUpdate(setUpdateStatus);
        if (downloaded.state === "error") {
          console.warn("自动下载更新失败", downloaded.error ?? downloaded.state);
          setUpdateStatus(next);
          return;
        }
        setUpdateStatus(downloaded);
      }
    } catch (error) {
      console.warn("自动检测更新失败", error);
    } finally {
      isAutoUpdateRunningRef.current = false;
    }
  }, [settings.update.automaticCheck, settings.update.automaticDownload]);

  // 自动更新定时器（仅主窗口）
  useEffect(() => {
    if (surface !== "main" || !hasLoadedSettings || !settings.update.automaticCheck || !isTauri()) return;
    const initial = window.setTimeout(() => void runAutomaticUpdateCheck(), AUTO_UPDATE_INITIAL_CHECK_DELAY_MS);
    const interval = window.setInterval(() => void runAutomaticUpdateCheck(), AUTO_UPDATE_CHECK_INTERVAL_MS);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(interval);
    };
  }, [hasLoadedSettings, runAutomaticUpdateCheck, settings.update.automaticCheck, surface]);

  const value: AppSettingsContextValue = {
    settings,
    updateStatus,
    isSettingsOpen,
    openSettings,
    closeSettings,
    relaunchUpdate,
    downloadUpdate,
    applyDownloadedUpdate,
  };

  return (
    <AppSettingsContext.Provider value={value}>
      {children}
    </AppSettingsContext.Provider>
  );
}

// installUpdate 暴露给 SettingsPage 内部使用，不放进主 Context（避免 API 膨胀）
// 通过 useSettingsController 直接调用 installDownloadedUpdate/installPendingUpdate 即可
