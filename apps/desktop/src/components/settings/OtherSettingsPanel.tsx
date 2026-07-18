import type { AppUpdateSettings, UpdateStatus } from "../../app/settings/app-settings";
import { updateProgressLabel, updateStatusMessage } from "./settingsUtils";
import {
  settingsDescriptionClassName,
  settingsFieldLabelClassName,
  settingsInputClassName,
  settingsModuleClassName,
  settingsSectionTitleClassName,
  settingsSmallButtonClassName,
} from "./settingsStyles";

interface OtherSettingsPanelProps {
  readonly assetsDirectoryDraft: string;
  readonly updateStatus: UpdateStatus;
  readonly updateSettingsDraft: AppUpdateSettings;
  readonly isCheckingForUpdates: boolean;
  readonly onChangeAssetsDirectory: (value: string) => void;
  readonly onChangeUpdateSettings: (value: AppUpdateSettings) => void;
  readonly onCheckForUpdates: () => void;
  readonly onInstallUpdate: () => void;
  readonly onRelaunchAfterUpdate?: () => void;
}

export function OtherSettingsPanel({
  assetsDirectoryDraft,
  updateStatus,
  updateSettingsDraft,
  isCheckingForUpdates,
  onChangeAssetsDirectory,
  onChangeUpdateSettings,
  onCheckForUpdates,
  onInstallUpdate,
  onRelaunchAfterUpdate,
}: OtherSettingsPanelProps) {
  const isUpdateBusy =
    isCheckingForUpdates ||
    updateStatus.state === "downloading" ||
    updateStatus.state === "installing";
  const canInstallUpdate =
    (updateStatus.state === "available" || updateStatus.state === "downloaded") &&
    updateStatus.installKind === "app";
  const canRelaunchAfterUpdate = updateStatus.state === "installed";

  return (
    <div className="grid gap-5">
      <section className={settingsModuleClassName} aria-labelledby="assets-settings-title">
        <div className="mb-3">
          <h2 id="assets-settings-title" className={settingsSectionTitleClassName}>
            图片设置
          </h2>
          <p className={settingsDescriptionClassName}>
            粘贴或拖拽图片时，图片会保存到当前 Markdown 文件所在目录下的这个子目录。
          </p>
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
          <h2 id="update-settings-title" className={settingsSectionTitleClassName}>
            版本
          </h2>
          <p className={settingsDescriptionClassName}>{updateStatusMessage(updateStatus)}</p>
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
        <div className="mb-4 grid gap-2">
          <label className="flex min-h-[28px] items-center gap-2 text-[13px] text-[var(--theme-control-text)]">
            <input
              type="checkbox"
              className="size-4 accent-[var(--theme-primary)]"
              checked={updateSettingsDraft.automaticCheck}
              onChange={(event) => {
                const automaticCheck = event.target.checked;
                // 自动下载依赖自动检测；重新开启自动检测时默认帮用户勾上自动下载。
                onChangeUpdateSettings({
                  automaticCheck,
                  automaticDownload: automaticCheck,
                });
              }}
            />
            <span>自动检测更新</span>
          </label>
          <label className="flex min-h-[28px] items-center gap-2 text-[13px] text-[var(--theme-control-text)]">
            <input
              type="checkbox"
              className="size-4 accent-[var(--theme-primary)] disabled:opacity-55"
              checked={updateSettingsDraft.automaticCheck && updateSettingsDraft.automaticDownload}
              disabled={!updateSettingsDraft.automaticCheck}
              onChange={(event) => {
                onChangeUpdateSettings({
                  automaticCheck: true,
                  automaticDownload: event.target.checked,
                });
              }}
            />
            <span>自动下载更新</span>
          </label>
        </div>
        <div className="flex items-center justify-between gap-3 max-[560px]:flex-col max-[560px]:items-start">
          <span className={settingsFieldLabelClassName}>
            当前版本 {updateStatus.currentVersion}
          </span>
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
            {canRelaunchAfterUpdate && onRelaunchAfterUpdate ? (
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
