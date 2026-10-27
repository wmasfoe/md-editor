import { useTranslation } from "@md-editor/i18n";
import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  SettingsShell,
  type SettingsTabItem,
  EditorSettingsPanel,
  AppearanceSettingsPanel,
  PluginSettingsPanel,
  ShortcutSettingsPanel,
  GeneralSettingsPanel,
} from "@md-editor/editor-ui/settings";
import {
  keyboardShortcutLabel,
  shortcutKeyFromKeyboardEvent,
  type BuiltInThemeId,
} from "../app/settings/app-settings";
import { isComposingKeyboardEvent } from "../lib/keyboard";
import { useAppSettings } from "../app/settings-context";
import { useSettingsController } from "../app/controller/useSettingsController";
import { useToast } from "../app/controller/useToast";
import { EditorToast } from "../app/AppWindowChrome";
import { AiSettingsPanel } from "./settings/AiSettingsPanel";
import { UpdateSettingsPanel } from "./settings/UpdateSettingsPanel";
import { isVersionSkipped } from "../app/updates/presentation";
import { openExternalTarget } from "../desktop/link-service";
import { APP_CHANGELOG_URL, APP_RELEASES_URL } from "../lib/app-links";
import { openAboutWindowWithToast } from "../desktop/about-window";
import { APP_DISPLAY_NAME } from "../lib/app-name";

interface SettingsPageProps {
  // "main" = 主窗口内嵌降级，"settings-window" = 独立设置窗口
  readonly surface?: "main" | "settings-window";
  readonly onStartWindowDrag?: (event: MouseEvent<HTMLElement>) => void;
  readonly onRelaunchAfterUpdate?: () => void;
}

export function SettingsPage({
  surface = "main",
  onStartWindowDrag,
  onRelaunchAfterUpdate,
}: SettingsPageProps) {
  const { settings, updateStatus, skipUpdateVersion, updatePromptState, lastCheckedAt } =
    useAppSettings();
  const { toast, showToast } = useToast();
  const ctrl = useSettingsController({ showToast, surface });
  const { closeSettings, destroySettingsWindowAfterRollback } = ctrl;
  const [selectedTabIndex, setSelectedTabIndex] = useState(0);

  // settings-window：监听原生关闭按钮，回滚主题预览后再销毁窗口
  useEffect(() => {
    if (surface !== "settings-window" || !isTauri()) return;
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void getCurrentWindow()
      .onCloseRequested((event) => {
        event.preventDefault();
        void destroySettingsWindowAfterRollback().catch((error: unknown) => {
          console.warn("设置窗口关闭回滚失败", error);
        });
      })
      .then((dispose) => {
        if (disposed) {
          dispose();
          return;
        }
        unlisten = dispose;
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [destroySettingsWindowAfterRollback, surface]);

  useEffect(() => {
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (
        event.key !== "Escape" ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.shiftKey ||
        isComposingKeyboardEvent(event)
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      closeSettings();
    };
    window.addEventListener("keydown", closeOnEscape, { capture: true });
    return () => window.removeEventListener("keydown", closeOnEscape, { capture: true });
  }, [closeSettings]);

  const { t } = useTranslation();

  const formattedShortcuts = useMemo(
    () =>
      settings.shortcuts.map((shortcut) => ({
        id: shortcut.id,
        commandId: shortcut.commandId,
        label: shortcut.label,
        key: keyboardShortcutLabel(shortcut.key),
        defaultKey: keyboardShortcutLabel(shortcut.defaultKey),
      })),
    [settings.shortcuts],
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
              value: ctrl.editorSettingsDraft.wysiwygFontSize,
              onChange: (size) =>
                ctrl.setEditorSettingsDraft((prev) => ({ ...prev, wysiwygFontSize: size })),
            }}
            proseFont={{
              value: ctrl.editorSettingsDraft.proseFontFamily,
              onChange: (family) =>
                ctrl.setEditorSettingsDraft((prev) => ({ ...prev, proseFontFamily: family })),
            }}
            codeFont={{
              value: ctrl.editorSettingsDraft.codeFontFamily,
              onChange: (family) =>
                ctrl.setEditorSettingsDraft((prev) => ({ ...prev, codeFontFamily: family })),
            }}
            showLineNumbers={{
              checked: ctrl.editorSettingsDraft.showCodeBlockLineNumbers,
              onChange: (checked) =>
                ctrl.setEditorSettingsDraft((prev) => ({
                  ...prev,
                  showCodeBlockLineNumbers: checked,
                })),
            }}
            showInlineStyleMarkers={{
              checked: ctrl.editorSettingsDraft.showInlineStyleMarkers,
              onChange: (checked) =>
                ctrl.setEditorSettingsDraft((prev) => ({
                  ...prev,
                  showInlineStyleMarkers: checked,
                })),
            }}
            enableMarkdownLint={{
              checked: ctrl.editorSettingsDraft.enableMarkdownLint,
              onChange: (checked) =>
                ctrl.setEditorSettingsDraft((prev) => ({
                  ...prev,
                  enableMarkdownLint: checked,
                })),
            }}
            assetsDirectory={{
              value: ctrl.assetsDirectoryDraft,
              onChange: ctrl.setAssetsDirectoryDraft,
            }}
          />
        ),
      },
      {
        id: "appearance",
        label: t("settings.tabs.appearance"),
        description: t("settings.tabs.appearanceDesc"),
        panel: (
          <AppearanceSettingsPanel
            mode={ctrl.themeDraft.mode}
            onChangeMode={(mode) => ctrl.setThemeDraft((prev) => ({ ...prev, mode }))}
            builtInThemes={{
              lightTheme: ctrl.themeDraft.light.builtinTheme,
              darkTheme: ctrl.themeDraft.dark.builtinTheme,
              onChangeLightTheme: (theme) =>
                ctrl.setThemeDraft((prev) => ({
                  ...prev,
                  light: { ...prev.light, builtinTheme: theme as BuiltInThemeId },
                })),
              onChangeDarkTheme: (theme) =>
                ctrl.setThemeDraft((prev) => ({
                  ...prev,
                  dark: { ...prev.dark, builtinTheme: theme as BuiltInThemeId },
                })),
            }}
            customCss={{
              lightPath: ctrl.themeDraft.light.customCssPath,
              darkPath: ctrl.themeDraft.dark.customCssPath,
              onChoose: (scheme) => void ctrl.chooseThemeCss(scheme),
              onClear: (scheme) => ctrl.clearThemeCss(scheme),
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
            plugins={ctrl.pluginsDraft}
            onTogglePlugin={ctrl.togglePluginDraft}
          />
        ),
      },
      {
        id: "ai",
        label: t("settings.tabs.ai"),
        description: t("settings.tabs.aiDesc"),
        panel: (
          <AiSettingsPanel
            aiSettingsDraft={ctrl.aiSettingsDraft}
            isLocalModelActionPending={ctrl.isLocalModelActionPending}
            allModelStatuses={ctrl.allModelStatuses}
            systemSpecs={ctrl.systemSpecs}
            isCheckingModelUpdates={ctrl.isCheckingModelUpdates}
            onChangeAiSettings={ctrl.setAiSettingsDraft}
            onDownloadLocalModel={ctrl.downloadLocalModel}
            onCancelLocalModelDownload={ctrl.cancelLocalModelDownload}
            onDeleteLocalModel={ctrl.deleteLocalModel}
            onCheckModelUpdates={ctrl.checkLocalModelUpdates}
          />
        ),
      },
      {
        id: "shortcuts",
        label: t("settings.tabs.shortcuts"),
        description: t("settings.tabs.shortcutsDesc"),
        panel: (
          <ShortcutSettingsPanel
            mode="editable"
            shortcuts={formattedShortcuts}
            shortcutDrafts={ctrl.shortcutDrafts}
            onCaptureShortcut={(id, event) => {
              event.preventDefault();
              event.stopPropagation();
              const nextKey = shortcutKeyFromKeyboardEvent(event);
              if (nextKey) {
                ctrl.captureShortcutDraft(id, nextKey);
              }
            }}
            onResetShortcut={ctrl.resetShortcutDraft}
          />
        ),
      },
      {
        id: "updates",
        label: t("settings.tabs.updates"),
        description: t("settings.tabs.updatesDesc"),
        panel: (
          <UpdateSettingsPanel
            updateStatus={updateStatus}
            isSkippedVersion={isVersionSkipped(updateStatus, updatePromptState)}
            updateSettingsDraft={ctrl.updateSettingsDraft}
            isCheckingForUpdates={updateStatus.state === "checking"}
            lastCheckedAt={lastCheckedAt}
            onChangeUpdateSettings={ctrl.setUpdateSettingsDraft}
            onCheckForUpdates={() => void ctrl.runUpdateCheck()}
            onInstallUpdate={() => void ctrl.installUpdate()}
            onRelaunchAfterUpdate={onRelaunchAfterUpdate}
            onSkipVersion={() => void skipUpdateVersion()}
            onOpenChangelog={() => void openExternalTarget(APP_CHANGELOG_URL)}
            onOpenEnglishChangelog={() =>
              void openExternalTarget(updateStatus.releaseUrl ?? APP_RELEASES_URL)
            }
            onOpenInstallerDownload={(url) => void openExternalTarget(url)}
          />
        ),
      },
      {
        id: "general",
        label: t("settings.tabs.general"),
        description: t("settings.tabs.generalDesc"),
        panel: (
          <GeneralSettingsPanel
            language={{
              value: ctrl.languageDraft,
              onChange: ctrl.setLanguageDraft,
            }}
            errorReporting={{
              enabled: ctrl.errorReportingDraft.enabled,
              onChange: (enabled) => ctrl.setErrorReportingDraft({ enabled }),
            }}
            about={{
              appName: APP_DISPLAY_NAME,
              onOpen: () => void openAboutWindowWithToast(showToast),
            }}
          />
        ),
      },
    ],
    [
      ctrl,
      formattedShortcuts,
      lastCheckedAt,
      onRelaunchAfterUpdate,
      showToast,
      skipUpdateVersion,
      t,
      updatePromptState,
      updateStatus,
    ],
  );

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      {/* toast 只在独立设置窗口中显示，主窗口内嵌模式共用主窗口 toast */}
      {surface === "settings-window" ? <EditorToast toast={toast} /> : null}

      <SettingsShell
        variant="page"
        title={t("settings.title")}
        tabs={tabs}
        selectedTabIndex={selectedTabIndex}
        onSelectTab={setSelectedTabIndex}
        onClose={ctrl.closeSettings}
        onSave={() => void ctrl.saveSettings()}
        isSaving={ctrl.isSavingSettings}
        errorMessage={ctrl.settingsErrorMessage}
        onStartWindowDrag={onStartWindowDrag}
        cancelText={t("common.cancel")}
        saveText={t("common.save")}
        loadingText={t("common.loading")}
      />
    </div>
  );
}

export const SettingsDialog = SettingsPage;
