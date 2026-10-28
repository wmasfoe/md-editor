import React, { useCallback, useMemo, useState } from "react";
import {
  ArrowDownTrayIcon,
  ArrowPathIcon,
  CheckCircleIcon,
  ClipboardDocumentCheckIcon,
  ClipboardDocumentIcon,
  ExclamationCircleIcon,
  SparklesIcon,
} from "@heroicons/react/24/outline";
import {
  SettingsShell,
  type SettingsTabItem,
  EditorSettingsPanel,
  AppearanceSettingsPanel,
  PluginSettingsPanel,
  ShortcutSettingsPanel,
  GeneralSettingsPanel,
  settingsDescriptionClassName,
  settingsFieldLabelClassName,
  settingsInputClassName,
  settingsModuleClassName,
  settingsSectionTitleClassName,
  settingsSmallButtonClassName,
} from "@md-editor/editor-ui/settings";
import { type BuiltInThemeId, type WebSettings } from "../lib/web-settings";
import {
  AI_URL_PRESETS,
  applyAiUrlPreset,
  updateAiEndpoint,
  updateAiProvider,
  type AiConnectionTestResult,
  type AiProtocolId,
} from "@md-editor/ai";
import { webAiService } from "../lib/web-ai-service";
import { changeLanguage, useTranslation, type LanguageSetting } from "@md-editor/i18n";

export interface WebSettingsDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly settings: WebSettings;
  readonly onSaveSettings: (settings: WebSettings) => void;
  readonly mode?: "wysiwyg" | "source";
  readonly onChangeMode?: (mode: "wysiwyg" | "source") => void;
  readonly onExport?: () => void;
  readonly onCopy?: () => void;
  readonly isCopied?: boolean;
  readonly onReset?: () => void;
}

export function WebSettingsDialog({
  open,
  onClose,
  settings,
  onSaveSettings,
  mode,
  onChangeMode,
  onExport,
  onCopy,
  isCopied,
  onReset,
}: WebSettingsDialogProps) {
  const { t } = useTranslation();
  const [localSettings, setLocalSettings] = useState<WebSettings>(settings);
  const [selectedTabIndex, setSelectedTabIndex] = useState(0);

  // AI 连通性测试状态
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<AiConnectionTestResult | null>(null);

  // 跨平台快捷键提示前缀判断（Mac 显示 ⌘，其余平台显示 Ctrl）
  const isMac = useMemo(() => {
    if (typeof navigator === "undefined") return false;
    return /mac/i.test(navigator.userAgent);
  }, []);
  const modKey = isMac ? "⌘" : "Ctrl";
  const shiftKey = isMac ? "⇧" : "Shift+";

  // 当外部 settings 改变时同步到 localSettings
  React.useEffect(() => {
    setLocalSettings(settings);
    setTestResult(null);
  }, [settings]);

  const handleLanguageChange = async (lang: LanguageSetting) => {
    setLocalSettings((prev) => ({ ...prev, language: lang }));
    await changeLanguage(lang);
  };

  const handleApplyPreset = (presetId: (typeof AI_URL_PRESETS)[number]["id"]) => {
    setLocalSettings((prev) => ({
      ...prev,
      ai: applyAiUrlPreset(prev.ai, presetId),
    }));
    setTestResult(null);
  };

  const handleTestConnection = useCallback(async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const result = await webAiService.testConnection(localSettings.ai);
      setTestResult(result);
    } catch (err: unknown) {
      setTestResult({
        ok: false,
        message: err instanceof Error ? err.message : t("common.error"),
      });
    } finally {
      setIsTesting(false);
    }
  }, [localSettings.ai, t]);

  const handleSave = () => {
    onSaveSettings(localSettings);
    onClose();
  };

  // 快捷键列表配置（只读速查表）
  const shortcutsList = useMemo(
    () => [
      {
        id: "view.toggleMode",
        label: t("web.shortcuts.toggleMode"),
        key: `${modKey}+/`,
      },
      {
        id: "view.toggleOutline",
        label: t("web.shortcuts.toggleOutline"),
        key: `${shiftKey}${modKey}+B`,
      },
      {
        id: "ai.trigger",
        label: t("web.shortcuts.aiTrigger"),
        key: `${modKey}+J`,
      },
      {
        id: "ai.accept",
        label: t("web.shortcuts.aiAccept"),
        key: "Tab",
      },
      {
        id: "view.closeOverlay",
        label: t("web.shortcuts.closeOverlay"),
        key: "Escape",
      },
      {
        id: "file.save",
        label: t("web.shortcuts.saveDocument"),
        key: `${modKey}+S`,
      },
      {
        id: "app.settings",
        label: t("web.shortcuts.openSettings"),
        key: `${modKey}+,`,
      },
    ],
    [modKey, shiftKey, t],
  );

  const tabs: readonly SettingsTabItem[] = useMemo(
    () => [
      {
        id: "editor",
        label: t("settings.tabs.editor"),
        description: t("settings.tabs.editorDesc"),
        panel: (
          <EditorSettingsPanel
            fontSize={{
              value: localSettings.fontSize,
              onChange: (size) => setLocalSettings((prev) => ({ ...prev, fontSize: size })),
            }}
            proseFont={{
              value: localSettings.proseFontFamily,
              onChange: (fam) => setLocalSettings((prev) => ({ ...prev, proseFontFamily: fam })),
            }}
            codeFont={{
              value: localSettings.codeFontFamily,
              onChange: (fam) => setLocalSettings((prev) => ({ ...prev, codeFontFamily: fam })),
            }}
            showLineNumbers={{
              checked: localSettings.showCodeBlockLineNumbers,
              onChange: (checked) =>
                setLocalSettings((prev) => ({ ...prev, showCodeBlockLineNumbers: checked })),
            }}
            showInlineStyleMarkers={{
              checked: localSettings.showInlineStyleMarkers,
              onChange: (checked) =>
                setLocalSettings((prev) => ({ ...prev, showInlineStyleMarkers: checked })),
            }}
            enableMarkdownLint={{
              checked: localSettings.enableMarkdownLint,
              onChange: (checked) =>
                setLocalSettings((prev) => ({ ...prev, enableMarkdownLint: checked })),
            }}
            editorMode={
              onChangeMode
                ? {
                    mode: mode ?? "wysiwyg",
                    onChange: onChangeMode,
                  }
                : undefined
            }
          />
        ),
      },
      {
        id: "appearance",
        label: t("settings.tabs.appearance"),
        description: t("settings.tabs.appearanceDesc"),
        panel: (
          <AppearanceSettingsPanel
            mode={localSettings.theme}
            onChangeMode={(theme) => setLocalSettings((prev) => ({ ...prev, theme }))}
            builtInThemes={{
              lightTheme: localSettings.lightTheme,
              darkTheme: localSettings.darkTheme,
              onChangeLightTheme: (theme) =>
                setLocalSettings((prev) => ({
                  ...prev,
                  lightTheme: theme as BuiltInThemeId,
                })),
              onChangeDarkTheme: (theme) =>
                setLocalSettings((prev) => ({
                  ...prev,
                  darkTheme: theme as BuiltInThemeId,
                })),
            }}
          />
        ),
      },
      {
        id: "plugins",
        label: t("settings.tabs.plugins"),
        description: t("settings.tabs.pluginsDesc"),
        panel: (
          <PluginSettingsPanel
            plugins={localSettings.plugins}
            onTogglePlugin={(id, enabled) =>
              setLocalSettings((prev) => ({
                ...prev,
                plugins: {
                  enabled: {
                    ...prev.plugins.enabled,
                    [id]: enabled,
                  },
                },
              }))
            }
          />
        ),
      },
      {
        id: "ai",
        label: t("settings.tabs.ai"),
        description: t("settings.tabs.aiDesc"),
        panel: (
          <section className={settingsModuleClassName} aria-labelledby="ai-settings-title">
            <div className="mb-3">
              <h2 id="ai-settings-title" className={settingsSectionTitleClassName}>
                {t("settings.ai.title")}
              </h2>
              <p className={settingsDescriptionClassName}>{t("web.aiDesc")}</p>
            </div>
            <div className="grid gap-3.5">
              <label className="flex min-h-[30px] items-center gap-2">
                <input
                  type="checkbox"
                  className="size-4 accent-[var(--theme-primary)]"
                  checked={localSettings.ai.enabled}
                  onChange={(event) =>
                    setLocalSettings((prev) => ({
                      ...prev,
                      ai: { ...prev.ai, enabled: event.target.checked },
                    }))
                  }
                />
                <span className={settingsFieldLabelClassName}>{t("web.enableAi")}</span>
              </label>

              {/* 协议选择 */}
              <label className="grid grid-cols-[minmax(120px,160px)_minmax(0,1fr)] items-center gap-3 max-[760px]:grid-cols-1">
                <span className={settingsFieldLabelClassName}>{t("settings.ai.protocol")}</span>
                <select
                  className={settingsInputClassName}
                  value={localSettings.ai.provider}
                  onChange={(event) => {
                    const prov = event.target.value as AiProtocolId;
                    setLocalSettings((prev) => ({
                      ...prev,
                      ai: updateAiProvider(prev.ai, prov),
                    }));
                  }}
                >
                  <option value="openai">{t("settings.ai.protocolOpenAi")}</option>
                  <option value="anthropic">{t("settings.ai.protocolAnthropic")}</option>
                  <option value="google">{t("settings.ai.protocolGoogle")}</option>
                </select>
              </label>

              {/* 推荐快速预设 */}
              <div>
                <label className="block text-xs font-medium text-[var(--theme-muted)] mb-1.5">
                  {t("settings.ai.presets")}
                </label>
                <div className="flex flex-wrap gap-2">
                  {AI_URL_PRESETS.map((preset) => {
                    const activeProto: AiProtocolId =
                      localSettings.ai.provider === "local" ? "openai" : localSettings.ai.provider;
                    const isPresetActive =
                      localSettings.ai.provider === preset.protocol &&
                      localSettings.ai.endpoints[activeProto]?.baseUrl === preset.baseUrl;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        className={`h-[28px] rounded-[5px] border px-2.5 text-xs font-medium transition-colors ${
                          isPresetActive
                            ? "border-[var(--theme-primary)] bg-[var(--theme-primary-soft)] text-[var(--theme-primary)]"
                            : "border-[var(--theme-border-strong)] bg-[var(--theme-surface)] hover:bg-[var(--theme-control-hover)]"
                        }`}
                        onClick={() => handleApplyPreset(preset.id)}
                      >
                        {preset.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Base URL */}
              <label className="grid grid-cols-[minmax(120px,160px)_minmax(0,1fr)] items-center gap-3 max-[760px]:grid-cols-1">
                <span className={settingsFieldLabelClassName}>{t("web.endpointBaseUrl")}</span>
                <div>
                  <input
                    type="text"
                    className={settingsInputClassName}
                    placeholder="https://api.openai.com/v1"
                    value={
                      localSettings.ai.endpoints[
                        localSettings.ai.provider === "local" ? "openai" : localSettings.ai.provider
                      ].baseUrl
                    }
                    onChange={(e) => {
                      const activeProto: AiProtocolId =
                        localSettings.ai.provider === "local"
                          ? "openai"
                          : localSettings.ai.provider;
                      setLocalSettings((prev) => ({
                        ...prev,
                        ai: updateAiEndpoint(prev.ai, activeProto, { baseUrl: e.target.value }),
                      }));
                    }}
                  />
                  <p className="mt-1 text-[11px] text-[var(--theme-muted)]">
                    {t("settings.ai.customBaseUrlHint")}
                  </p>
                </div>
              </label>

              {/* API Key */}
              <label className="grid grid-cols-[minmax(120px,160px)_minmax(0,1fr)] items-center gap-3 max-[760px]:grid-cols-1">
                <span className={settingsFieldLabelClassName}>{t("settings.ai.apiKey")}</span>
                <input
                  type="password"
                  className={settingsInputClassName}
                  placeholder="sk-..."
                  value={
                    localSettings.ai.endpoints[
                      localSettings.ai.provider === "local" ? "openai" : localSettings.ai.provider
                    ].apiKey
                  }
                  onChange={(e) => {
                    const activeProto: AiProtocolId =
                      localSettings.ai.provider === "local" ? "openai" : localSettings.ai.provider;
                    setLocalSettings((prev) => ({
                      ...prev,
                      ai: updateAiEndpoint(prev.ai, activeProto, { apiKey: e.target.value }),
                    }));
                  }}
                />
              </label>

              {/* Model Name */}
              <label className="grid grid-cols-[minmax(120px,160px)_minmax(0,1fr)] items-center gap-3 max-[760px]:grid-cols-1">
                <span className={settingsFieldLabelClassName}>{t("web.modelName")}</span>
                <input
                  type="text"
                  className={settingsInputClassName}
                  placeholder="deepseek-chat / gpt-4o-mini"
                  value={
                    localSettings.ai.endpoints[
                      localSettings.ai.provider === "local" ? "openai" : localSettings.ai.provider
                    ].model
                  }
                  onChange={(e) => {
                    const activeProto: AiProtocolId =
                      localSettings.ai.provider === "local" ? "openai" : localSettings.ai.provider;
                    setLocalSettings((prev) => ({
                      ...prev,
                      ai: updateAiEndpoint(prev.ai, activeProto, { model: e.target.value }),
                    }));
                  }}
                />
              </label>

              <div className="pt-1">
                <button
                  type="button"
                  disabled={isTesting}
                  className={settingsSmallButtonClassName}
                  onClick={handleTestConnection}
                >
                  <span className="flex items-center gap-1.5">
                    <SparklesIcon className="size-3.5" />
                    {isTesting ? t("web.testingConnection") : t("web.testConnection")}
                  </span>
                </button>

                {testResult && (
                  <div
                    className={`mt-2.5 flex items-start gap-2 rounded-lg p-2.5 text-xs ${
                      testResult.ok
                        ? "bg-green-500/10 text-green-600 dark:text-green-400"
                        : "bg-red-500/10 text-red-600 dark:text-red-400"
                    }`}
                  >
                    {testResult.ok ? (
                      <CheckCircleIcon className="size-4 shrink-0 mt-0.5" />
                    ) : (
                      <ExclamationCircleIcon className="size-4 shrink-0 mt-0.5" />
                    )}
                    <div>
                      <div>{testResult.message}</div>
                      {testResult.latencyMs && (
                        <div className="mt-0.5 opacity-80">
                          {t("web.latency", { ms: testResult.latencyMs })}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </section>
        ),
      },
      {
        id: "shortcuts",
        label: t("settings.tabs.shortcuts"),
        description: t("settings.tabs.shortcutsDesc"),
        panel: <ShortcutSettingsPanel mode="readonly" shortcuts={shortcutsList} />,
      },
      {
        id: "general",
        label: t("settings.tabs.general"),
        description: t("settings.tabs.generalDesc"),
        panel: (
          <GeneralSettingsPanel
            language={{
              value: localSettings.language,
              onChange: handleLanguageChange,
            }}
            about={{
              description: t("web.aboutDesc"),
            }}
            extraSections={
              <div className="grid gap-5">
                <section
                  className={settingsModuleClassName}
                  aria-labelledby="document-settings-title"
                >
                  <div className="mb-3">
                    <h2 id="document-settings-title" className={settingsSectionTitleClassName}>
                      {t("web.documentOutput")}
                    </h2>
                    <p className={settingsDescriptionClassName}>{t("web.documentOutputDesc")}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {onExport && (
                      <button
                        type="button"
                        className={settingsSmallButtonClassName}
                        onClick={onExport}
                      >
                        <span className="flex items-center gap-1.5">
                          <ArrowDownTrayIcon className="size-3.5 text-[var(--theme-muted)]" />
                          <span>{t("web.exportMarkdown")}</span>
                        </span>
                      </button>
                    )}
                    {onCopy && (
                      <button
                        type="button"
                        className={settingsSmallButtonClassName}
                        onClick={onCopy}
                      >
                        <span className="flex items-center gap-1.5">
                          {isCopied ? (
                            <>
                              <ClipboardDocumentCheckIcon className="size-3.5 text-green-500" />
                              <span className="text-green-500">{t("web.copied")}</span>
                            </>
                          ) : (
                            <>
                              <ClipboardDocumentIcon className="size-3.5 text-[var(--theme-muted)]" />
                              <span>{t("web.copyMarkdown")}</span>
                            </>
                          )}
                        </span>
                      </button>
                    )}
                  </div>
                </section>

                {onReset && (
                  <section
                    className={settingsModuleClassName}
                    aria-labelledby="reset-settings-title"
                  >
                    <div className="mb-3">
                      <h2 id="reset-settings-title" className={settingsSectionTitleClassName}>
                        {t("web.resetDemo")}
                      </h2>
                      <p className={settingsDescriptionClassName}>{t("web.resetDemoDesc")}</p>
                    </div>
                    <button
                      type="button"
                      className="h-[30px] rounded-[5px] border border-red-500/30 bg-red-500/10 px-3 text-xs font-medium text-red-600 transition-colors hover:bg-red-500/20 dark:text-red-400"
                      onClick={() => {
                        onReset();
                        onClose();
                      }}
                    >
                      <span className="flex items-center gap-1.5">
                        <ArrowPathIcon className="size-3.5" />
                        <span>{t("web.resetDemoButton")}</span>
                      </span>
                    </button>
                  </section>
                )}
              </div>
            }
          />
        ),
      },
    ],
    [
      handleTestConnection,
      isCopied,
      isTesting,
      localSettings,
      mode,
      onChangeMode,
      onClose,
      onCopy,
      onExport,
      onReset,
      shortcutsList,
      t,
      testResult,
    ],
  );

  return (
    <SettingsShell
      variant="modal"
      open={open}
      title={t("settings.title")}
      tabs={tabs}
      selectedTabIndex={selectedTabIndex}
      onSelectTab={setSelectedTabIndex}
      onClose={onClose}
      onSave={handleSave}
      cancelText={t("common.cancel")}
      saveText={t("common.save")}
    />
  );
}
