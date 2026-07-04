import { useCallback, useEffect, useRef, useState } from "react";
import type { AiSettings } from "@md-editor/editor-core";
import {
  cancelLocalAiModelDownload,
  deleteLocalAiModel,
  downloadLocalAiModel,
  listenToLocalAiModelProgress,
  mergeLocalAiModelStatus,
  readLocalAiModelStatus,
  type LocalAiModelCommandStatus
} from "../ai/local-ai-model";
import {
  destroyCurrentSettingsWindow,
  openSettingsWindow
} from "../../desktop/settings-window";
import {
  appVersion,
  createDefaultSettings,
  keyboardShortcutLabel,
  loadAppSettings,
  listenToAppSettingsChanged,
  listenToAppThemePreviewChanged,
  normalizeAiSettings,
  normalizeShortcutKey,
  publishAppThemePreviewChanged,
  saveAppSettings,
  validateAssetsDirectory,
  type AppSettings,
  type EditorDisplaySettings,
  type AppThemeSettings,
  type ShortcutSetting,
  type UpdateStatus
} from "../settings/app-settings";
import { applyCustomThemeCss, pickThemeCssFile, rememberThemeCssFile } from "../settings/theme-css";
import {
  checkForInstallableUpdate,
  installPendingUpdate,
  relaunchAfterUpdate
} from "../updates/app-updater";
import { formatActionError } from "./controller-errors";

const LOCAL_MODEL_CANCEL_MESSAGE = "本地模型下载已取消。";

type SettingsSurface = "main" | "settings-window";

interface UseSettingsControllerOptions {
  readonly showToast: (message: string | null) => void;
  readonly surface?: SettingsSurface;
}

export async function closeSettingsSurfaceAfterSave({
  surface,
  closeEmbeddedSettings,
  closeSettingsWindow,
  showSavedToast
}: {
  readonly surface: SettingsSurface;
  readonly closeEmbeddedSettings: () => void;
  readonly closeSettingsWindow: () => Promise<boolean>;
  readonly showSavedToast: () => void;
}): Promise<void> {
  if (surface === "main") {
    closeEmbeddedSettings();
    return;
  }

  const didCloseWindow = await closeSettingsWindow();
  if (!didCloseWindow) {
    showSavedToast();
  }
}

export function useSettingsController({ showToast, surface = "main" }: UseSettingsControllerOptions) {
  const [settings, setSettings] = useState<AppSettings>(() => createDefaultSettings());
  const [isSettingsOpen, setIsSettingsOpen] = useState(surface === "settings-window");
  const [shortcutDrafts, setShortcutDrafts] = useState<Readonly<Record<string, string>>>(() =>
    createShortcutDrafts(createDefaultSettings().shortcuts)
  );
  const [assetsDirectoryDraft, setAssetsDirectoryDraft] = useState(createDefaultSettings().assetsDirectory);
  const [editorSettingsDraft, setEditorSettingsDraft] = useState<EditorDisplaySettings>(
    createDefaultSettings().editor
  );
  const [themeDraft, setThemeDraft] = useState<AppThemeSettings>(createDefaultSettings().theme);
  const [aiSettingsDraft, setAiSettingsDraft] = useState<AiSettings>(() => createDefaultSettings().ai);
  const [settingsErrorMessage, setSettingsErrorMessage] = useState<string | null>(null);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [isLocalModelActionPending, setIsLocalModelActionPending] = useState(false);
  const [previewTheme, setPreviewTheme] = useState<AppThemeSettings | null>(null);
  const hasLoadedSettingsRef = useRef(false);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>(() => ({
    currentVersion: appVersion(),
    state: "idle",
    message: "点击检查更新获取当前发布状态。"
  }));

  const syncSettingsDrafts = useCallback((nextSettings: AppSettings) => {
    // 设置弹窗编辑的是草稿；保存或取消时必须和权威 settings 重新对齐。
    setShortcutDrafts(createShortcutDrafts(nextSettings.shortcuts));
    setAssetsDirectoryDraft(nextSettings.assetsDirectory);
    setEditorSettingsDraft(nextSettings.editor);
    setThemeDraft(nextSettings.theme);
    setAiSettingsDraft(nextSettings.ai);
  }, []);

  const applyLocalModelStatus = useCallback((status: LocalAiModelCommandStatus) => {
    // 本地模型状态会从命令结果和后台进度事件两路进入，需要同步到 settings 与弹窗草稿。
    setSettings((current) => ({
      ...current,
      ai: {
        ...current.ai,
        localModel: mergeLocalAiModelStatus(current.ai.localModel, status)
      }
    }));
    setAiSettingsDraft((current) => ({
      ...current,
      localModel: mergeLocalAiModelStatus(current.localModel, status)
    }));
  }, []);

  const openSettings = useCallback(() => {
    if (surface === "main") {
      // 主窗口不再承载设置 UI；Tauri 桌面端打开独立设置窗口，Web 预览失败时才回退到内嵌页。
      void openSettingsWindow()
        .then((didOpenWindow) => {
          if (didOpenWindow) {
            return;
          }
          syncSettingsDrafts(settings);
          setSettingsErrorMessage(null);
          setIsSettingsOpen(true);
        })
        .catch((error: unknown) => {
          showToast(formatActionError(error, "设置窗口打开失败。"));
        });
      return;
    }

    syncSettingsDrafts(settings);
    setSettingsErrorMessage(null);
    setIsSettingsOpen(true);
  }, [settings, showToast, surface, syncSettingsDrafts]);

  const restoreSavedThemePreview = useCallback(async () => {
    // 主题预览不会写入存储；关闭/取消设置时要广播已保存主题，让主窗口退出草稿预览。
    setPreviewTheme(null);
    await publishAppThemePreviewChanged(settings.theme);
  }, [settings.theme]);

  const closeSettings = useCallback(() => {
    if (surface === "settings-window") {
      // 取消设置时需要先回滚跨窗口主题预览，再关闭当前原生设置窗口。
      void restoreSavedThemePreview()
        .then(() => destroyCurrentSettingsWindow())
        .catch((error: unknown) => {
          setSettingsErrorMessage(formatActionError(error, "设置窗口关闭失败。"));
        });
      return;
    }

    setIsSettingsOpen(false);
    setSettingsErrorMessage(null);
    syncSettingsDrafts(settings);
    void restoreSavedThemePreview().catch((error: unknown) => {
      console.warn("主题预览回滚失败", error);
    });
  }, [restoreSavedThemePreview, settings, surface, syncSettingsDrafts]);

  const destroySettingsWindowAfterRollback = useCallback(async () => {
    await restoreSavedThemePreview();
    await destroyCurrentSettingsWindow();
  }, [restoreSavedThemePreview]);

  const captureShortcutDraft = useCallback((id: string, key: string) => {
    setShortcutDrafts((current) => ({ ...current, [id]: keyboardShortcutLabel(key) }));
  }, []);

  const resetShortcutDraft = useCallback(
    (id: string) => {
      const shortcut = settings.shortcuts.find((candidate) => candidate.id === id);
      if (!shortcut) {
        return;
      }
      setShortcutDrafts((current) => ({ ...current, [id]: keyboardShortcutLabel(shortcut.defaultKey) }));
    },
    [settings.shortcuts]
  );

  const saveSettings = useCallback(async () => {
    const nextAssetsDirectory = validateAssetsDirectory(assetsDirectoryDraft);
    if (!nextAssetsDirectory) {
      setSettingsErrorMessage("图片资源目录必须是当前文档目录内的子目录，例如 assets 或 images/posts。");
      return;
    }

    // 快捷键保存前统一校验，避免两个命令在全局 keydown 捕获阶段抢同一个组合。
    const normalizedShortcuts: ShortcutSetting[] = [];
    for (const shortcut of settings.shortcuts) {
      const key = normalizeShortcutKey(shortcutDrafts[shortcut.id] ?? shortcut.key);
      if (!key) {
        setSettingsErrorMessage(`“${shortcut.label}”快捷键格式无效，请使用 Command+Shift+B 这类组合。`);
        return;
      }
      normalizedShortcuts.push({ ...shortcut, key });
    }
    const duplicate = findDuplicateShortcut(normalizedShortcuts.map((shortcut) => shortcut.key));
    if (duplicate) {
      setSettingsErrorMessage(`快捷键 ${keyboardShortcutLabel(duplicate)} 被重复使用。`);
      return;
    }

    setIsSavingSettings(true);
    setSettingsErrorMessage(null);
    try {
      const saved = await saveAppSettings({
        shortcuts: normalizedShortcuts,
        assetsDirectory: nextAssetsDirectory,
        editor: editorSettingsDraft,
        theme: themeDraft,
        ai: normalizeAiSettings(aiSettingsDraft)
      });
      setSettings(saved);
      syncSettingsDrafts(saved);
      setPreviewTheme(null);
      try {
        await closeSettingsSurfaceAfterSave({
          surface,
          closeEmbeddedSettings: () => setIsSettingsOpen(false),
          closeSettingsWindow: destroyCurrentSettingsWindow,
          showSavedToast: () => showToast("设置已保存。")
        });
      } catch (error) {
        setSettingsErrorMessage(formatActionError(error, "设置窗口关闭失败。"));
      }
    } catch (error) {
      setSettingsErrorMessage(error instanceof Error ? error.message : "设置保存失败。");
    } finally {
      setIsSavingSettings(false);
    }
  }, [
    aiSettingsDraft,
    assetsDirectoryDraft,
    editorSettingsDraft,
    settings.shortcuts,
    shortcutDrafts,
    showToast,
    surface,
    syncSettingsDrafts,
    themeDraft
  ]);

  const chooseThemeCss = useCallback(async (scheme: "light" | "dark") => {
    setSettingsErrorMessage(null);
    try {
      const file = await pickThemeCssFile();
      if (!file) {
        return;
      }
      rememberThemeCssFile(file);
      setThemeDraft((current) => scheme === "dark"
        ? { ...current, dark: { ...current.dark, source: "custom", customCssPath: file.path } }
        : { ...current, light: { ...current.light, source: "custom", customCssPath: file.path } });
    } catch (error) {
      setSettingsErrorMessage(error instanceof Error ? error.message : "主题 CSS 选择失败。");
    }
  }, []);

  const clearThemeCss = useCallback((scheme: "light" | "dark") => {
    setThemeDraft((current) => scheme === "dark"
      ? { ...current, dark: { ...current.dark, source: "builtin", customCssPath: null } }
      : { ...current, light: { ...current.light, source: "builtin", customCssPath: null } });
  }, []);

  const downloadLocalModel = useCallback(async () => {
    setSettingsErrorMessage(null);
    applyLocalModelStatus({
      ...settings.ai.localModel,
      displayName: "md-editor Writer Small",
      path: null,
      status: "downloading",
      downloadedBytes: 0,
      error: null
    });
    try {
      const status = await downloadLocalAiModel(settings.ai.localModel.modelId);
      applyLocalModelStatus(status);
    } catch (error) {
      if (isLocalModelDownloadCancel(error)) {
        setSettingsErrorMessage(null);
        return;
      }
      setSettingsErrorMessage(formatActionError(error, "本地模型下载失败。"));
    }
  }, [applyLocalModelStatus, settings.ai.localModel]);

  const cancelLocalModelDownload = useCallback(async () => {
    setIsLocalModelActionPending(true);
    setSettingsErrorMessage(null);
    try {
      const status = await cancelLocalAiModelDownload(settings.ai.localModel.modelId);
      applyLocalModelStatus(status);
      showToast(LOCAL_MODEL_CANCEL_MESSAGE);
    } catch (error) {
      setSettingsErrorMessage(formatActionError(error, "取消本地模型下载失败。"));
    } finally {
      setIsLocalModelActionPending(false);
    }
  }, [applyLocalModelStatus, settings.ai.localModel.modelId, showToast]);

  const deleteLocalModel = useCallback(async () => {
    setIsLocalModelActionPending(true);
    setSettingsErrorMessage(null);
    try {
      const status = await deleteLocalAiModel(settings.ai.localModel.modelId);
      applyLocalModelStatus(status);
    } catch (error) {
      setSettingsErrorMessage(formatActionError(error, "本地模型删除失败。"));
    } finally {
      setIsLocalModelActionPending(false);
    }
  }, [applyLocalModelStatus, settings.ai.localModel.modelId]);

  const runUpdateCheck = useCallback(async () => {
    setUpdateStatus({
      currentVersion: appVersion(),
      state: "checking",
      message: "正在检查更新..."
    });
    setUpdateStatus(await checkForInstallableUpdate(appVersion()));
  }, []);

  const installUpdate = useCallback(async () => {
    setSettingsErrorMessage(null);
    const result = await installPendingUpdate(setUpdateStatus);
    setUpdateStatus(result);
    if (result.state === "installed") {
      showToast("更新已安装，重启应用后生效。");
    }
  }, [showToast]);

  const relaunchUpdate = useCallback(async () => {
    setSettingsErrorMessage(null);
    try {
      await relaunchAfterUpdate();
    } catch (error) {
      setSettingsErrorMessage(formatActionError(error, "重启应用失败。"));
    }
  }, []);

  useEffect(() => {
    // 设置异步加载；先用默认值渲染，加载成功后再重绑快捷键和图片目录。
    let cancelled = false;

    void loadAppSettings()
      .then(async (loadedSettings) => {
        if (cancelled) {
          return;
        }
        try {
          const localModelStatus = await readLocalAiModelStatus(loadedSettings.ai.localModel.modelId);
          const hydratedSettings: AppSettings = {
            ...loadedSettings,
            ai: {
              ...loadedSettings.ai,
              localModel: mergeLocalAiModelStatus(loadedSettings.ai.localModel, localModelStatus)
            }
          };
          if (cancelled) {
            return;
          }
          setSettings(hydratedSettings);
          syncSettingsDrafts(hydratedSettings);
          hasLoadedSettingsRef.current = true;
        } catch {
          setSettings(loadedSettings);
          syncSettingsDrafts(loadedSettings);
          hasLoadedSettingsRef.current = true;
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          showToast(error instanceof Error ? error.message : "设置读取失败。");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [showToast, syncSettingsDrafts]);

  useEffect(
    () =>
      listenToAppSettingsChanged((nextSettings) => {
        setSettings(nextSettings);
        syncSettingsDrafts(nextSettings);
        setPreviewTheme(null);
      }),
    [syncSettingsDrafts]
  );

  useEffect(
    () =>
      listenToAppThemePreviewChanged((nextTheme) => {
        setPreviewTheme(nextTheme);
      }),
    []
  );

  useEffect(() => {
    if (surface !== "settings-window" || !hasLoadedSettingsRef.current) {
      return;
    }

    // 设置窗口里的主题草稿要实时广播给主窗口预览，但仍然等保存时才进入 settings.json。
    void publishAppThemePreviewChanged(themeDraft).catch((error: unknown) => {
      console.warn("主题预览广播失败", error);
    });
  }, [surface, themeDraft]);

  useEffect(() => {
    return listenToLocalAiModelProgress((status) => {
      applyLocalModelStatus(status);
      if (status.status === "failed") {
        setSettingsErrorMessage(
          status.error === LOCAL_MODEL_CANCEL_MESSAGE ? null : status.error ?? "本地模型状态更新失败。"
        );
      } else {
        setSettingsErrorMessage(null);
      }
    });
  }, [applyLocalModelStatus]);

  useEffect(
    () => applyCustomThemeCss(isSettingsOpen || surface === "settings-window" ? themeDraft : previewTheme ?? settings.theme),
    [isSettingsOpen, previewTheme, settings.theme, surface, themeDraft]
  );

  return {
    settings,
    isSettingsOpen,
    shortcutDrafts,
    assetsDirectoryDraft,
    editorSettingsDraft,
    themeDraft,
    aiSettingsDraft,
    isLocalModelActionPending,
    settingsErrorMessage,
    isSavingSettings,
    updateStatus,
    setAssetsDirectoryDraft,
    setEditorSettingsDraft,
    setThemeDraft,
    setAiSettingsDraft,
    chooseThemeCss,
    clearThemeCss,
    openSettings,
    closeSettings,
    destroySettingsWindowAfterRollback,
    captureShortcutDraft,
    resetShortcutDraft,
    saveSettings,
    downloadLocalModel,
    cancelLocalModelDownload,
    deleteLocalModel,
    runUpdateCheck,
    installUpdate,
    relaunchUpdate
  };
}

function createShortcutDrafts(shortcuts: readonly ShortcutSetting[]): Readonly<Record<string, string>> {
  return Object.fromEntries(
    shortcuts.map((shortcut) => [shortcut.id, keyboardShortcutLabel(shortcut.key)])
  );
}

function findDuplicateShortcut(shortcuts: readonly string[]): string | null {
  const seen = new Set<string>();

  for (const shortcut of shortcuts) {
    if (seen.has(shortcut)) {
      return shortcut;
    }
    seen.add(shortcut);
  }

  return null;
}

function isLocalModelDownloadCancel(error: unknown): boolean {
  return error instanceof Error
    ? error.message.includes(LOCAL_MODEL_CANCEL_MESSAGE)
    : String(error).includes(LOCAL_MODEL_CANCEL_MESSAGE);
}
