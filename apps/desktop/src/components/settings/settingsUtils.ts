import type { AiSettings } from "@md-editor/ai";
import { normalizeAiProvider } from "@md-editor/ai";
import { t } from "@md-editor/i18n";
import type {
  BuiltInThemeId,
  ThemeColorScheme,
  ThemeSchemeSettings,
  UpdateStatus,
} from "../../app/settings/app-settings";
import type { BuiltInThemeOption } from "../../app/settings/built-in-themes";
import { APP_DISPLAY_NAME } from "../../lib/app-name";

export {
  isRemoteAiProvider,
  providerEndpointPlaceholder,
  providerModelPlaceholder,
  updateAiFeature,
  updateAiProvider,
} from "@md-editor/ai";

export function localModelStatusLabel(
  status: AiSettings["localModel"]["status"],
  hasUpdate?: boolean,
): string {
  if (status === "available" && hasUpdate) {
    return t("editor.titleBar.updateAvailable");
  }
  switch (status) {
    case "downloading":
      return t("settings.general.checking");
    case "verifying":
      return t("common.loading");
    case "available":
      return t("settings.ai.modelDownloaded");
    case "failed":
      return t("common.error");
    case "not-downloaded":
      return t("settings.ai.modelNotDownloaded");
  }
}

export function localModelProgressLabel(localModel: AiSettings["localModel"]): string {
  const progressLabel =
    localModel.totalBytes > 0
      ? `${formatByteSize(localModel.downloadedBytes)} / ${formatByteSize(localModel.totalBytes)}`
      : formatByteSize(localModel.downloadedBytes);
  const versionLabel = localModel.version ? `版本 ${localModel.version}` : "尚未下载版本";

  if (localModel.error) {
    return localModel.error;
  }

  if (localModel.status === "not-downloaded") {
    return `${versionLabel}。`;
  }

  if (localModel.status === "available") {
    if (localModel.hasUpdate && localModel.latestVersion) {
      return `当前版本 ${localModel.version ?? "未知"}，可更新至 ${localModel.latestVersion}。`;
    }
    return `已就绪 (${versionLabel}，占用 ${progressLabel})。`;
  }

  return `${versionLabel}，${progressLabel}。`;
}

export function formatByteSize(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return "0 B";
  }
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  if (value < 1024 * 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/**
 * 更新下载进度：返回进度条百分比与文案。
 * 总量未知（旧 manifest 或服务端未给 contentLength）时退化为弱进度，不假装知道比例。
 */
export function updateDownloadProgress(
  updateStatus: UpdateStatus,
): { readonly percent: number; readonly label: string } | null {
  if (updateStatus.state === "installing") {
    return { percent: 100, label: t("settings.updates.progress.installing") };
  }

  if (updateStatus.state !== "downloading") {
    return null;
  }

  const downloadedBytes = updateStatus.downloadedBytes ?? 0;
  const totalBytes = updateStatus.totalBytes ?? 0;
  if (totalBytes > 0) {
    const downloaded = formatByteSize(downloadedBytes);
    const total = formatByteSize(totalBytes);
    return {
      percent: Math.min(100, Math.round((downloadedBytes / totalBytes) * 100)),
      label: t("settings.updates.progress.downloading", { downloaded, total }),
    };
  }

  return {
    percent: 8,
    label: t("settings.updates.progress.downloadedOnly", {
      downloaded: formatByteSize(downloadedBytes),
    }),
  };
}

/**
 * 更新状态的一句话说明。
 *
 * 文案全部走 i18n：此前的实现把中文硬编码在 switch 里，
 * en / ja / zh-Hant 用户看到的仍是中文，而对应的 `updateStatus.*` 键从未被使用。
 */
export function updateStatusMessage(updateStatus: UpdateStatus): string {
  if (updateStatus.message) {
    return updateStatus.message;
  }

  const version = updateStatus.latestVersion ?? t("settings.updates.unknownVersion");
  switch (updateStatus.state) {
    case "idle":
      return t("settings.general.updateStatus.idle");
    case "checking":
      return t("settings.general.updateStatus.checking");
    case "up-to-date":
      return t("settings.general.updateStatus.upToDate");
    case "available":
      return t("settings.general.updateStatus.available", { version });
    case "downloading":
      return t("settings.general.updateStatus.downloading", {
        app: APP_DISPLAY_NAME,
        version,
      });
    case "downloaded":
      return t("settings.general.updateStatus.downloaded", { app: APP_DISPLAY_NAME, version });
    case "installing":
      return t("settings.general.updateStatus.installing");
    case "installed":
      return t("settings.general.updateStatus.installed", { app: APP_DISPLAY_NAME, version });
    case "unconfigured":
      return t("settings.general.updateStatus.unconfigured");
    case "error":
      return t("settings.general.updateStatus.error", {
        error: updateStatus.error ?? t("settings.general.updateStatus.errorUnknown"),
      });
  }
}

export function editorUpdateActionLabel(updateStatus: UpdateStatus): string {
  switch (updateStatus.state) {
    case "downloading":
      return t("editor.titleBar.updateDownloading");
    case "installing":
      return t("editor.titleBar.updateReady");
    case "downloaded":
    case "installed":
      return t("settings.updates.actions.restartToUpdate");
    default:
      return t("editor.titleBar.updateAvailable");
  }
}

export function readAiProvider(input: string): AiSettings["provider"] {
  return normalizeAiProvider(input);
}

export function readThemeColorScheme(input: string): ThemeColorScheme {
  return input === "light" || input === "dark" ? input : "system";
}

export function readThemeSelection(
  input: string,
  current: ThemeSchemeSettings,
  builtInOptions: readonly BuiltInThemeOption[],
): ThemeSchemeSettings {
  if (input === "custom") {
    return { ...current, source: "custom" };
  }

  return {
    ...current,
    source: "builtin",
    builtinTheme: readBuiltInTheme(input, current.builtinTheme, builtInOptions),
  };
}

function readBuiltInTheme(
  input: string,
  fallback: BuiltInThemeId,
  builtInOptions: readonly BuiltInThemeOption[],
): BuiltInThemeId {
  return builtInOptions.some((option) => option.id === input)
    ? (input as BuiltInThemeId)
    : fallback;
}
