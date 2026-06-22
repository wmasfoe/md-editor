import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from "@headlessui/react";
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
    <Dialog open onClose={onClose} className="settings-dialog">
      <DialogBackdrop className="settings-dialog__backdrop" />
      <DialogPanel className="settings-dialog__panel">
        <header className="settings-dialog__header">
          <div>
            <DialogTitle id="settings-title">设置</DialogTitle>
            <p>调整编辑器偏好和桌面端行为。</p>
          </div>
          <button type="button" className="settings-dialog__close" aria-label="关闭设置" onClick={onClose}>
            ×
          </button>
        </header>

        <div className="settings-dialog__content">
          <section className="settings-section" aria-labelledby="shortcut-settings-title">
            <div className="settings-section__heading">
              <h3 id="shortcut-settings-title">快捷键</h3>
              <p>点击输入框后按下组合键，系统会自动记录键位。</p>
            </div>
            <div className="settings-shortcut-list">
              {settings.shortcuts.map((shortcut) => (
                <label key={shortcut.id} className="settings-shortcut-row">
                  <span>
                    <strong>{shortcut.label}</strong>
                    <small>默认 {keyboardShortcutLabel(shortcut.defaultKey)}</small>
                  </span>
                  <input
                    value={shortcutDrafts[shortcut.id] ?? keyboardShortcutLabel(shortcut.key)}
                    onKeyDown={(event) => captureShortcut(shortcut.id, event)}
                    onChange={() => undefined}
                    readOnly
                    spellCheck={false}
                    aria-label={`${shortcut.label}快捷键`}
                  />
                  <button type="button" onClick={() => onResetShortcut(shortcut.id)}>
                    重置
                  </button>
                </label>
              ))}
            </div>
          </section>

          <section className="settings-section" aria-labelledby="assets-settings-title">
            <div className="settings-section__heading">
              <h3 id="assets-settings-title">图片资源目录</h3>
              <p>粘贴或拖拽图片时，图片会保存到当前 Markdown 文件所在目录下的这个子目录。</p>
            </div>
            <label className="settings-field">
              <span>目录</span>
              <input
                value={assetsDirectoryDraft}
                onChange={(event) => onChangeAssetsDirectory(event.target.value)}
                placeholder="assets"
                spellCheck={false}
              />
            </label>
          </section>

          <section className="settings-section" aria-labelledby="update-settings-title">
            <div className="settings-section__heading">
              <h3 id="update-settings-title">更新</h3>
              <p>{updateStatus.message}</p>
            </div>
            <div className="settings-update-row">
              <span>当前版本 {updateStatus.currentVersion}</span>
              <button type="button" onClick={onCheckForUpdates} disabled={isCheckingForUpdates}>
                {isCheckingForUpdates ? "检查中" : "检查更新"}
              </button>
            </div>
          </section>
        </div>

        {errorMessage ? (
          <p className="settings-dialog__error" role="alert">
            {errorMessage}
          </p>
        ) : null}

        <footer className="settings-dialog__actions">
          <button type="button" className="dialog-button" onClick={onClose}>
            取消
          </button>
          <button type="button" className="dialog-button dialog-button--primary" onClick={onSave} disabled={isSaving}>
            {isSaving ? "保存中" : "保存"}
          </button>
        </footer>
      </DialogPanel>
    </Dialog>
  );
}
