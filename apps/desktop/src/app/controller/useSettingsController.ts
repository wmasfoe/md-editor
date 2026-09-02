import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { AiSettings } from "@md-editor/ai";
import {
  cancelLocalAiModelDownload,
  checkLocalAiModelsRemoteUpdate,
  deleteLocalAiModel,
  downloadLocalAiModel,
  listenToLocalAiModelProgress,
  mergeLocalAiModelStatus,
  readAllLocalAiModelsStatus,
  readSystemSpecs,
  type LocalAiModelCommandStatus,
  type SystemSpecs,
} from "../ai/local-ai-model";

import {
  destroyCurrentSettingsWindow,
  revealCurrentSettingsWindow,
} from "../../desktop/settings-window";
import {
  keyboardShortcutLabel,
  createAppThemePreviewSession,
  listenToAppSettingsChanged,
  normalizeAiSettings,
  normalizeShortcutKey,
  saveAppSettings,
  validateAssetsDirectory,
  type AppSettings,
  type EditorDisplaySettings,
  type AppThemeSettings,
  type AppUpdateSettings,
  type ShortcutSetting,
} from "../settings/app-settings";
import {
  applyCustomThemeCss,
  applyThemeBeforeWindowReveal,
  pickThemeCssFile,
  rememberThemeCssFile,
} from "../settings/theme-css";
import { formatActionError } from "@md-editor/editor-ui";
import { useAppSettings } from "../settings-context";

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
  showSavedToast,
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
  const didClose = await closeSettingsWindow();
  if (!didClose) showSavedToast();
}

export function useSettingsController({
  showToast,
  surface = "main",
}: UseSettingsControllerOptions) {
  const {
    settings: loadedSettings,
    hasLoadedSettings,
    updateStatus,
    closeSettings: closeEmbedded,
    checkForUpdate,
    downloadUpdate,
    applyDownloadedUpdate,
  } = useAppSettings();

  // 草稿状态：用已加载设置初始化，对齐 loadedSettings 变化
  const [shortcutDrafts, setShortcutDrafts] = useState<Readonly<Record<string, string>>>(() =>
    createShortcutDrafts(loadedSettings.shortcuts),
  );
  const [assetsDirectoryDraft, setAssetsDirectoryDraft] = useState(loadedSettings.assetsDirectory);
  const [editorSettingsDraft, setEditorSettingsDraft] = useState<EditorDisplaySettings>(
    loadedSettings.editor,
  );
  const [themeDraft, setThemeDraft] = useState<AppThemeSettings>(loadedSettings.theme);
  const [aiSettingsDraft, setAiSettingsDraft] = useState<AiSettings>(() => loadedSettings.ai);
  const [updateSettingsDraft, setUpdateSettingsDraft] = useState<AppUpdateSettings>(
    loadedSettings.update,
  );
  const [settingsErrorMessage, setSettingsErrorMessage] = useState<string | null>(null);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [isLocalModelActionPending, setIsLocalModelActionPending] = useState(false);
  const [systemSpecs, setSystemSpecs] = useState<SystemSpecs | null>(null);
  const [allModelStatuses, setAllModelStatuses] = useState<
    Record<string, LocalAiModelCommandStatus>
  >({});
  const [isCheckingModelUpdates, setIsCheckingModelUpdates] = useState(false);
  const hasInitialized = useRef(false);
  const hasRevealedSettingsWindow = useRef(false);
  const [themePreviewSession] = useState(() => createAppThemePreviewSession());

  useEffect(() => {
    let cancelled = false;
    void readSystemSpecs().then((specs) => {
      if (!cancelled && specs) setSystemSpecs(specs);
    });
    void readAllLocalAiModelsStatus().then((statuses) => {
      if (!cancelled) {
        const map: Record<string, LocalAiModelCommandStatus> = {};
        for (const s of statuses) {
          map[s.modelId] = s;
        }
        setAllModelStatuses(map);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const syncDrafts = useCallback((next: AppSettings) => {
    setShortcutDrafts(createShortcutDrafts(next.shortcuts));
    setAssetsDirectoryDraft(next.assetsDirectory);
    setEditorSettingsDraft(next.editor);
    setThemeDraft(next.theme);
    setAiSettingsDraft(next.ai);
    setUpdateSettingsDraft(next.update);
  }, []);

  // 设置窗口首次挂载时对齐草稿（主窗口内嵌模式每次打开时调用 syncDrafts）
  useEffect(() => {
    if (!hasLoadedSettings) return;
    if (!hasInitialized.current) {
      hasInitialized.current = true;
      syncDrafts(loadedSettings);
    }
  }, [hasLoadedSettings, loadedSettings, syncDrafts]);

  // 跨窗口同步：settings-window 保存后，主窗口收到广播并对齐草稿
  useEffect(() => {
    if (surface !== "main") return;
    return listenToAppSettingsChanged((next) => syncDrafts(next));
  }, [surface, syncDrafts]);

  const applyLocalModelStatus = useCallback((status: LocalAiModelCommandStatus) => {
    // 模型状态从命令结果和进度事件两路进入，同步到全量字典与当前选中草稿
    setAllModelStatuses((prev) => ({
      ...prev,
      [status.modelId]: status,
    }));
    setAiSettingsDraft((current) => {
      if (current.localModel.modelId === status.modelId) {
        return {
          ...current,
          localModel: mergeLocalAiModelStatus(current.localModel, status),
        };
      }
      return current;
    });
  }, []);

  // 设置窗口主题草稿实时广播给主窗口预览
  useEffect(() => {
    if (surface !== "settings-window" || !hasInitialized.current) return;
    void themePreviewSession.publish(themeDraft).catch((error: unknown) => {
      console.warn("主题预览广播失败", error);
    });
  }, [surface, themeDraft, themePreviewSession]);

  // 应用主题 CSS（设置窗口或内嵌设置页打开时应用草稿主题）
  useLayoutEffect(() => {
    if (surface !== "settings-window") return;
    if (!hasRevealedSettingsWindow.current) {
      hasRevealedSettingsWindow.current = true;
      const initialTheme = applyThemeBeforeWindowReveal(themeDraft, revealCurrentSettingsWindow);
      let didReveal = false;
      void initialTheme.revealed
        .then(() => {
          didReveal = true;
        })
        .catch((error: unknown) => {
          setSettingsErrorMessage(formatActionError(error, "设置窗口显示失败。"));
        });
      return () => {
        initialTheme.dispose();
        // React StrictMode 会重放 layout effect；未显示时允许下一次 setup 重新承担 reveal。
        if (!didReveal) hasRevealedSettingsWindow.current = false;
      };
    }

    return applyCustomThemeCss(themeDraft);
  }, [surface, themeDraft]);

  // 本地模型进度监听
  useEffect(() => {
    return listenToLocalAiModelProgress((status) => {
      applyLocalModelStatus(status);
      if (status.status === "failed") {
        setSettingsErrorMessage(
          status.error === LOCAL_MODEL_CANCEL_MESSAGE
            ? null
            : (status.error ?? "本地模型状态更新失败。"),
        );
      } else {
        setSettingsErrorMessage(null);
      }
    });
  }, [applyLocalModelStatus]);

  const restoreSavedThemePreview = useCallback(async () => {
    await themePreviewSession.publish(null);
  }, [themePreviewSession]);

  const closeSettings = useCallback(() => {
    if (surface === "settings-window") {
      void restoreSavedThemePreview()
        .then(() => destroyCurrentSettingsWindow())
        .catch((error: unknown) => {
          setSettingsErrorMessage(formatActionError(error, "设置窗口关闭失败。"));
        });
      return;
    }
    closeEmbedded();
    setSettingsErrorMessage(null);
    syncDrafts(loadedSettings);
    void restoreSavedThemePreview().catch((error: unknown) => {
      console.warn("主题预览回滚失败", error);
    });
  }, [closeEmbedded, loadedSettings, restoreSavedThemePreview, surface, syncDrafts]);

  const destroySettingsWindowAfterRollback = useCallback(async () => {
    await restoreSavedThemePreview();
    await destroyCurrentSettingsWindow();
  }, [restoreSavedThemePreview]);

  const captureShortcutDraft = useCallback((id: string, key: string) => {
    setShortcutDrafts((current) => ({ ...current, [id]: keyboardShortcutLabel(key) }));
  }, []);

  const resetShortcutDraft = useCallback(
    (id: string) => {
      const shortcut = loadedSettings.shortcuts.find((s) => s.id === id);
      if (!shortcut) return;
      setShortcutDrafts((current) => ({
        ...current,
        [id]: keyboardShortcutLabel(shortcut.defaultKey),
      }));
    },
    [loadedSettings.shortcuts],
  );

  const saveSettings = useCallback(async () => {
    const nextAssetsDirectory = validateAssetsDirectory(assetsDirectoryDraft);
    if (!nextAssetsDirectory) {
      setSettingsErrorMessage(
        "图片资源目录必须是当前文档目录内的子目录，例如 assets 或 images/posts。",
      );
      return;
    }

    const normalizedShortcuts: ShortcutSetting[] = [];
    for (const shortcut of loadedSettings.shortcuts) {
      const key = normalizeShortcutKey(shortcutDrafts[shortcut.id] ?? shortcut.key);
      if (!key) {
        setSettingsErrorMessage(
          `"${shortcut.label}"快捷键格式无效，请使用 Command+Shift+B 这类组合。`,
        );
        return;
      }
      normalizedShortcuts.push({ ...shortcut, key });
    }
    const duplicate = findDuplicateShortcut(normalizedShortcuts.map((s) => s.key));
    if (duplicate) {
      setSettingsErrorMessage(`快捷键 ${keyboardShortcutLabel(duplicate)} 被重复使用。`);
      return;
    }

    setIsSavingSettings(true);
    setSettingsErrorMessage(null);
    try {
      await saveAppSettings({
        shortcuts: normalizedShortcuts,
        assetsDirectory: nextAssetsDirectory,
        editor: editorSettingsDraft,
        theme: themeDraft,
        ai: normalizeAiSettings(aiSettingsDraft),
        update: updateSettingsDraft,
      });
      await themePreviewSession.publish(null);
      // saveAppSettings 广播 listenToAppSettingsChanged，Context 会自动更新 settings
      try {
        await closeSettingsSurfaceAfterSave({
          surface,
          closeEmbeddedSettings: closeEmbedded,
          closeSettingsWindow: destroyCurrentSettingsWindow,
          showSavedToast: () => showToast("设置已保存。"),
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
    closeEmbedded,
    editorSettingsDraft,
    loadedSettings.shortcuts,
    shortcutDrafts,
    showToast,
    surface,
    themeDraft,
    themePreviewSession,
    updateSettingsDraft,
  ]);

  const chooseThemeCss = useCallback(async (scheme: "light" | "dark") => {
    setSettingsErrorMessage(null);
    try {
      const file = await pickThemeCssFile();
      if (!file) return;
      rememberThemeCssFile(file);
      setThemeDraft((current) =>
        scheme === "dark"
          ? { ...current, dark: { ...current.dark, source: "custom", customCssPath: file.path } }
          : { ...current, light: { ...current.light, source: "custom", customCssPath: file.path } },
      );
    } catch (error) {
      setSettingsErrorMessage(error instanceof Error ? error.message : "主题 CSS 选择失败。");
    }
  }, []);

  const clearThemeCss = useCallback((scheme: "light" | "dark") => {
    setThemeDraft((current) =>
      scheme === "dark"
        ? { ...current, dark: { ...current.dark, source: "builtin", customCssPath: null } }
        : { ...current, light: { ...current.light, source: "builtin", customCssPath: null } },
    );
  }, []);

  const downloadLocalModel = useCallback(
    async (targetModelId?: string) => {
      const modelId = targetModelId || aiSettingsDraft.localModel.modelId;
      setSettingsErrorMessage(null);
      const existingStatus = allModelStatuses[modelId] || loadedSettings.ai.localModel;
      applyLocalModelStatus({
        ...existingStatus,
        modelId,
        status: "downloading",
        downloadedBytes: 0,
        error: null,
      });
      try {
        const status = await downloadLocalAiModel(modelId);
        applyLocalModelStatus(status);
      } catch (error) {
        if (isLocalModelDownloadCancel(error)) {
          setSettingsErrorMessage(null);
          return;
        }
        setSettingsErrorMessage(formatActionError(error, "本地模型下载失败。"));
      }
    },
    [
      aiSettingsDraft.localModel.modelId,
      allModelStatuses,
      applyLocalModelStatus,
      loadedSettings.ai.localModel,
    ],
  );

  const cancelLocalModelDownload = useCallback(
    async (targetModelId?: string) => {
      const modelId = targetModelId || aiSettingsDraft.localModel.modelId;
      setIsLocalModelActionPending(true);
      setSettingsErrorMessage(null);
      try {
        const status = await cancelLocalAiModelDownload(modelId);
        applyLocalModelStatus(status);
        showToast(LOCAL_MODEL_CANCEL_MESSAGE);
      } catch (error) {
        setSettingsErrorMessage(formatActionError(error, "取消本地模型下载失败。"));
      } finally {
        setIsLocalModelActionPending(false);
      }
    },
    [aiSettingsDraft.localModel.modelId, applyLocalModelStatus, showToast],
  );

  const deleteLocalModel = useCallback(
    async (targetModelId?: string) => {
      const modelId = targetModelId || aiSettingsDraft.localModel.modelId;
      setIsLocalModelActionPending(true);
      setSettingsErrorMessage(null);
      try {
        const status = await deleteLocalAiModel(modelId);
        applyLocalModelStatus(status);
        showToast("本地模型已删除，已释放磁盘空间。");
      } catch (error) {
        setSettingsErrorMessage(formatActionError(error, "本地模型删除失败。"));
      } finally {
        setIsLocalModelActionPending(false);
      }
    },
    [aiSettingsDraft.localModel.modelId, applyLocalModelStatus, showToast],
  );

  const checkLocalModelUpdates = useCallback(async () => {
    setIsCheckingModelUpdates(true);
    try {
      const statuses = await checkLocalAiModelsRemoteUpdate();
      const map: Record<string, LocalAiModelCommandStatus> = {};
      let updateCount = 0;

      for (const s of statuses) {
        map[s.modelId] = s;
        if (s.hasUpdate) updateCount += 1;
      }
      setAllModelStatuses(map);
      if (updateCount > 0) {
        showToast(`发现 ${updateCount} 个模型有新版本，可点击「更新模型」进行更新。`);
      } else {
        showToast("当前已是最新模型，暂无可用更新。");
      }
    } catch {
      showToast("检查模型更新失败，请稍后重试。");
    } finally {
      setIsCheckingModelUpdates(false);
    }
  }, [showToast]);

  const runUpdateCheck = useCallback(async () => {
    setSettingsErrorMessage(null);
    await checkForUpdate();
  }, [checkForUpdate]);

  const installUpdate = useCallback(async () => {
    setSettingsErrorMessage(null);
    const result =
      updateStatus.state === "downloaded"
        ? await applyDownloadedUpdate()
        : await downloadUpdate().then((downloaded) =>
            downloaded.state === "downloaded" ? applyDownloadedUpdate() : downloaded,
          );
    if (result.state === "installed") {
      showToast("更新已安装，重启应用后生效。");
    }
  }, [applyDownloadedUpdate, downloadUpdate, showToast, updateStatus.state]);

  return {
    shortcutDrafts,
    assetsDirectoryDraft,
    editorSettingsDraft,
    themeDraft,
    aiSettingsDraft,
    updateSettingsDraft,
    isLocalModelActionPending,
    systemSpecs,
    allModelStatuses,
    isCheckingModelUpdates,
    settingsErrorMessage,
    isSavingSettings,
    setAssetsDirectoryDraft,
    setEditorSettingsDraft,
    setThemeDraft,
    setAiSettingsDraft,
    setUpdateSettingsDraft,
    chooseThemeCss,
    clearThemeCss,
    closeSettings,
    destroySettingsWindowAfterRollback,
    captureShortcutDraft,
    resetShortcutDraft,
    saveSettings,
    downloadLocalModel,
    cancelLocalModelDownload,
    deleteLocalModel,
    checkLocalModelUpdates,
    runUpdateCheck,
    downloadUpdate,
    applyDownloadedUpdate,
    installUpdate,
  };
}

function createShortcutDrafts(
  shortcuts: readonly ShortcutSetting[],
): Readonly<Record<string, string>> {
  return Object.fromEntries(shortcuts.map((s) => [s.id, keyboardShortcutLabel(s.key)]));
}

function findDuplicateShortcut(shortcuts: readonly string[]): string | null {
  const seen = new Set<string>();
  for (const key of shortcuts) {
    if (seen.has(key)) return key;
    seen.add(key);
  }
  return null;
}

function isLocalModelDownloadCancel(error: unknown): boolean {
  return error instanceof Error
    ? error.message.includes(LOCAL_MODEL_CANCEL_MESSAGE)
    : String(error).includes(LOCAL_MODEL_CANCEL_MESSAGE);
}
