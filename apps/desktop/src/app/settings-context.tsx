import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  createAppThemePreviewCoordinator,
  createAppEditorPreviewCoordinator,
  createDefaultSettings,
  loadAppSettings,
  listenToAppSettingsChanged,
  listenToAppThemePreviewChanged,
  listenToAppEditorPreviewChanged,
  listenToAppLanguagePreviewChanged,
  type AppSettings,
  type UpdateStatus,
} from "./settings/app-settings";
import { applyCustomThemeCss } from "./settings/theme-css";
import type { UpdatePromptState } from "./updates/prompt-state";
import type { UpdateNoticeChoice } from "./updates/presentation";
import { useAppUpdates, type UpdateNotice } from "./updates/use-app-updates";
import { openSettingsWindow } from "../desktop/settings-window";
import { mergeLocalAiModelStatus, readLocalAiModelStatus } from "./ai/local-ai-model";
import { changeLanguage, configureI18n } from "@md-editor/i18n";
import { syncSentryWithSettings } from "./error-reporting/sentry";

// Markdown lint 的诊断文案按 `document.documentElement.lang` 选择语言，
// 因此本应用需要 i18n 在切换语言时同步该属性（库默认不碰宿主全局 DOM）。
// 放在这里而非入口 main.tsx：入口若静态 import i18n，会把四份语言包拉进启动路径。
configureI18n({ syncDocumentLang: true });

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
  /** 需要展示「本次更新内容」时非 null；同版本处理后不再出现 */
  readonly updateNotice: UpdateNotice | null;
  readonly resolveUpdateNotice: (choice: UpdateNoticeChoice, version: string) => Promise<void>;
  /** 跳过当前最新版本：之后不再自动提示/自动下载该版本（手动检查仍可见） */
  readonly skipUpdateVersion: (version?: string) => Promise<void>;
  /** 提示簿记（已提示/已跳过），设置页据此隐藏已经生效的动作 */
  readonly updatePromptState: UpdatePromptState;
  /** 最近一次检查完成时间（ISO 字符串，展示时再按语言格式化）；从未检查为 null */
  readonly lastCheckedAt: string | null;
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
  const [previewEditor, setPreviewEditor] = useState<AppSettings["editor"] | null>(null);
  const [hasLoadedSettings, setHasLoadedSettings] = useState(false);

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

  // 主窗口接收设置窗口的编辑器排版与字体预览
  useEffect(() => {
    if (surface !== "main") return;
    const coordinator = createAppEditorPreviewCoordinator({
      loadPersistedSettings: loadAppSettings,
      onPersistedSettings: setSettings,
      onPreviewEditor: setPreviewEditor,
    });
    const stopListening = listenToAppEditorPreviewChanged((event) => {
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

  // 应用内更新状态机：主窗口执行，设置窗口镜像（见 updates/use-app-updates.ts）。
  const updates = useAppUpdates({
    surface,
    updateSettings: settings.update,
    hasLoadedSettings,
    showToast,
  });

  const effectiveSettings = useMemo(
    () => ({
      ...settings,
      theme: previewTheme ?? settings.theme,
      editor: previewEditor ?? settings.editor,
    }),
    [settings, previewEditor, previewTheme],
  );

  const value: AppSettingsContextValue = {
    ...updates,
    settings: effectiveSettings,
    hasLoadedSettings,
    isSettingsOpen,
    openSettings,
    closeSettings,
  };

  return <AppSettingsContext.Provider value={value}>{children}</AppSettingsContext.Provider>;
}
