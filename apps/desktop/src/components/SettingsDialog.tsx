import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from "@headlessui/react";
import { dialogButtonClassName, primaryDialogButtonClassName } from "@md-editor/editor-ui";
import type { KeyboardEvent } from "react";
import type { AppSettings, UpdateStatus } from "../app/settings/app-settings";
import { keyboardShortcutLabel, shortcutKeyFromKeyboardEvent } from "../app/settings/app-settings";

export interface SettingsDialogProps {
  readonly settings: AppSettings;
  readonly updateStatus: UpdateStatus;
  readonly shortcutDrafts: Readonly<Record<string, string>>;
  readonly assetsDirectoryDraft: string;
  readonly errorMessage: string | null;
  readonly isSaving: boolean;
  readonly isCheckingForUpdates: boolean;
  readonly onCaptureShortcut: (id: string, key: string) => void;
  readonly onResetShortcut: (id: string) => void;
  readonly onChangeAssetsDirectory: (value: string) => void;
  readonly onSave: () => void;
  readonly onClose: () => void;
  readonly onCheckForUpdates: () => void;
}

export function SettingsDialog({
  settings,
  updateStatus,
  shortcutDrafts,
  assetsDirectoryDraft,
  errorMessage,
  isSaving,
  isCheckingForUpdates,
  onCaptureShortcut,
  onResetShortcut,
  onChangeAssetsDirectory,
  onSave,
  onClose,
  onCheckForUpdates
}: SettingsDialogProps) {
  const captureShortcut = (id: string, event: KeyboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    event.stopPropagation();

    const nextKey = shortcutKeyFromKeyboardEvent(event);
    if (nextKey) {
      onCaptureShortcut(id, nextKey);
    }
  };

  return (
    <Dialog open onClose={onClose} className="relative z-[70]">
      <DialogBackdrop className="fixed inset-0 border-0 bg-[rgba(20,27,35,0.2)]" />
      <DialogPanel className="fixed left-1/2 top-1/2 flex max-h-[min(720px,calc(100vh_-_48px))] w-[min(620px,calc(100vw_-_48px))] -translate-x-1/2 -translate-y-1/2 flex-col rounded-[10px] border border-[var(--theme-border-strong)] bg-[var(--theme-surface)] text-[var(--theme-text)] shadow-[var(--theme-shadow)]">
        <header className="flex items-start justify-between gap-4 border-b border-[var(--theme-border)] px-5 pb-3.5 pt-[18px]">
          <div>
            <DialogTitle id="settings-title" className="m-0 text-[17px] leading-[1.35] text-[var(--theme-title)]">
              设置
            </DialogTitle>
            <p className={settingsDescriptionClassName}>调整编辑器偏好和桌面端行为。</p>
          </div>
          <button
            type="button"
            className="grid size-7 place-items-center rounded-[5px] border-0 bg-transparent text-[22px] leading-none text-[var(--theme-control-text)] hover:bg-[var(--theme-control-hover)] hover:text-[var(--theme-title)]"
            aria-label="关闭设置"
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <div className="min-h-0 overflow-auto px-5 pt-2">
          <section className={settingsSectionClassName} aria-labelledby="shortcut-settings-title">
            <div className="mb-3">
              <h3 id="shortcut-settings-title" className={settingsSectionTitleClassName}>快捷键</h3>
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

          <section className={settingsSectionClassName} aria-labelledby="assets-settings-title">
            <div className="mb-3">
              <h3 id="assets-settings-title" className={settingsSectionTitleClassName}>图片资源目录</h3>
              <p className={settingsDescriptionClassName}>粘贴或拖拽图片时，图片会保存到当前 Markdown 文件所在目录下的这个子目录。</p>
            </div>
            <label className="grid grid-cols-[minmax(120px,160px)_minmax(0,1fr)] items-center gap-3 max-[760px]:grid-cols-1">
              <span className={settingsFieldLabelClassName}>目录</span>
              <input
                className={settingsInputClassName}
                value={assetsDirectoryDraft}
                onChange={(event) => onChangeAssetsDirectory(event.target.value)}
                placeholder="assets"
                spellCheck={false}
              />
            </label>
          </section>

          <section className={settingsSectionClassName} aria-labelledby="update-settings-title">
            <div className="mb-3">
              <h3 id="update-settings-title" className={settingsSectionTitleClassName}>更新</h3>
              <p className={settingsDescriptionClassName}>{updateStatus.message}</p>
            </div>
            <div className="flex items-center justify-between gap-3">
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

        {errorMessage ? (
          <p
            className="mx-5 mb-0 mt-3 rounded-md border border-[rgba(227,15,46,0.22)] bg-[var(--theme-danger-bg)] px-2.5 py-2 text-xs text-[var(--theme-danger-text)]"
            role="alert"
          >
            {errorMessage}
          </p>
        ) : null}

        <footer className="flex justify-end gap-2 border-t border-[var(--theme-border)] px-5 py-3.5">
          <button type="button" className={dialogButtonClassName} onClick={onClose}>
            取消
          </button>
          <button type="button" className={primaryDialogButtonClassName} onClick={onSave} disabled={isSaving}>
            {isSaving ? "保存中" : "保存"}
          </button>
        </footer>
      </DialogPanel>
    </Dialog>
  );
}

const settingsSectionClassName =
  "border-t border-[var(--theme-border)] py-4 first:border-t-0";

const settingsSectionTitleClassName =
  "m-0 text-sm leading-[1.4] text-[var(--theme-title)]";

const settingsDescriptionClassName =
  "mb-0 mt-1 text-xs leading-normal text-[var(--theme-muted)]";

const settingsFieldLabelClassName =
  "block text-[13px] font-semibold text-[var(--theme-title)]";

const settingsInputClassName =
  "h-[30px] w-full rounded-[5px] border border-[var(--theme-border-strong)] bg-[var(--theme-surface)] px-2 text-[13px] leading-none text-[var(--theme-text)] outline-none read-only:cursor-default focus:border-[var(--theme-primary)] focus:shadow-[0_0_0_2px_var(--theme-primary-soft)]";

const settingsSmallButtonClassName =
  "h-[30px] rounded-[5px] border border-[var(--theme-border-strong)] bg-[var(--theme-surface)] text-xs text-[var(--theme-control-text)] hover:bg-[var(--theme-control-hover)] hover:text-[var(--theme-title)] disabled:opacity-55";
