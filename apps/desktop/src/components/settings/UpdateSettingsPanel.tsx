import { t } from "@md-editor/i18n";
import type { ChangelogEntry } from "@md-editor/changelog";
import type { AppUpdateSettings, UpdateStatus } from "../../app/settings/app-settings";
import { readReleaseNotesEntry } from "../../app/updates/release-notes";
import { useEffect, useRef, useState } from "react";
import { updateDownloadProgress, updateStatusMessage } from "./settingsUtils";
import { UpdateReleaseNotes } from "../updates/UpdateReleaseNotes";
import {
  settingsDescriptionClassName,
  settingsModuleClassName,
  settingsSectionTitleClassName,
  settingsSmallButtonClassName,
} from "./settingsStyles";

/**
 * @fileoverview 设置 →「更新」Tab
 *
 * 只呈现「当前版本 → 最新版本 + 状态 + 进度 + 本次更新日志 + 操作 + 自动更新开关」。
 * 版本历史不在范围内（与官网 changelog 保持单一事实源，不在此处复制）。
 */

interface UpdateSettingsPanelProps {
  readonly updateStatus: UpdateStatus;
  /** 该版本是否已被跳过：跳过后不再提供同一个动作，避免重复写簿记 */
  readonly isSkippedVersion: boolean;
  readonly updateSettingsDraft: AppUpdateSettings;
  readonly isCheckingForUpdates: boolean;
  readonly lastCheckedAt: string | null;
  readonly onChangeUpdateSettings: (value: AppUpdateSettings) => void;
  readonly onCheckForUpdates: () => void;
  readonly onInstallUpdate: () => void;
  readonly onRelaunchAfterUpdate?: () => void;
  readonly onSkipVersion: () => void;
  readonly onOpenChangelog: () => void;
  readonly onOpenEnglishChangelog: () => void;
  /** 手动安装通道：打开安装包下载页 */
  readonly onOpenInstallerDownload: (url: string) => void;
}

/** 状态徽标：把状态机压成用户能一眼读完的 4 种色调。 */
type StatusTone = "neutral" | "accent" | "progress" | "danger";

function resolveStatusTone(status: UpdateStatus["state"]): StatusTone {
  switch (status) {
    case "available":
    case "downloaded":
    case "installed":
      return "accent";
    case "checking":
    case "downloading":
    case "installing":
      return "progress";
    case "error":
      return "danger";
    default:
      return "neutral";
  }
}

const STATUS_TONE_CLASS: Record<StatusTone, string> = {
  neutral: "border-[var(--theme-border-strong)] text-[var(--theme-muted)]",
  accent: "border-[var(--theme-primary)] text-[var(--theme-primary)]",
  progress: "border-[var(--theme-border-strong)] text-[var(--theme-control-text)]",
  danger: "border-[var(--theme-danger-text)] text-[var(--theme-danger-text)]",
};

export function UpdateSettingsPanel({
  updateStatus,
  isSkippedVersion,
  updateSettingsDraft,
  isCheckingForUpdates,
  lastCheckedAt,
  onChangeUpdateSettings,
  onCheckForUpdates,
  onInstallUpdate,
  onRelaunchAfterUpdate,
  onSkipVersion,
  onOpenChangelog,
  onOpenEnglishChangelog,
  onOpenInstallerDownload,
}: UpdateSettingsPanelProps) {
  const [hasCopiedCommand, setHasCopiedCommand] = useState(false);
  const copyResetTimer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(copyResetTimer.current), []);

  const copyInstallCommand = () => {
    const command = updateStatus.installCommand;
    if (!command) return;
    void navigator.clipboard.writeText(command).then(() => {
      setHasCopiedCommand(true);
      copyResetTimer.current = window.setTimeout(() => setHasCopiedCommand(false), 2000);
    });
  };

  const isBusy =
    isCheckingForUpdates ||
    updateStatus.state === "downloading" ||
    updateStatus.state === "installing";
  const canInstall =
    (updateStatus.state === "available" || updateStatus.state === "downloaded") &&
    updateStatus.installKind === "app";
  const canRelaunch = updateStatus.state === "installed";
  const canSkip =
    updateStatus.state === "available" && updateStatus.installKind === "app" && !isSkippedVersion;
  // updater manifest 不可用时后端会退回 GitHub Releases（installKind: "manual"），
  // 这条降级通道必须保留可执行的恢复动作，否则用户只能自己找安装包。
  const isManualInstall = updateStatus.installKind === "manual";
  const notesEntry: ChangelogEntry | null = readReleaseNotesEntry(updateStatus);
  const tone = resolveStatusTone(updateStatus.state);

  const progress = updateDownloadProgress(updateStatus);

  return (
    <div className="grid gap-5">
      <section className={settingsModuleClassName} aria-labelledby="update-version-title">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="update-version-title" className={settingsSectionTitleClassName}>
              {t("settings.updates.title")}
            </h2>
            <p className={settingsDescriptionClassName}>{updateStatusMessage(updateStatus)}</p>
          </div>
          <span
            className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] leading-[1.5] ${STATUS_TONE_CLASS[tone]}`}
          >
            {updateStatusBadgeLabel(updateStatus.state)}
          </span>
        </div>

        <div className="mb-3 grid gap-1 rounded-[6px] border border-[var(--theme-border)] bg-[var(--theme-code-bg)] px-3 py-2">
          <div className="flex items-baseline justify-between gap-3 text-[12px]">
            <span className="text-[var(--theme-muted)]">
              {t("settings.general.currentVersion", {
                version: updateStatus.currentVersion,
              })}
            </span>
            <span className="font-[600] text-[var(--theme-title)]">
              {updateStatus.latestVersion
                ? t("settings.updates.versionTransition", {
                    current: updateStatus.currentVersion,
                    latest: updateStatus.latestVersion,
                  })
                : t("settings.updates.latestVersion", {
                    version: updateStatus.currentVersion,
                  })}
            </span>
          </div>
          <p className="m-0 text-[11px] text-[var(--theme-muted)]">
            {lastCheckedAt
              ? t("settings.updates.lastChecked", { time: formatCheckedAt(lastCheckedAt) })
              : t("settings.updates.neverChecked")}
          </p>
        </div>

        {progress ? (
          <div className="mb-3 grid gap-1" role="status" aria-live="polite">
            <div
              className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--theme-border)]"
              aria-hidden="true"
            >
              <div
                className="h-full rounded-full bg-[var(--theme-primary)] transition-[width] duration-200 motion-reduce:transition-none"
                style={{ width: `${progress.percent}%` }}
              />
            </div>
            <p className="m-0 text-[11px] text-[var(--theme-muted)]">{progress.label}</p>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={settingsSmallButtonClassName}
            onClick={onCheckForUpdates}
            disabled={isBusy}
          >
            {isCheckingForUpdates
              ? t("settings.general.checking")
              : t("settings.updates.actions.check")}
          </button>
          {canInstall ? (
            <button
              type="button"
              className={settingsSmallButtonClassName}
              onClick={onInstallUpdate}
              disabled={isBusy}
            >
              {updateStatus.state === "downloaded"
                ? t("settings.updates.actions.installAndRelaunch")
                : t("settings.updates.actions.download")}
            </button>
          ) : null}
          {canRelaunch && onRelaunchAfterUpdate ? (
            <button
              type="button"
              className={settingsSmallButtonClassName}
              onClick={onRelaunchAfterUpdate}
            >
              {t("settings.updates.actions.relaunch")}
            </button>
          ) : null}
          {canSkip ? (
            <button type="button" className={settingsSmallButtonClassName} onClick={onSkipVersion}>
              {t("settings.updates.actions.skipVersion")}
            </button>
          ) : null}
        </div>

        {isManualInstall && updateStatus.installCommand ? (
          <div className="mt-3 grid gap-1">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[12px] text-[var(--theme-muted)]">
                {t("settings.general.manualInstallCommand")}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className={settingsSmallButtonClassName}
                  onClick={copyInstallCommand}
                >
                  {hasCopiedCommand
                    ? t("settings.general.copied")
                    : t("settings.general.copyCommand")}
                </button>
                {updateStatus.downloadUrl ? (
                  <button
                    type="button"
                    className={settingsSmallButtonClassName}
                    onClick={() => onOpenInstallerDownload(updateStatus.downloadUrl ?? "")}
                  >
                    {t("settings.general.downloadInstaller")}
                  </button>
                ) : null}
              </div>
            </div>
            <code className="block overflow-x-auto rounded-[5px] border border-[var(--theme-border)] bg-[var(--theme-code-bg)] px-2 py-1.5 text-[11px] leading-normal text-[var(--theme-text)]">
              {updateStatus.installCommand}
            </code>
          </div>
        ) : null}
      </section>

      {notesEntry ? (
        <section className={settingsModuleClassName} aria-labelledby="update-notes-title">
          <h2 id="update-notes-title" className={settingsSectionTitleClassName}>
            {t("settings.updates.notesTitle")}
          </h2>
          <div className="mt-2 max-h-[260px] overflow-y-auto rounded-[5px] border border-[var(--theme-border)] bg-[var(--theme-code-bg)] px-3 py-2">
            <UpdateReleaseNotes
              entry={notesEntry}
              fallbackVersion={updateStatus.latestVersion ?? ""}
              notesTitle={t("settings.updates.notesTitle")}
              noNotesLabel={t("settings.updates.noNotes")}
            />
          </div>
          <div className="mt-2 flex flex-wrap gap-3">
            <button
              type="button"
              className="border-0 bg-transparent p-0 text-[12px] text-[var(--theme-primary)] underline underline-offset-2"
              onClick={onOpenChangelog}
            >
              {t("settings.updates.actions.viewFullLog")}
            </button>
            <button
              type="button"
              className="border-0 bg-transparent p-0 text-[12px] text-[var(--theme-primary)] underline underline-offset-2"
              onClick={onOpenEnglishChangelog}
            >
              {t("settings.updates.actions.viewEnglishNotes")}
            </button>
          </div>
        </section>
      ) : null}

      <section className={settingsModuleClassName} aria-labelledby="update-prefs-title">
        <h2 id="update-prefs-title" className={settingsSectionTitleClassName}>
          {t("settings.updates.preferencesTitle")}
        </h2>
        <div className="mt-2 grid gap-2">
          <label className="flex min-h-[28px] items-center gap-2 text-[13px] text-[var(--theme-control-text)]">
            <input
              type="checkbox"
              className="size-4 accent-[var(--theme-primary)]"
              checked={updateSettingsDraft.automaticCheck}
              onChange={(event) => {
                const automaticCheck = event.target.checked;
                // 自动下载依赖自动检测；重新开启自动检测时默认帮用户勾上自动下载。
                onChangeUpdateSettings({ automaticCheck, automaticDownload: automaticCheck });
              }}
            />
            <span>{t("settings.general.autoCheck")}</span>
          </label>
          <label className="flex min-h-[28px] items-center gap-2 text-[13px] text-[var(--theme-control-text)]">
            <input
              type="checkbox"
              className="size-4 accent-[var(--theme-primary)] disabled:opacity-55"
              checked={updateSettingsDraft.automaticCheck && updateSettingsDraft.automaticDownload}
              disabled={!updateSettingsDraft.automaticCheck}
              onChange={(event) =>
                onChangeUpdateSettings({
                  automaticCheck: true,
                  automaticDownload: event.target.checked,
                })
              }
            />
            <span>{t("settings.general.autoDownload")}</span>
          </label>
        </div>
      </section>
    </div>
  );
}

/** 时间戳按当前界面语言格式化；无效值原样返回，避免显示 Invalid Date。 */
function formatCheckedAt(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleTimeString();
}

/** 状态徽标文案：状态机每个取值都有显式 key，避免运行时拼接 i18n key。 */
function updateStatusBadgeLabel(state: UpdateStatus["state"]): string {
  switch (state) {
    case "idle":
      return t("settings.updates.status.idle");
    case "checking":
      return t("settings.updates.status.checking");
    case "up-to-date":
      return t("settings.updates.status.up-to-date");
    case "available":
      return t("settings.updates.status.available");
    case "downloading":
      return t("settings.updates.status.downloading");
    case "downloaded":
      return t("settings.updates.status.downloaded");
    case "installing":
      return t("settings.updates.status.installing");
    case "installed":
      return t("settings.updates.status.installed");
    case "unconfigured":
      return t("settings.updates.status.unconfigured");
    case "error":
      return t("settings.updates.status.error");
  }
}
