import React, { useCallback, useMemo, useState } from "react";
import { Tab, TabGroup, TabList, TabPanel, TabPanels } from "@headlessui/react";
import { dialogButtonClassName, primaryDialogButtonClassName } from "@md-editor/editor-ui";
import {
  ArrowDownTrayIcon,
  ArrowPathIcon,
  CheckCircleIcon,
  ClipboardDocumentCheckIcon,
  ClipboardDocumentIcon,
  ExclamationCircleIcon,
  SparklesIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import {
  PRESET_PROVIDERS,
  BUILT_IN_LIGHT_THEME_OPTIONS,
  BUILT_IN_DARK_THEME_OPTIONS,
  type BuiltInThemeId,
  type WebSettings,
  type WebTheme,
} from "../lib/web-settings";
import { testAiConnection, type AiTestResult } from "../lib/web-ai-client";
import { changeLanguage, useTranslation, type LanguageSetting } from "@md-editor/i18n";

// 对齐 Desktop 端设置模块样式类名
const settingsModuleClassName = "py-1";
const settingsSectionTitleClassName = "m-0 text-sm leading-[1.4] text-[var(--theme-title)]";
const settingsDescriptionClassName = "mb-0 mt-1 text-xs leading-normal text-[var(--theme-muted)]";
const settingsFieldLabelClassName = "block text-[13px] font-semibold text-[var(--theme-title)]";
const settingsInputClassName =
  "h-[30px] w-full rounded-[5px] border border-[var(--theme-border-strong)] bg-[var(--theme-surface)] px-2 text-[13px] leading-none text-[var(--theme-text)] outline-none read-only:cursor-default focus:border-[var(--theme-primary)] focus:shadow-[0_0_0_2px_var(--theme-primary-soft)]";
const settingsSmallButtonClassName =
  "h-[30px] px-2.5 rounded-[5px] border border-[var(--theme-border-strong)] bg-[var(--theme-surface)] text-xs text-[var(--theme-control-text)] hover:bg-[var(--theme-control-hover)] hover:text-[var(--theme-title)] disabled:opacity-55";

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
  const [selectedTabIndex, setSelectedTabIndex] = useState(0);
  const [localSettings, setLocalSettings] = useState<WebSettings>(settings);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<AiTestResult | null>(null);

  React.useEffect(() => {
    if (open) {
      setLocalSettings(settings);
    }
  }, [open, settings]);

  const handleLanguageChange = (value: LanguageSetting) => {
    setLocalSettings((prev) => ({ ...prev, language: value }));
    void changeLanguage(value);
  };

  const handleClose = useCallback(() => {
    if (localSettings.language !== settings.language) {
      void changeLanguage(settings.language);
    }
    setLocalSettings(settings);
    onClose();
  }, [localSettings.language, onClose, settings]);

  const isMac =
    typeof navigator !== "undefined" &&
    /Mac|iPod|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  const modKey = isMac ? "Command" : "Ctrl";
  const shiftKey = isMac ? "Shift+" : "Shift+";

  const handleApplyPreset = (preset: (typeof PRESET_PROVIDERS)[number]) => {
    setLocalSettings((prev) => ({
      ...prev,
      ai: {
        ...prev.ai,
        provider: preset.id,
        baseUrl: preset.baseUrl,
        model: preset.model,
      },
    }));
    setTestResult(null);
  };

  const handleTestConnection = useCallback(async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const result = await testAiConnection(localSettings.ai);
      setTestResult(result);
    } finally {
      setIsTesting(false);
    }
  }, [localSettings.ai]);

  const handleSave = () => {
    onSaveSettings(localSettings);
    onClose();
  };

  // 快捷键列表配置（与 Desktop 的 ShortcutSettingsPanel 呈现方式一致）
  const shortcutsList = useMemo(
    () => [
      {
        id: "view.toggleMode",
        label: t("web.shortcuts.toggleMode"),
        keyLabel: `${modKey}+/`,
      },
      {
        id: "view.toggleOutline",
        label: t("web.shortcuts.toggleOutline"),
        keyLabel: `${shiftKey}${modKey}+B`,
      },
      {
        id: "ai.trigger",
        label: t("web.shortcuts.aiTrigger"),
        keyLabel: `${modKey}+J`,
      },
      {
        id: "ai.accept",
        label: t("web.shortcuts.aiAccept"),
        keyLabel: "Tab",
      },
      {
        id: "view.closeOverlay",
        label: t("web.shortcuts.closeOverlay"),
        keyLabel: "Escape",
      },
      {
        id: "file.save",
        label: t("web.shortcuts.saveDocument"),
        keyLabel: `${modKey}+S`,
      },
      {
        id: "app.settings",
        label: t("web.shortcuts.openSettings"),
        keyLabel: `${modKey}+,`,
      },
    ],
    [modKey, shiftKey, t],
  );

  // 四个标准 Tab，完全对齐 Desktop 的架构
  const tabs = useMemo(
    () => [
      {
        id: "shortcuts",
        label: t("settings.tabs.shortcuts"),
        description: t("settings.tabs.shortcutsDesc"),
        panel: (
          <section className={settingsModuleClassName} aria-labelledby="shortcut-settings-title">
            <div className="mb-3">
              <h2 id="shortcut-settings-title" className={settingsSectionTitleClassName}>
                {t("settings.shortcuts.title")}
              </h2>
              <p className={settingsDescriptionClassName}>{t("web.shortcutsDesc")}</p>
            </div>
            <div className="grid gap-2.5">
              {shortcutsList.map((shortcut) => (
                <div
                  key={shortcut.id}
                  className="grid grid-cols-[minmax(150px,1fr)_minmax(160px,220px)] items-center gap-2.5 max-[760px]:grid-cols-1"
                >
                  <span className="min-w-0">
                    <strong className={settingsFieldLabelClassName}>{shortcut.label}</strong>
                    <small className="block overflow-hidden text-ellipsis whitespace-nowrap text-xs text-[var(--theme-muted)]">
                      {t("settings.shortcuts.defaultShortcut", { key: shortcut.keyLabel })}
                    </small>
                  </span>
                  <input
                    data-settings-shortcut-input="true"
                    className={settingsInputClassName}
                    value={shortcut.keyLabel}
                    readOnly
                    spellCheck={false}
                    aria-label={t("settings.shortcuts.ariaShortcut", { name: shortcut.label })}
                  />
                </div>
              ))}
            </div>
          </section>
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

              <label className="grid grid-cols-[minmax(120px,160px)_minmax(0,1fr)] items-center gap-3 max-[760px]:grid-cols-1">
                <span className={settingsFieldLabelClassName}>{t("settings.ai.provider")}</span>
                <select
                  className={settingsInputClassName}
                  value={localSettings.ai.provider}
                  onChange={(event) => {
                    const prov = event.target.value as WebSettings["ai"]["provider"];
                    const matchedPreset = PRESET_PROVIDERS.find((p) => p.id === prov);
                    setLocalSettings((prev) => ({
                      ...prev,
                      ai: {
                        ...prev.ai,
                        provider: prov,
                        ...(matchedPreset ? { baseUrl: matchedPreset.baseUrl } : {}),
                      },
                    }));
                  }}
                >
                  <option value="openai-compatible">OpenAI-compatible</option>
                  <option value="deepseek">DeepSeek</option>
                  <option value="ollama">Ollama</option>
                </select>
              </label>

              <div>
                <label className="block text-xs font-medium text-[var(--theme-muted)] mb-1.5">
                  {t("web.recommendedProviders")}
                </label>
                <div className="flex flex-wrap gap-2">
                  {PRESET_PROVIDERS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      className={`h-[28px] rounded-[5px] border px-2.5 text-xs font-medium transition-colors ${
                        localSettings.ai.provider === preset.id
                          ? "border-[var(--theme-primary)] bg-[var(--theme-primary-soft)] text-[var(--theme-primary)]"
                          : "border-[var(--theme-border-strong)] bg-[var(--theme-surface)] hover:bg-[var(--theme-control-hover)]"
                      }`}
                      onClick={() => handleApplyPreset(preset)}
                    >
                      {preset.name}
                    </button>
                  ))}
                </div>
              </div>

              <label className="grid grid-cols-[minmax(120px,160px)_minmax(0,1fr)] items-center gap-3 max-[760px]:grid-cols-1">
                <span className={settingsFieldLabelClassName}>{t("web.endpointBaseUrl")}</span>
                <input
                  type="text"
                  className={settingsInputClassName}
                  placeholder="https://api.openai.com/v1"
                  value={localSettings.ai.baseUrl}
                  onChange={(e) =>
                    setLocalSettings((prev) => ({
                      ...prev,
                      ai: { ...prev.ai, baseUrl: e.target.value },
                    }))
                  }
                />
              </label>

              <label className="grid grid-cols-[minmax(120px,160px)_minmax(0,1fr)] items-center gap-3 max-[760px]:grid-cols-1">
                <span className={settingsFieldLabelClassName}>{t("settings.ai.apiKey")}</span>
                <input
                  type="password"
                  className={settingsInputClassName}
                  placeholder="sk-..."
                  value={localSettings.ai.apiKey}
                  onChange={(e) =>
                    setLocalSettings((prev) => ({
                      ...prev,
                      ai: { ...prev.ai, apiKey: e.target.value },
                    }))
                  }
                />
              </label>

              <label className="grid grid-cols-[minmax(120px,160px)_minmax(0,1fr)] items-center gap-3 max-[760px]:grid-cols-1">
                <span className={settingsFieldLabelClassName}>{t("web.modelName")}</span>
                <input
                  type="text"
                  className={settingsInputClassName}
                  placeholder="deepseek-chat / gpt-4o-mini"
                  value={localSettings.ai.model}
                  onChange={(e) =>
                    setLocalSettings((prev) => ({
                      ...prev,
                      ai: { ...prev.ai, model: e.target.value },
                    }))
                  }
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
        id: "appearance",
        label: t("settings.tabs.appearance"),
        description: t("settings.tabs.appearanceDesc"),
        panel: (
          <section className={settingsModuleClassName} aria-labelledby="appearance-settings-title">
            <div className="mb-3">
              <h2 id="appearance-settings-title" className={settingsSectionTitleClassName}>
                {t("settings.appearance.title")}
              </h2>
              <p className={settingsDescriptionClassName}>{t("web.appearanceDesc")}</p>
            </div>
            <div className="grid gap-4">
              <fieldset className="grid gap-3 border-0 p-0">
                <legend className={settingsFieldLabelClassName}>
                  {t("settings.appearance.fontTitle")}
                </legend>

                {onChangeMode && (
                  <label className="grid grid-cols-[minmax(120px,160px)_minmax(0,1fr)] items-center gap-3 max-[760px]:grid-cols-1">
                    <span className={settingsFieldLabelClassName}>
                      {t("web.currentEditorMode")}
                    </span>
                    <select
                      className={settingsInputClassName}
                      value={mode ?? "wysiwyg"}
                      onChange={(e) => onChangeMode(e.target.value as "wysiwyg" | "source")}
                    >
                      <option value="wysiwyg">{t("web.wysiwygMode")}</option>
                      <option value="source">{t("web.sourceMode")}</option>
                    </select>
                  </label>
                )}

                <label className="grid grid-cols-[minmax(120px,160px)_minmax(0,1fr)_44px] items-center gap-3 text-[13px] text-[var(--theme-text)] max-[760px]:grid-cols-[minmax(0,1fr)_44px]">
                  <span className={settingsFieldLabelClassName}>
                    {t("settings.appearance.fontSize")}
                  </span>
                  <input
                    type="range"
                    min={13}
                    max={22}
                    step={1}
                    value={localSettings.fontSize}
                    aria-label={t("settings.appearance.fontSize")}
                    className="accent-[var(--theme-primary)]"
                    onChange={(event) =>
                      setLocalSettings((prev) => ({
                        ...prev,
                        fontSize: Number.parseInt(event.target.value, 10),
                      }))
                    }
                  />
                  <output className="text-right text-[13px] tabular-nums text-[var(--theme-control-text)]">
                    {localSettings.fontSize}px
                  </output>
                </label>
              </fieldset>

              <div className="grid gap-2.5">
                <h3 className={settingsFieldLabelClassName}>
                  {t("settings.appearance.themeTitle")}
                </h3>
                <label className="grid grid-cols-[minmax(120px,160px)_minmax(0,1fr)] items-center gap-3 max-[760px]:grid-cols-1">
                  <span className={settingsFieldLabelClassName}>
                    {t("settings.appearance.applyMode")}
                  </span>
                  <select
                    className={settingsInputClassName}
                    value={localSettings.theme}
                    onChange={(event) =>
                      setLocalSettings((prev) => ({
                        ...prev,
                        theme: event.target.value as WebTheme,
                      }))
                    }
                  >
                    <option value="system">{t("settings.appearance.modeSystem")}</option>
                    <option value="light">{t("settings.appearance.modeLight")}</option>
                    <option value="dark">{t("settings.appearance.modeDark")}</option>
                  </select>
                </label>

                <label className="grid grid-cols-[minmax(120px,160px)_minmax(0,1fr)] items-center gap-3 max-[760px]:grid-cols-1">
                  <span className={settingsFieldLabelClassName}>
                    {t("settings.appearance.lightTheme")}
                  </span>
                  <select
                    className={settingsInputClassName}
                    value={localSettings.lightTheme}
                    onChange={(event) =>
                      setLocalSettings((prev) => ({
                        ...prev,
                        lightTheme: event.target.value as BuiltInThemeId,
                      }))
                    }
                  >
                    {BUILT_IN_LIGHT_THEME_OPTIONS.map((opt) => (
                      <option key={opt.id} value={opt.id}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="grid grid-cols-[minmax(120px,160px)_minmax(0,1fr)] items-center gap-3 max-[760px]:grid-cols-1">
                  <span className={settingsFieldLabelClassName}>
                    {t("settings.appearance.darkTheme")}
                  </span>
                  <select
                    className={settingsInputClassName}
                    value={localSettings.darkTheme}
                    onChange={(event) =>
                      setLocalSettings((prev) => ({
                        ...prev,
                        darkTheme: event.target.value as BuiltInThemeId,
                      }))
                    }
                  >
                    {BUILT_IN_DARK_THEME_OPTIONS.map((opt) => (
                      <option key={opt.id} value={opt.id}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
          </section>
        ),
      },
      {
        id: "other",
        label: t("settings.tabs.other"),
        description: t("settings.tabs.otherDesc"),
        panel: (
          <div className="grid gap-5">
            <section className={settingsModuleClassName} aria-labelledby="language-settings-title">
              <div className="mb-3">
                <h2 id="language-settings-title" className={settingsSectionTitleClassName}>
                  {t("settings.general.languageTitle")}
                </h2>
                <p className={settingsDescriptionClassName}>{t("settings.general.languageDesc")}</p>
              </div>
              <label className="grid grid-cols-[minmax(120px,160px)_minmax(0,1fr)] items-center gap-3 max-[760px]:grid-cols-1">
                <span className={settingsFieldLabelClassName}>
                  {t("settings.general.languageField")}
                </span>
                <select
                  className={settingsInputClassName}
                  value={localSettings.language}
                  onChange={(event) => handleLanguageChange(event.target.value as LanguageSetting)}
                >
                  <option value="system">{t("settings.general.languageSystem")}</option>
                  <option value="zh">{t("settings.general.languageZh")}</option>
                  <option value="en">{t("settings.general.languageEn")}</option>
                </select>
              </label>
            </section>

            <section className={settingsModuleClassName} aria-labelledby="document-settings-title">
              <div className="mb-3">
                <h2 id="document-settings-title" className={settingsSectionTitleClassName}>
                  {t("web.documentOutput")}
                </h2>
                <p className={settingsDescriptionClassName}>{t("web.documentOutputDesc")}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {onExport && (
                  <button type="button" className={settingsSmallButtonClassName} onClick={onExport}>
                    <span className="flex items-center gap-1.5">
                      <ArrowDownTrayIcon className="size-3.5 text-[var(--theme-muted)]" />
                      <span>{t("web.exportMarkdown")}</span>
                    </span>
                  </button>
                )}
                {onCopy && (
                  <button type="button" className={settingsSmallButtonClassName} onClick={onCopy}>
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
              <section className={settingsModuleClassName} aria-labelledby="reset-settings-title">
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

            <section className={settingsModuleClassName} aria-labelledby="about-settings-title">
              <div className="mb-3">
                <h2 id="about-settings-title" className={settingsSectionTitleClassName}>
                  {t("web.aboutTitle")}
                </h2>
                <p className={settingsDescriptionClassName}>{t("web.aboutDesc")}</p>
              </div>
            </section>
          </div>
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
      onCopy,
      onClose,
      onExport,
      onReset,
      shortcutsList,
      t,
      testResult,
    ],
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm animate-in fade-in duration-150">
      <div
        data-settings-dialog="true"
        className="flex h-[min(640px,88vh)] w-full max-w-[840px] flex-col overflow-hidden rounded-xl border border-[var(--theme-border)] bg-[var(--theme-surface)] text-[var(--theme-text)] shadow-2xl animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 对齐 Desktop 的标题栏 */}
        <header className="flex min-h-[54px] shrink-0 items-center justify-between border-b border-[var(--theme-border)] bg-[var(--theme-chrome)] px-5">
          <div className="min-w-0">
            <h1
              id="settings-title"
              className="m-0 text-[17px] leading-[1.35] text-[var(--theme-title)]"
            >
              {t("settings.title")}
            </h1>
            <p className={settingsDescriptionClassName}>{t("web.settingsDescription")}</p>
          </div>
          <button
            type="button"
            className="rounded-lg p-1.5 text-[var(--theme-muted)] hover:bg-[var(--theme-control-hover)] hover:text-[var(--theme-title)]"
            onClick={handleClose}
          >
            <XMarkIcon className="size-5" />
          </button>
        </header>

        {/* 垂直两栏分栏：左侧 190px 导航，右侧滚动面板 */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <TabGroup
            vertical
            selectedIndex={selectedTabIndex}
            onChange={setSelectedTabIndex}
            className="grid min-h-0 flex-1 grid-cols-[190px_minmax(0,1fr)] overflow-hidden max-[720px]:grid-cols-1 max-[720px]:grid-rows-[auto_minmax(0,1fr)]"
          >
            <aside className="min-h-0 border-r border-[var(--theme-border)] bg-[var(--theme-chrome)] px-3 py-4 max-[720px]:border-b max-[720px]:border-r-0 max-[720px]:py-2">
              <TabList
                className="flex flex-col gap-1 max-[720px]:flex-row max-[720px]:overflow-x-auto"
                aria-label={t("web.settingsNavAria")}
              >
                {tabs.map((tab) => (
                  <Tab
                    key={tab.id}
                    className={({ selected }) =>
                      [
                        "grid min-h-[46px] w-full min-w-0 grid-cols-1 rounded-[6px] border-0 px-3 py-2 text-left outline-none transition-colors max-[720px]:min-w-[132px]",
                        selected
                          ? "bg-[var(--theme-control-active)] text-[var(--theme-title)]"
                          : "bg-transparent text-[var(--theme-control-text)] hover:bg-[var(--theme-control-hover)] hover:text-[var(--theme-title)]",
                        "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--theme-primary)]",
                      ].join(" ")
                    }
                  >
                    <span className="overflow-hidden text-ellipsis whitespace-nowrap text-[13px] font-semibold leading-[1.3]">
                      {tab.label}
                    </span>
                    <span className="overflow-hidden text-ellipsis whitespace-nowrap text-[11px] leading-[1.35] text-[var(--theme-muted)]">
                      {tab.description}
                    </span>
                  </Tab>
                ))}
              </TabList>
            </aside>
            <TabPanels className="min-h-0 overflow-auto bg-[var(--theme-surface)]">
              {tabs.map((tab) => (
                <TabPanel key={tab.id} className="min-h-full outline-none">
                  <div className="mx-auto grid w-full max-w-[760px] gap-5 px-7 py-6 max-[760px]:px-4">
                    {tab.panel}
                  </div>
                </TabPanel>
              ))}
            </TabPanels>
          </TabGroup>

          {/* 底部保存与取消按钮，完全对齐 Desktop */}
          <footer className="flex shrink-0 justify-end gap-2 border-t border-[var(--theme-border)] bg-[var(--theme-chrome)] px-5 py-3.5">
            <button type="button" className={dialogButtonClassName} onClick={handleClose}>
              {t("common.cancel")}
            </button>
            <button type="button" className={primaryDialogButtonClassName} onClick={handleSave}>
              {t("common.save")}
            </button>
          </footer>
        </div>
      </div>
    </div>
  );
}
