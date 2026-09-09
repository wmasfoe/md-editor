import { Tab, TabGroup, TabList, TabPanel, TabPanels } from "@headlessui/react";
import { dialogButtonClassName, primaryDialogButtonClassName } from "@md-editor/editor-ui";
import { useTranslation } from "@md-editor/i18n";
import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isComposingKeyboardEvent } from "../lib/keyboard";
import { useAppSettings } from "../app/settings-context";
import { useSettingsController } from "../app/controller/useSettingsController";
import { useToast } from "../app/controller/useToast";
import { EditorToast } from "../app/AppWindowChrome";
import { AiSettingsPanel } from "./settings/AiSettingsPanel";
import { AppearanceSettingsPanel } from "./settings/AppearanceSettingsPanel";
import { PluginSettingsPanel } from "./settings/PluginSettingsPanel";
import { OtherSettingsPanel } from "./settings/OtherSettingsPanel";
import { ShortcutSettingsPanel } from "./settings/ShortcutSettingsPanel";
import { settingsDescriptionClassName } from "./settings/settingsStyles";

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
  const { settings, updateStatus } = useAppSettings();
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

  const tabs = useMemo(
    () => [
      {
        id: "shortcuts",
        label: t("settings.tabs.shortcuts"),
        description: t("settings.tabs.shortcutsDesc"),
        panel: (
          <ShortcutSettingsPanel
            shortcuts={settings.shortcuts}
            shortcutDrafts={ctrl.shortcutDrafts}
            onCaptureShortcut={ctrl.captureShortcutDraft}
            onResetShortcut={ctrl.resetShortcutDraft}
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
        id: "appearance",
        label: t("settings.tabs.appearance"),
        description: t("settings.tabs.appearanceDesc"),
        panel: (
          <AppearanceSettingsPanel
            editorSettingsDraft={ctrl.editorSettingsDraft}
            themeDraft={ctrl.themeDraft}
            onChangeEditorSettings={ctrl.setEditorSettingsDraft}
            onChangeTheme={ctrl.setThemeDraft}
            onChooseThemeCss={ctrl.chooseThemeCss}
            onClearThemeCss={ctrl.clearThemeCss}
          />
        ),
      },
      {
        id: "plugins",
        label: t("settings.tabs.plugins"),
        description: t("settings.tabs.pluginsDesc"),
        panel: (
          <PluginSettingsPanel
            pluginsDraft={ctrl.pluginsDraft}
            onTogglePlugin={ctrl.togglePluginDraft}
          />
        ),
      },
      {
        id: "other",
        label: t("settings.tabs.general"),
        description: t("settings.tabs.generalDesc"),
        panel: (
          <OtherSettingsPanel
            languageDraft={ctrl.languageDraft}
            assetsDirectoryDraft={ctrl.assetsDirectoryDraft}
            updateStatus={updateStatus}
            updateSettingsDraft={ctrl.updateSettingsDraft}
            isCheckingForUpdates={updateStatus.state === "checking"}
            onChangeLanguage={ctrl.setLanguageDraft}
            onChangeAssetsDirectory={ctrl.setAssetsDirectoryDraft}
            onChangeUpdateSettings={ctrl.setUpdateSettingsDraft}
            onCheckForUpdates={() => void ctrl.runUpdateCheck()}
            onInstallUpdate={() => void ctrl.installUpdate()}
            onRelaunchAfterUpdate={onRelaunchAfterUpdate}
          />
        ),
      },
    ],
    [ctrl, onRelaunchAfterUpdate, settings.shortcuts, t, updateStatus],
  );

  return (
    <section
      className="flex h-full min-h-0 w-full flex-col bg-[var(--theme-surface)] text-[var(--theme-text)]"
      aria-labelledby="settings-title"
    >
      {/* toast 只在独立设置窗口中显示，主窗口内嵌模式共用主窗口 toast */}
      {surface === "settings-window" ? <EditorToast toast={toast} /> : null}

      <header
        data-tauri-drag-region={onStartWindowDrag ? true : undefined}
        className="flex min-h-[54px] shrink-0 items-center gap-4 border-b border-[var(--theme-border)] bg-[var(--theme-chrome)] px-5"
        onMouseDown={onStartWindowDrag}
      >
        <div data-tauri-drag-region={onStartWindowDrag ? true : undefined} className="min-w-0">
          <h1
            id="settings-title"
            className="m-0 text-[17px] leading-[1.35] text-[var(--theme-title)]"
          >
            {t("settings.title")}
          </h1>
          <p className={settingsDescriptionClassName}>{t("settings.title")}</p>
        </div>
      </header>

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
              aria-label={t("settings.title")}
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

        {ctrl.settingsErrorMessage ? (
          <p
            className="mx-auto mb-0 mt-[-2px] w-[min(920px,calc(100%_-_48px))] rounded-md border border-[rgba(227,15,46,0.22)] bg-[var(--theme-danger-bg)] px-2.5 py-2 text-xs text-[var(--theme-danger-text)] max-[760px]:w-[calc(100%_-_32px)]"
            role="alert"
          >
            {ctrl.settingsErrorMessage}
          </p>
        ) : null}

        <footer className="flex shrink-0 justify-end gap-2 border-t border-[var(--theme-border)] bg-[var(--theme-chrome)] px-5 py-3.5">
          <button type="button" className={dialogButtonClassName} onClick={ctrl.closeSettings}>
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className={primaryDialogButtonClassName}
            onClick={() => void ctrl.saveSettings()}
            disabled={ctrl.isSavingSettings}
          >
            {ctrl.isSavingSettings ? t("common.loading") : t("common.save")}
          </button>
        </footer>
      </div>
    </section>
  );
}

export const SettingsDialog = SettingsPage;
