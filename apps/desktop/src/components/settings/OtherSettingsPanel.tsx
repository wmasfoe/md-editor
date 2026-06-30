import type { UpdateStatus } from "../../app/settings/app-settings";
import { updateProgressLabel } from "./settingsUtils";
import {
  settingsDescriptionClassName,
  settingsFieldLabelClassName,
  settingsInputClassName,
  settingsModuleClassName,
  settingsSectionTitleClassName,
  settingsSmallButtonClassName
} from "./settingsStyles";

interface OtherSettingsPanelProps {
  readonly assetsDirectoryDraft: string;
  readonly updateStatus: UpdateStatus;
  readonly isCheckingForUpdates: boolean;
  readonly onChangeAssetsDirectory: (value: string) => void;
  readonly onCheckForUpdates: () => void;
  readonly onInstallUpdate: () => void;
  readonly onRelaunchAfterUpdate: () => void;
}

export function OtherSettingsPanel({
  assetsDirectoryDraft,
  updateStatus,
  isCheckingForUpdates,
  onChangeAssetsDirectory,
  onCheckForUpdates,
  onInstallUpdate,
  onRelaunchAfterUpdate
}: OtherSettingsPanelProps) {
  const isUpdateBusy =
    isCheckingForUpdates ||
    updateStatus.state === "downloading" ||
    updateStatus.state === "installing";
  const canInstallUpdate = updateStatus.state === "available" && updateStatus.installKind === "app";
  const canRelaunchAfterUpdate = updateStatus.state === "installed";

  return (
    <div className="grid gap-5">
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

      <section className={settingsModuleClassName} aria-labelledby="update-settings-title">
        <div className="mb-3">
          <h2 id="update-settings-title" className={settingsSectionTitleClassName}>版本</h2>
          <p className={settingsDescriptionClassName}>{updateStatus.message}</p>
          {updateStatus.state === "available" && updateStatus.installCommand ? (
            <div className="mt-2 grid gap-1">
              <span className={settingsFieldLabelClassName}>手动安装命令</span>
              <code className="block overflow-x-auto rounded-[5px] border border-[var(--theme-border)] bg-[var(--theme-code-bg)] px-2 py-1.5 text-xs leading-normal text-[var(--theme-text)]">
                {updateStatus.installCommand}
              </code>
            </div>
          ) : null}
          {updateProgressLabel(updateStatus) ? (
            <p className={settingsDescriptionClassName}>{updateProgressLabel(updateStatus)}</p>
          ) : null}
        </div>
        <div className="flex items-center justify-between gap-3 max-[560px]:flex-col max-[560px]:items-start">
          <span className={settingsFieldLabelClassName}>当前版本 {updateStatus.currentVersion}</span>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={settingsSmallButtonClassName}
              onClick={onCheckForUpdates}
              disabled={isUpdateBusy}
            >
              {isCheckingForUpdates ? "检查中" : "检查更新"}
            </button>
            {canInstallUpdate ? (
              <button
                type="button"
                className={settingsSmallButtonClassName}
                onClick={onInstallUpdate}
              >
                安装更新
              </button>
            ) : null}
            {canRelaunchAfterUpdate ? (
              <button
                type="button"
                className={settingsSmallButtonClassName}
                onClick={onRelaunchAfterUpdate}
              >
                重启应用
              </button>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );
}
