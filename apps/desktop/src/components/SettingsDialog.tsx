import { dialogButtonClassName, primaryDialogButtonClassName } from "@md-editor/editor-ui";
import { useEffect, type KeyboardEvent } from "react";
import type { AiSettings } from "@md-editor/editor-core";
import type {
  AppSettings,
  AppThemeSettings,
  BuiltInThemeId,
  ThemeColorScheme,
  ThemeSchemeSettings,
  UpdateStatus
} from "../app/settings/app-settings";
import {
  DEFAULT_DEEPSEEK_ENDPOINT,
  DEFAULT_OPENAI_COMPATIBLE_ENDPOINT,
  keyboardShortcutLabel,
  shortcutKeyFromKeyboardEvent
} from "../app/settings/app-settings";
import {
  BUILT_IN_DARK_THEME_OPTIONS,
  BUILT_IN_LIGHT_THEME_OPTIONS,
  type BuiltInThemeOption
} from "../app/settings/built-in-themes";
import { isComposingKeyboardEvent } from "../lib/keyboard";

export interface SettingsPageProps {
  readonly settings: AppSettings;
  readonly updateStatus: UpdateStatus;
  readonly shortcutDrafts: Readonly<Record<string, string>>;
  readonly assetsDirectoryDraft: string;
  readonly themeDraft: AppThemeSettings;
  readonly aiSettingsDraft: AiSettings;
  readonly isLocalModelActionPending: boolean;
  readonly errorMessage: string | null;
  readonly isSaving: boolean;
  readonly isCheckingForUpdates: boolean;
  readonly onCaptureShortcut: (id: string, key: string) => void;
  readonly onResetShortcut: (id: string) => void;
  readonly onChangeAssetsDirectory: (value: string) => void;
  readonly onChangeTheme: (value: AppThemeSettings) => void;
  readonly onChooseThemeCss: (scheme: "light" | "dark") => void;
  readonly onClearThemeCss: (scheme: "light" | "dark") => void;
  readonly onChangeAiSettings: (value: AiSettings) => void;
  readonly onDownloadLocalModel: () => void;
  readonly onCancelLocalModelDownload: () => void;
  readonly onDeleteLocalModel: () => void;
  readonly onSave: () => void;
  readonly onClose: () => void;
  readonly onCheckForUpdates: () => void;
}

export function SettingsPage({
  settings,
  updateStatus,
  shortcutDrafts,
  assetsDirectoryDraft,
  themeDraft,
  aiSettingsDraft,
  isLocalModelActionPending,
  errorMessage,
  isSaving,
  isCheckingForUpdates,
  onCaptureShortcut,
  onResetShortcut,
  onChangeAssetsDirectory,
  onChangeTheme,
  onChooseThemeCss,
  onClearThemeCss,
  onChangeAiSettings,
  onDownloadLocalModel,
  onCancelLocalModelDownload,
  onDeleteLocalModel,
  onSave,
  onClose,
  onCheckForUpdates
}: SettingsPageProps) {
  const isLocalModelBusy =
    isLocalModelActionPending ||
    aiSettingsDraft.localModel.status === "downloading" ||
    aiSettingsDraft.localModel.status === "verifying";
  const canCancelLocalModelDownload =
    !isLocalModelActionPending && aiSettingsDraft.localModel.status === "downloading";
  const canDeleteLocalModel =
    aiSettingsDraft.localModel.status === "available" ||
    aiSettingsDraft.localModel.status === "failed";

  useEffect(() => {
    const closeOnPlainEscape = (event: globalThis.KeyboardEvent) => {
      if (
        event.key !== "Escape" ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.shiftKey ||
        isComposingKeyboardEvent(event)
      ) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      onClose();
    };

    window.addEventListener("keydown", closeOnPlainEscape, { capture: true });
    return () => window.removeEventListener("keydown", closeOnPlainEscape, { capture: true });
  }, [onClose]);

  const captureShortcut = (id: string, event: KeyboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    event.stopPropagation();

    const nextKey = shortcutKeyFromKeyboardEvent(event);
    if (nextKey) {
      onCaptureShortcut(id, nextKey);
    }
  };

  return (
    <section className="flex h-full min-h-0 w-full flex-col bg-[var(--theme-surface)] text-[var(--theme-text)]" aria-labelledby="settings-title">
      <header className="flex min-h-[54px] shrink-0 items-center justify-between gap-4 border-b border-[var(--theme-border)] bg-[var(--theme-chrome)] px-5">
        <div className="min-w-0">
          <h1 id="settings-title" className="m-0 text-[17px] leading-[1.35] text-[var(--theme-title)]">
            设置
          </h1>
          <p className={settingsDescriptionClassName}>调整编辑器偏好和桌面端行为。</p>
        </div>
        <button
          type="button"
          className="grid size-8 shrink-0 place-items-center rounded-[5px] border-0 bg-transparent text-[22px] leading-none text-[var(--theme-control-text)] hover:bg-[var(--theme-control-hover)] hover:text-[var(--theme-title)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--theme-primary)]"
          aria-label="取消并关闭设置"
          title="取消"
          onClick={onClose}
        >
          ×
        </button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="min-h-0 overflow-auto px-6 py-5 max-[760px]:px-4">
          <div className="mx-auto grid w-full max-w-[920px] gap-5">
            <section className={settingsModuleClassName} aria-labelledby="appearance-settings-title">
              <div className="mb-3">
                <h2 id="appearance-settings-title" className={settingsSectionTitleClassName}>外观</h2>
                <p className={settingsDescriptionClassName}>为亮色和暗色分别选择内置主题或自定义 CSS，应用默认跟随系统明暗。</p>
              </div>
              <div className="grid gap-2.5">
                <label className="grid grid-cols-[minmax(120px,160px)_minmax(0,1fr)] items-center gap-3 max-[760px]:grid-cols-1">
                  <span className={settingsFieldLabelClassName}>应用方式</span>
                  <select
                    className={settingsInputClassName}
                    value={themeDraft.mode}
                    onChange={(event) =>
                      onChangeTheme({ ...themeDraft, mode: readThemeColorScheme(event.target.value) })
                    }
                  >
                    <option value="system">跟随系统</option>
                    <option value="light">使用亮色 CSS</option>
                    <option value="dark">使用暗色 CSS</option>
                  </select>
                </label>
                <ThemeCssPicker
                  label="亮色主题"
                  theme={themeDraft.light}
                  builtInOptions={BUILT_IN_LIGHT_THEME_OPTIONS}
                  onChange={(light) => onChangeTheme({ ...themeDraft, light })}
                  onChoose={() => onChooseThemeCss("light")}
                  onClear={() => onClearThemeCss("light")}
                />
                <ThemeCssPicker
                  label="暗色主题"
                  theme={themeDraft.dark}
                  builtInOptions={BUILT_IN_DARK_THEME_OPTIONS}
                  onChange={(dark) => onChangeTheme({ ...themeDraft, dark })}
                  onChoose={() => onChooseThemeCss("dark")}
                  onClear={() => onClearThemeCss("dark")}
                />
              </div>
            </section>

            <section className={settingsModuleClassName} aria-labelledby="shortcut-settings-title">
              <div className="mb-3">
                <h2 id="shortcut-settings-title" className={settingsSectionTitleClassName}>快捷键设置</h2>
                <p className={settingsDescriptionClassName}>点击输入框后按下组合键，系统会自动记录键位。</p>
              </div>
              <div className="grid gap-2">
                {settings.shortcuts.map((shortcut) => (
                  <label key={shortcut.id} className="grid grid-cols-[minmax(150px,1fr)_minmax(160px,220px)_56px] items-center gap-2.5 max-[760px]:grid-cols-1">
                    <span className="min-w-0">
                      <strong className={settingsFieldLabelClassName}>{shortcut.label}</strong>
                      <small className="block overflow-hidden text-ellipsis whitespace-nowrap text-xs text-[var(--theme-muted)]">
                        默认 {keyboardShortcutLabel(shortcut.defaultKey)}
                      </small>
                    </span>
                    <input
                      data-settings-shortcut-input="true"
                      className={settingsInputClassName}
                      value={shortcutDrafts[shortcut.id] ?? keyboardShortcutLabel(shortcut.key)}
                      onKeyDown={(event) => captureShortcut(shortcut.id, event)}
                      onChange={() => undefined}
                      readOnly
                      spellCheck={false}
                      aria-label={`${shortcut.label}快捷键`}
                    />
                    <button
                      type="button"
                      className={`${settingsSmallButtonClassName} max-[760px]:w-max`}
                      onClick={() => onResetShortcut(shortcut.id)}
                    >
                      重置
                    </button>
                  </label>
                ))}
              </div>
            </section>

            <section className={settingsModuleClassName} aria-labelledby="assets-settings-title">
              <div className="mb-3">
                <h2 id="assets-settings-title" className={settingsSectionTitleClassName}>图片设置</h2>
                <p className={settingsDescriptionClassName}>粘贴或拖拽图片时，图片会保存到当前 Markdown 文件所在目录下的这个子目录。</p>
              </div>
              <label className="grid grid-cols-[minmax(120px,160px)_minmax(0,1fr)] items-center gap-3 max-[760px]:grid-cols-1">
                <span className={settingsFieldLabelClassName}>图片资源目录</span>
                <input
                  className={settingsInputClassName}
                  value={assetsDirectoryDraft}
                  onChange={(event) => onChangeAssetsDirectory(event.target.value)}
                  placeholder="assets"
                  spellCheck={false}
                />
              </label>
            </section>

            <section className={settingsModuleClassName} aria-labelledby="ai-settings-title">
              <div className="mb-3">
                <h2 id="ai-settings-title" className={settingsSectionTitleClassName}>AI 设置</h2>
                <p className={settingsDescriptionClassName}>
                  AI 只会在你主动触发续写时请求；API Key 会保存在本机设置文件中。
                </p>
              </div>
              <div className="grid gap-3">
                <label className="flex min-h-[30px] items-center gap-2">
                  <input
                    type="checkbox"
                    className="size-4 accent-[var(--theme-primary)]"
                    checked={aiSettingsDraft.features.editing}
                    onChange={(event) =>
                      onChangeAiSettings(updateAiFeature(aiSettingsDraft, "editing", event.target.checked))
                    }
                  />
                  <span className={settingsFieldLabelClassName}>语法、标点修复</span>
                </label>
                <label className="flex min-h-[30px] items-center gap-2">
                  <input
                    type="checkbox"
                    className="size-4 accent-[var(--theme-primary)]"
                    checked={aiSettingsDraft.features.continuation}
                    onChange={(event) =>
                      onChangeAiSettings(updateAiFeature(aiSettingsDraft, "continuation", event.target.checked))
                    }
                  />
                  <span className={settingsFieldLabelClassName}>AI 续写</span>
                </label>

                <label className="grid grid-cols-[minmax(120px,160px)_minmax(0,1fr)] items-center gap-3 max-[760px]:grid-cols-1">
                  <span className={settingsFieldLabelClassName}>Provider</span>
                  <select
                    className={settingsInputClassName}
                    value={aiSettingsDraft.provider}
                    onChange={(event) =>
                      onChangeAiSettings(updateAiProvider(aiSettingsDraft, readAiProvider(event.target.value)))
                    }
                  >
                    <option value="openai-compatible">OpenAI-compatible</option>
                    <option value="deepseek">DeepSeek</option>
                    <option value="local">本地模型</option>
                  </select>
                </label>

                {isRemoteAiProvider(aiSettingsDraft.provider) ? (
                  <div className="grid gap-2.5">
                    <label className="grid grid-cols-[minmax(120px,160px)_minmax(0,1fr)] items-center gap-3 max-[760px]:grid-cols-1">
                      <span className={settingsFieldLabelClassName}>Endpoint</span>
                      <input
                        className={settingsInputClassName}
                        value={aiSettingsDraft.openAiCompatible.baseUrl}
                        disabled={aiSettingsDraft.provider === "deepseek"}
                        onChange={(event) =>
                          onChangeAiSettings({
                            ...aiSettingsDraft,
                            openAiCompatible: {
                              ...aiSettingsDraft.openAiCompatible,
                              baseUrl: event.target.value
                            }
                          })
                        }
                        placeholder={providerEndpointPlaceholder(aiSettingsDraft.provider)}
                        spellCheck={false}
                      />
                    </label>
                    <label className="grid grid-cols-[minmax(120px,160px)_minmax(0,1fr)] items-center gap-3 max-[760px]:grid-cols-1">
                      <span className={settingsFieldLabelClassName}>Model</span>
                      <input
                        className={settingsInputClassName}
                        value={aiSettingsDraft.openAiCompatible.model}
                        onChange={(event) =>
                          onChangeAiSettings({
                            ...aiSettingsDraft,
                            openAiCompatible: {
                              ...aiSettingsDraft.openAiCompatible,
                              model: event.target.value
                            }
                          })
                        }
                        placeholder={providerModelPlaceholder(aiSettingsDraft.provider)}
                        spellCheck={false}
                      />
                    </label>
                    <label className="grid grid-cols-[minmax(120px,160px)_minmax(0,1fr)] items-center gap-3 max-[760px]:grid-cols-1">
                      <span className={settingsFieldLabelClassName}>API Key</span>
                      <input
                        type="password"
                        className={settingsInputClassName}
                        value={aiSettingsDraft.openAiCompatible.apiKey}
                        onChange={(event) =>
                          onChangeAiSettings({
                            ...aiSettingsDraft,
                            openAiCompatible: {
                              ...aiSettingsDraft.openAiCompatible,
                              apiKey: event.target.value
                            }
                          })
                        }
                        placeholder="sk-..."
                        spellCheck={false}
                      />
                    </label>
                  </div>
                ) : (
                  <div className="grid gap-2.5">
                    <label className="flex min-h-[30px] items-center gap-2">
                      <input
                        type="checkbox"
                        className="size-4 accent-[var(--theme-primary)]"
                        checked={aiSettingsDraft.localModel.enabled}
                        onChange={(event) =>
                          onChangeAiSettings({
                            ...aiSettingsDraft,
                            localModel: {
                              ...aiSettingsDraft.localModel,
                              enabled: event.target.checked
                            }
                          })
                        }
                      />
                      <span className={settingsFieldLabelClassName}>启用本地模型</span>
                    </label>
                    <div className="grid gap-2">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <span className={settingsFieldLabelClassName}>
                          模型状态：{localModelStatusLabel(aiSettingsDraft.localModel.status)}
                        </span>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            className={settingsSmallButtonClassName}
                            onClick={onDownloadLocalModel}
                            disabled={isLocalModelBusy}
                          >
                            {aiSettingsDraft.localModel.status === "available" ? "重新下载" : "下载模型"}
                          </button>
                          {canCancelLocalModelDownload ? (
                            <button
                              type="button"
                              className={settingsSmallButtonClassName}
                              onClick={onCancelLocalModelDownload}
                            >
                              取消下载
                            </button>
                          ) : null}
                          {canDeleteLocalModel ? (
                            <button
                              type="button"
                              className={settingsSmallButtonClassName}
                              onClick={onDeleteLocalModel}
                              disabled={isLocalModelBusy}
                            >
                              删除模型
                            </button>
                          ) : null}
                        </div>
                      </div>
                      <p className={settingsDescriptionClassName}>
                        {localModelProgressLabel(aiSettingsDraft.localModel)}
                      </p>
                    </div>
                    <p className={settingsDescriptionClassName}>
                      用户风格学习后续只会走本地模型，不会把历史文章批量上传到远程 provider。
                    </p>
                  </div>
                )}
              </div>
            </section>

            <section className={settingsModuleClassName} aria-labelledby="update-settings-title">
              <div className="mb-3">
                <h2 id="update-settings-title" className={settingsSectionTitleClassName}>版本</h2>
                <p className={settingsDescriptionClassName}>{updateStatus.message}</p>
              </div>
              <div className="flex items-center justify-between gap-3 max-[560px]:flex-col max-[560px]:items-start">
                <span className={settingsFieldLabelClassName}>当前版本 {updateStatus.currentVersion}</span>
                <button
                  type="button"
                  className={settingsSmallButtonClassName}
                  onClick={onCheckForUpdates}
                  disabled={isCheckingForUpdates}
                >
                  {isCheckingForUpdates ? "检查中" : "检查更新"}
                </button>
              </div>
            </section>
          </div>
        </div>

        {errorMessage ? (
          <p
            className="mx-auto mb-0 mt-[-2px] w-[min(920px,calc(100%_-_48px))] rounded-md border border-[rgba(227,15,46,0.22)] bg-[var(--theme-danger-bg)] px-2.5 py-2 text-xs text-[var(--theme-danger-text)] max-[760px]:w-[calc(100%_-_32px)]"
            role="alert"
          >
            {errorMessage}
          </p>
        ) : null}

        <footer className="flex shrink-0 justify-end gap-2 border-t border-[var(--theme-border)] bg-[var(--theme-chrome)] px-5 py-3.5">
          <button type="button" className={dialogButtonClassName} onClick={onClose}>
            取消
          </button>
          <button type="button" className={primaryDialogButtonClassName} onClick={onSave} disabled={isSaving}>
            {isSaving ? "保存中" : "保存"}
          </button>
        </footer>
      </div>
    </section>
  );
}

export const SettingsDialog = SettingsPage;

const settingsModuleClassName =
  "border-t border-[var(--theme-border)] py-5 first:border-t-0";

const settingsSectionTitleClassName =
  "m-0 text-sm leading-[1.4] text-[var(--theme-title)]";

const settingsDescriptionClassName =
  "mb-0 mt-1 text-xs leading-normal text-[var(--theme-muted)]";

const settingsFieldLabelClassName =
  "block text-[13px] font-semibold text-[var(--theme-title)]";

const settingsInputClassName =
  "h-[30px] w-full rounded-[5px] border border-[var(--theme-border-strong)] bg-[var(--theme-surface)] px-2 text-[13px] leading-none text-[var(--theme-text)] outline-none read-only:cursor-default focus:border-[var(--theme-primary)] focus:shadow-[0_0_0_2px_var(--theme-primary-soft)]";

const settingsSmallButtonClassName =
  "h-[30px] px-2 rounded-[5px] border border-[var(--theme-border-strong)] bg-[var(--theme-surface)] text-xs text-[var(--theme-control-text)] hover:bg-[var(--theme-control-hover)] hover:text-[var(--theme-title)] disabled:opacity-55";

interface ThemeCssPickerProps {
  readonly label: string;
  readonly theme: ThemeSchemeSettings;
  readonly builtInOptions: readonly BuiltInThemeOption[];
  readonly onChange: (value: ThemeSchemeSettings) => void;
  readonly onChoose: () => void;
  readonly onClear: () => void;
}

function ThemeCssPicker({
  label,
  theme,
  builtInOptions,
  onChange,
  onChoose,
  onClear
}: ThemeCssPickerProps) {
  const customCssPath = theme.customCssPath;
  const shouldShowCustomCss = theme.source === "custom" || customCssPath !== null;

  return (
    <div className="grid grid-cols-[minmax(120px,160px)_minmax(0,1fr)] items-start gap-3 max-[760px]:grid-cols-1">
      <span className={settingsFieldLabelClassName}>{label}</span>
      <div className="grid gap-2">
        <select
          className={settingsInputClassName}
          value={theme.source === "custom" ? "custom" : theme.builtinTheme}
          onChange={(event) =>
            onChange(readThemeSelection(event.target.value, theme, builtInOptions))
          }
        >
          {builtInOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
          <option value="custom">自定义 CSS</option>
        </select>
        {shouldShowCustomCss ? (
          <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 max-[760px]:grid-cols-1">
            <input
              className={settingsInputClassName}
              value={customCssPath ?? ""}
              placeholder="未选择 CSS 文件"
              readOnly
              spellCheck={false}
              aria-label={`${label}自定义 CSS 路径`}
              title={customCssPath ?? "未选择 CSS 文件"}
            />
            <button type="button" className={`${settingsSmallButtonClassName} max-[760px]:w-max`} onClick={onChoose}>
              选择
            </button>
            {customCssPath ? (
              <button type="button" className={`${settingsSmallButtonClassName} max-[760px]:w-max`} onClick={onClear}>
                清除
              </button>
            ) : null}
          </div>
      ) : null}
      </div>
    </div>
  );
}

function localModelStatusLabel(status: AiSettings["localModel"]["status"]): string {
  switch (status) {
    case "downloading":
      return "下载中";
    case "verifying":
      return "校验中";
    case "available":
      return "可用";
    case "failed":
      return "下载失败";
    case "not-downloaded":
      return "未下载";
  }
}

function localModelProgressLabel(localModel: AiSettings["localModel"]): string {
  const statusLabel = localModelStatusLabel(localModel.status);
  const progressLabel =
    localModel.totalBytes > 0
      ? `${formatByteSize(localModel.downloadedBytes)} / ${formatByteSize(localModel.totalBytes)}`
      : formatByteSize(localModel.downloadedBytes);
  const versionLabel = localModel.version ? `版本 ${localModel.version}` : "尚未下载版本";

  if (localModel.error) {
    return localModel.error;
  }

  if (localModel.status === "not-downloaded") {
    return `模型 ${localModel.modelId}，${versionLabel}。`;
  }

  if (localModel.error) {
    return `模型 ${localModel.modelId}，${statusLabel}：${localModel.error}`;
  }

  if (localModel.status === "available") {
    return `模型 ${localModel.modelId}，${versionLabel}，文件 ${progressLabel}。`;
  }

  return `模型 ${localModel.modelId}，${versionLabel}，${progressLabel}。`;
}

function formatByteSize(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return "0 B";
  }
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  if (value < 1024 * 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function readAiProvider(input: string): AiSettings["provider"] {
  if (input === "deepseek" || input === "local") {
    return input;
  }

  return "openai-compatible";
}

function isRemoteAiProvider(provider: AiSettings["provider"]): boolean {
  return provider === "openai-compatible" || provider === "deepseek";
}

function providerEndpointPlaceholder(provider: AiSettings["provider"]): string {
  return provider === "deepseek" ? DEFAULT_DEEPSEEK_ENDPOINT : DEFAULT_OPENAI_COMPATIBLE_ENDPOINT;
}

function providerModelPlaceholder(provider: AiSettings["provider"]): string {
  return provider === "deepseek" ? "deepseek-chat" : "gpt-4.1-mini";
}

function readThemeColorScheme(input: string): ThemeColorScheme {
  return input === "light" || input === "dark" ? input : "system";
}

function readThemeSelection(
  input: string,
  current: ThemeSchemeSettings,
  builtInOptions: readonly BuiltInThemeOption[]
): ThemeSchemeSettings {
  if (input === "custom") {
    return { ...current, source: "custom" };
  }

  return {
    ...current,
    source: "builtin",
    builtinTheme: readBuiltInTheme(input, current.builtinTheme, builtInOptions)
  };
}

function readBuiltInTheme(
  input: string,
  fallback: BuiltInThemeId,
  builtInOptions: readonly BuiltInThemeOption[]
): BuiltInThemeId {
  return builtInOptions.some((option) => option.id === input) ? (input as BuiltInThemeId) : fallback;
}

function updateAiProvider(settings: AiSettings, provider: AiSettings["provider"]): AiSettings {
  const currentBaseUrl = settings.openAiCompatible.baseUrl;
  const baseUrl = provider === "deepseek"
    ? DEFAULT_DEEPSEEK_ENDPOINT
    : provider === "openai-compatible" && currentBaseUrl === DEFAULT_DEEPSEEK_ENDPOINT
      ? DEFAULT_OPENAI_COMPATIBLE_ENDPOINT
      : currentBaseUrl;

  return {
    ...settings,
    provider,
    openAiCompatible: {
      ...settings.openAiCompatible,
      baseUrl
    }
  };
}

function updateAiFeature(
  settings: AiSettings,
  feature: keyof AiSettings["features"],
  enabled: boolean
): AiSettings {
  const nextFeatures = {
    ...settings.features,
    [feature]: enabled
  };
  return {
    ...settings,
    enabled: nextFeatures.continuation || nextFeatures.editing,
    features: nextFeatures
  };
}
