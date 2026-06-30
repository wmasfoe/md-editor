import { Tab, TabGroup, TabList, TabPanel, TabPanels } from "@headlessui/react";
import { dialogButtonClassName, primaryDialogButtonClassName } from "@md-editor/editor-ui";
import { useEffect, useMemo, useState, type MouseEvent, type ReactNode } from "react";
import type { AiSettings } from "@md-editor/editor-core";
import type {
  AppSettings,
  AppThemeSettings,
  UpdateStatus
} from "../app/settings/app-settings";
import { isComposingKeyboardEvent } from "../lib/keyboard";
import { AiSettingsPanel } from "./settings/AiSettingsPanel";
import { AppearanceSettingsPanel } from "./settings/AppearanceSettingsPanel";
import { OtherSettingsPanel } from "./settings/OtherSettingsPanel";
import { ShortcutSettingsPanel } from "./settings/ShortcutSettingsPanel";
import { settingsDescriptionClassName } from "./settings/settingsStyles";

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
  readonly onInstallUpdate: () => void;
  readonly onRelaunchAfterUpdate: () => void;
  readonly onStartWindowDrag?: (event: MouseEvent<HTMLElement>) => void;
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
  onCheckForUpdates,
  onInstallUpdate,
  onRelaunchAfterUpdate,
  onStartWindowDrag
}: SettingsPageProps) {
  const [selectedTabIndex, setSelectedTabIndex] = useState(0);

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

  const settingsTabs: readonly SettingsTabDefinition[] = useMemo(
    () => [
      {
        id: "shortcuts",
        label: "快捷键设置",
        description: "命令键位",
        panel: (
          <ShortcutSettingsPanel
            shortcuts={settings.shortcuts}
            shortcutDrafts={shortcutDrafts}
            onCaptureShortcut={onCaptureShortcut}
            onResetShortcut={onResetShortcut}
          />
        )
      },
      {
        id: "ai",
        label: "AI 设置",
        description: "续写、修复和模型",
        panel: (
          <AiSettingsPanel
            aiSettingsDraft={aiSettingsDraft}
            isLocalModelActionPending={isLocalModelActionPending}
            onChangeAiSettings={onChangeAiSettings}
            onDownloadLocalModel={onDownloadLocalModel}
            onCancelLocalModelDownload={onCancelLocalModelDownload}
            onDeleteLocalModel={onDeleteLocalModel}
          />
        )
      },
      {
        id: "appearance",
        label: "外观设置",
        description: "主题和自定义 CSS",
        panel: (
          <AppearanceSettingsPanel
            themeDraft={themeDraft}
            onChangeTheme={onChangeTheme}
            onChooseThemeCss={onChooseThemeCss}
            onClearThemeCss={onClearThemeCss}
          />
        )
      },
      {
        id: "other",
        label: "其他设置",
        description: "图片目录和版本",
        panel: (
          <OtherSettingsPanel
            assetsDirectoryDraft={assetsDirectoryDraft}
            updateStatus={updateStatus}
            isCheckingForUpdates={isCheckingForUpdates}
            onChangeAssetsDirectory={onChangeAssetsDirectory}
            onCheckForUpdates={onCheckForUpdates}
            onInstallUpdate={onInstallUpdate}
            onRelaunchAfterUpdate={onRelaunchAfterUpdate}
          />
        )
      }
    ],
    [
      aiSettingsDraft,
      assetsDirectoryDraft,
      isCheckingForUpdates,
      isLocalModelActionPending,
      onCancelLocalModelDownload,
      onCaptureShortcut,
      onChangeAiSettings,
      onChangeAssetsDirectory,
      onChangeTheme,
      onCheckForUpdates,
      onChooseThemeCss,
      onClearThemeCss,
      onDeleteLocalModel,
      onDownloadLocalModel,
      onInstallUpdate,
      onRelaunchAfterUpdate,
      onResetShortcut,
      settings.shortcuts,
      shortcutDrafts,
      themeDraft,
      updateStatus
    ]
  );

  return (
    <section className="flex h-full min-h-0 w-full flex-col bg-[var(--theme-surface)] text-[var(--theme-text)]" aria-labelledby="settings-title">
      <header
        data-tauri-drag-region={onStartWindowDrag ? true : undefined}
        className="flex min-h-[54px] shrink-0 items-center gap-4 border-b border-[var(--theme-border)] bg-[var(--theme-chrome)] px-5"
        onMouseDown={onStartWindowDrag}
      >
        <div data-tauri-drag-region={onStartWindowDrag ? true : undefined} className="min-w-0">
          <h1 id="settings-title" className="m-0 text-[17px] leading-[1.35] text-[var(--theme-title)]">
            设置
          </h1>
          <p className={settingsDescriptionClassName}>调整编辑器偏好和桌面端行为。</p>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <TabGroup
          vertical
          selectedIndex={selectedTabIndex}
          onChange={setSelectedTabIndex}
          className="grid min-h-0 flex-1 grid-cols-[190px_minmax(0,1fr)] overflow-hidden max-[720px]:grid-cols-1 max-[720px]:grid-rows-[auto_minmax(0,1fr)]"
        >
          {/* 左侧分类是设置窗口的主导航；新增设置项应先归入已有分类，避免退回一整页长表单。 */}
          <aside className="min-h-0 border-r border-[var(--theme-border)] bg-[var(--theme-chrome)] px-3 py-4 max-[720px]:border-b max-[720px]:border-r-0 max-[720px]:py-2">
            <TabList className="flex flex-col gap-1 max-[720px]:flex-row max-[720px]:overflow-x-auto" aria-label="设置分类">
              {settingsTabs.map((tab) => (
                <Tab
                  key={tab.id}
                  className={({ selected }) =>
                    [
                      "grid min-h-[46px] w-full min-w-0 grid-cols-1 rounded-[6px] border-0 px-3 py-2 text-left outline-none transition-colors max-[720px]:min-w-[132px]",
                      selected
                        ? "bg-[var(--theme-control-active)] text-[var(--theme-title)]"
                        : "bg-transparent text-[var(--theme-control-text)] hover:bg-[var(--theme-control-hover)] hover:text-[var(--theme-title)]",
                      "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--theme-primary)]"
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
            {settingsTabs.map((tab) => (
              <TabPanel key={tab.id} className="min-h-full outline-none">
                <div className="mx-auto grid w-full max-w-[760px] gap-5 px-7 py-6 max-[760px]:px-4">
                  {tab.panel}
                </div>
              </TabPanel>
            ))}
          </TabPanels>
        </TabGroup>

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

interface SettingsTabDefinition {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly panel: ReactNode;
}
