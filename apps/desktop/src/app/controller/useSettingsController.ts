import { useCallback, useEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import type { AiSettings } from "@md-editor/editor-core";
import {
  cancelLocalAiModelDownload,
  deleteLocalAiModel,
  downloadLocalAiModel,
  listenToLocalAiModelProgress,
  mergeLocalAiModelStatus,
  type LocalAiModelCommandStatus
} from "../ai/local-ai-model";
import {
  destroyCurrentSettingsWindow
} from "../../desktop/settings-window";
import {
  appVersion,
  createDefaultSettings,
  keyboardShortcutLabel,
  listenToAppSettingsChanged,
  normalizeAiSettings,
  normalizeShortcutKey,
  publishAppThemePreviewChanged,
  saveAppSettings,
  validateAssetsDirectory,
  type AppSettings,
  type EditorDisplaySettings,
  type AppThemeSettings,
  type AppUpdateSettings,
  type ShortcutSetting,
  type UpdateStatus
} from "../settings/app-settings";
import { applyCustomThemeCss, pickThemeCssFile, rememberThemeCssFile } from "../settings/theme-css";
import {
  checkForInstallableUpdate,
  installDownloadedUpdate,
  installPendingUpdate,
} from "../updates/app-updater";
import { formatActionError } from "./controller-errors";
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
  const didClose = await closeSettingsWindow();
  if (!didClose) showSavedToast();
}

export function useSettingsController({ showToast, surface = "main" }: UseSettingsControllerOptions) {
  const { settings: loadedSettings, updateStatus, closeSettings: closeEmbedded, downloadUpdate, applyDownloadedUpdate } = useAppSettings();

  // 草稿状态：用已加载设置初始化，对齐 loadedSettings 变化
  const [shortcutDrafts, setShortcutDrafts] = useState<Readonly<Record<string, string>>>(
    () => createShortcutDrafts(loadedSettings.shortcuts)
  );
  const [assetsDirectoryDraft, setAssetsDirectoryDraft] = useState(loadedSettings.assetsDirectory);
  const [editorSettingsDraft, setEditorSettingsDraft] = useState<EditorDisplaySettings>(loadedSettings.editor);
  const [themeDraft, setThemeDraft] = useState<AppThemeSettings>(loadedSettings.theme);
  const [aiSettingsDraft, setAiSettingsDraft] = useState<AiSettings>(() => loadedSettings.ai);
  const [updateSettingsDraft, setUpdateSettingsDraft] = useState<AppUpdateSettings>(loadedSettings.update);
  const [settingsErrorMessage, setSettingsErrorMessage] = useState<string | null>(null);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [isLocalModelActionPending, setIsLocalModelActionPending] = useState(false);
  const hasInitialized = useRef(false);

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
    if (!hasInitialized.current) {
      hasInitialized.current = true;
      syncDrafts(loadedSettings);
    }
  }, [loadedSettings, syncDrafts]);

  // 跨窗口同步：settings-window 保存后，主窗口收到广播并对齐草稿
  useEffect(() => {
    if (surface !== "main") return;
    return listenToAppSettingsChanged((next) => syncDrafts(next));
  }, [surface, syncDrafts]);

  const applyLocalModelStatus = useCallback((status: LocalAiModelCommandStatus) => {
    // 模型状态从命令结果和进度事件两路进入，需同步到已保存设置和草稿
    // 注意：已保存设置的更新通过 listenToAppSettingsChanged 广播机制处理，
    // 此处只更新 AI 草稿以保持弹窗实时显示正确状态
    setAiSettingsDraft((current) => ({
      ...current,
      localModel: mergeLocalAiModelStatus(current.localModel, status)
    }));
  }, []);

  // 设置窗口主题草稿实时广播给主窗口预览
  useEffect(() => {
    if (surface !== "settings-window" || !hasInitialized.current) return;
    void publishAppThemePreviewChanged(themeDraft).catch((error: unknown) => {
      console.warn("主题预览广播失败", error);
    });
  }, [surface, themeDraft]);

  // 应用主题 CSS（设置窗口或内嵌设置页打开时应用草稿主题）
  useEffect(() => {
    if (surface !== "settings-window") return;
    applyCustomThemeCss(themeDraft);
  }, [surface, themeDraft]);

  // 本地模型进度监听
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

  const restoreSavedThemePreview = useCallback(async () => {
    await publishAppThemePreviewChanged(loadedSettings.theme);
  }, [loadedSettings.theme]);

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

  const resetShortcutDraft = useCallback((id: string) => {
    const shortcut = loadedSettings.shortcuts.find((s) => s.id === id);
    if (!shortcut) return;
    setShortcutDrafts((current) => ({ ...current, [id]: keyboardShortcutLabel(shortcut.defaultKey) }));
  }, [loadedSettings.shortcuts]);

  const saveSettings = useCallback(async () => {
    const nextAssetsDirectory = validateAssetsDirectory(assetsDirectoryDraft);
    if (!nextAssetsDirectory) {
      setSettingsErrorMessage("图片资源目录必须是当前文档目录内的子目录，例如 assets 或 images/posts。");
      return;
    }

    const normalizedShortcuts: ShortcutSetting[] = [];
    for (const shortcut of loadedSettings.shortcuts) {
      const key = normalizeShortcutKey(shortcutDrafts[shortcut.id] ?? shortcut.key);
      if (!key) {
        setSettingsErrorMessage(`"${shortcut.label}"快捷键格式无效，请使用 Command+Shift+B 这类组合。`);
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
        update: updateSettingsDraft
      });
      // saveAppSettings 广播 listenToAppSettingsChanged，Context 会自动更新 settings
      try {
        await closeSettingsSurfaceAfterSave({
          surface,
          closeEmbeddedSettings: closeEmbedded,
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
    closeEmbedded,
    editorSettingsDraft,
    loadedSettings.shortcuts,
    shortcutDrafts,
    showToast,
    surface,
    themeDraft,
    updateSettingsDraft
  ]);

  const chooseThemeCss = useCallback(async (scheme: "light" | "dark") => {
    setSettingsErrorMessage(null);
    try {
      const file = await pickThemeCssFile();
      if (!file) return;
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
      ...loadedSettings.ai.localModel,
      displayName: "md-editor Writer Small",
      path: null,
      status: "downloading",
      downloadedBytes: 0,
      error: null
    });
    try {
      const status = await downloadLocalAiModel(loadedSettings.ai.localModel.modelId);
      applyLocalModelStatus(status);
    } catch (error) {
      if (isLocalModelDownloadCancel(error)) { setSettingsErrorMessage(null); return; }
      setSettingsErrorMessage(formatActionError(error, "本地模型下载失败。"));
    }
  }, [applyLocalModelStatus, loadedSettings.ai.localModel]);

  const cancelLocalModelDownload = useCallback(async () => {
    setIsLocalModelActionPending(true);
    setSettingsErrorMessage(null);
    try {
      const status = await cancelLocalAiModelDownload(loadedSettings.ai.localModel.modelId);
      applyLocalModelStatus(status);
      showToast(LOCAL_MODEL_CANCEL_MESSAGE);
    } catch (error) {
      setSettingsErrorMessage(formatActionError(error, "取消本地模型下载失败。"));
    } finally {
      setIsLocalModelActionPending(false);
    }
  }, [applyLocalModelStatus, loadedSettings.ai.localModel.modelId, showToast]);

  const deleteLocalModel = useCallback(async () => {
    setIsLocalModelActionPending(true);
    setSettingsErrorMessage(null);
    try {
      const status = await deleteLocalAiModel(loadedSettings.ai.localModel.modelId);
      applyLocalModelStatus(status);
    } catch (error) {
      setSettingsErrorMessage(formatActionError(error, "本地模型删除失败。"));
    } finally {
      setIsLocalModelActionPending(false);
    }
  }, [applyLocalModelStatus, loadedSettings.ai.localModel.modelId]);

  const runUpdateCheck = useCallback(async () => {
    // updateStatus 由 Context 管理，此处通过设置窗口触发更新检查后
    // 结果通过 applyDownloadedUpdate / downloadUpdate 回流到 Context
    await checkForInstallableUpdate(appVersion());
  }, []);

  const installUpdate = useCallback(async () => {
    setSettingsErrorMessage(null);
    const result = updateStatus.state === "downloaded"
      ? await installDownloadedUpdate()
      : await installPendingUpdate(() => {});
    if (result.state === "installed") {
      showToast("更新已安装，重启应用后生效。");
    }
  }, [showToast, updateStatus.state]);

  return {
    shortcutDrafts,
    assetsDirectoryDraft,
    editorSettingsDraft,
    themeDraft,
    aiSettingsDraft,
    updateSettingsDraft,
    isLocalModelActionPending,
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
    runUpdateCheck,
    downloadUpdate,
    applyDownloadedUpdate,
    installUpdate,
  };
}

function createShortcutDrafts(shortcuts: readonly ShortcutSetting[]): Readonly<Record<string, string>> {
  return Object.fromEntries(
    shortcuts.map((s) => [s.id, keyboardShortcutLabel(s.key)])
  );
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
