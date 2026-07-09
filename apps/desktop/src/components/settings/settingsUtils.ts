import type { AiSettings } from "@md-editor/ai";
import type {
  BuiltInThemeId,
  ThemeColorScheme,
  ThemeSchemeSettings,
  UpdateStatus
} from "../../app/settings/app-settings";
import {
  DEFAULT_DEEPSEEK_ENDPOINT,
  DEFAULT_OPENAI_COMPATIBLE_ENDPOINT
} from "../../app/settings/app-settings";
import type { BuiltInThemeOption } from "../../app/settings/built-in-themes";

export function localModelStatusLabel(status: AiSettings["localModel"]["status"]): string {
  switch (status) {
    case "downloading":
      return "下载中";
    case "verifying":
      return "校验中";
    case "available":
      return "可用";
    case "failed":
      return "下载失败";
    case "not-downloaded":
      return "未下载";
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
    return `模型 ${localModel.modelId}，${versionLabel}。`;
  }

  if (localModel.status === "available") {
    return `模型 ${localModel.modelId}，${versionLabel}，文件 ${progressLabel}。`;
  }

  return `模型 ${localModel.modelId}，${versionLabel}，${progressLabel}。`;
}

export function updateProgressLabel(updateStatus: UpdateStatus): string | null {
  if (updateStatus.state === "installing") {
    return "正在安装更新，请保持应用打开。";
  }
  if (updateStatus.state !== "downloading") {
    return null;
  }

  const downloadedBytes = updateStatus.downloadedBytes ?? 0;
  const totalBytes = updateStatus.totalBytes ?? 0;
  return totalBytes > 0
    ? `${formatByteSize(downloadedBytes)} / ${formatByteSize(totalBytes)}`
    : `${formatByteSize(downloadedBytes)} 已下载`;
}

export function updateStatusMessage(updateStatus: UpdateStatus): string {
  if (updateStatus.message) {
    return updateStatus.message;
  }

  const latestVersion = updateStatus.latestVersion ?? "未知版本";
  switch (updateStatus.state) {
    case "idle":
      return "点击检查更新获取当前发布状态。";
    case "checking":
      return "正在检查更新...";
    case "up-to-date":
      return `当前版本 ${updateStatus.currentVersion} 已是最新发布版本。`;
    case "available":
      return `发现新版本 ${latestVersion}，当前版本 ${updateStatus.currentVersion}。`;
    case "downloading":
      return `正在下载 Markdown Editor ${latestVersion}...`;
    case "downloaded":
      return `Markdown Editor ${latestVersion} 已下载，退出并更新后生效。`;
    case "installing":
      return "更新下载完成，正在安装...";
    case "installed":
      return `Markdown Editor ${latestVersion} 已安装，重启应用后生效。`;
    case "unconfigured":
      return "应用内更新暂不可用，请确认 Release workflow 已完成。";
    case "error":
      return updateStatus.error ? `更新失败：${updateStatus.error}` : "更新失败。";
  }
}

export function editorUpdateActionLabel(updateStatus: UpdateStatus): string {
  switch (updateStatus.state) {
    case "downloading":
      return "下载中";
    case "installing":
      return "安装中";
    case "installed":
      return "重启 App";
    default:
      return "更新 App";
  }
}

export function readAiProvider(input: string): AiSettings["provider"] {
  if (input === "deepseek" || input === "local") {
    return input;
  }

  return "openai-compatible";
}

export function isRemoteAiProvider(provider: AiSettings["provider"]): boolean {
  return provider === "openai-compatible" || provider === "deepseek";
}

export function providerEndpointPlaceholder(provider: AiSettings["provider"]): string {
  return provider === "deepseek" ? DEFAULT_DEEPSEEK_ENDPOINT : DEFAULT_OPENAI_COMPATIBLE_ENDPOINT;
}

export function providerModelPlaceholder(provider: AiSettings["provider"]): string {
  return provider === "deepseek" ? "deepseek-chat" : "gpt-4.1-mini";
}

export function readThemeColorScheme(input: string): ThemeColorScheme {
  return input === "light" || input === "dark" ? input : "system";
}

export function readThemeSelection(
  input: string,
  current: ThemeSchemeSettings,
  builtInOptions: readonly BuiltInThemeOption[]
): ThemeSchemeSettings {
  if (input === "custom") {
    return { ...current, source: "custom" };
  }

  return {
    ...current,
    source: "builtin",
    builtinTheme: readBuiltInTheme(input, current.builtinTheme, builtInOptions)
  };
}

export function updateAiProvider(settings: AiSettings, provider: AiSettings["provider"]): AiSettings {
  const currentBaseUrl = settings.openAiCompatible.baseUrl;
  const baseUrl = provider === "deepseek"
    ? DEFAULT_DEEPSEEK_ENDPOINT
    : provider === "openai-compatible" && currentBaseUrl === DEFAULT_DEEPSEEK_ENDPOINT
      ? DEFAULT_OPENAI_COMPATIBLE_ENDPOINT
      : currentBaseUrl;

  return {
    ...settings,
    provider,
    openAiCompatible: {
      ...settings.openAiCompatible,
      baseUrl
    }
  };
}

export function updateAiFeature(
  settings: AiSettings,
  feature: keyof AiSettings["features"],
  enabled: boolean
): AiSettings {
  const nextFeatures = {
    ...settings.features,
    [feature]: enabled
  };
  return {
    ...settings,
    enabled: nextFeatures.continuation || nextFeatures.editing,
    features: nextFeatures
  };
}

function readBuiltInTheme(
  input: string,
  fallback: BuiltInThemeId,
  builtInOptions: readonly BuiltInThemeOption[]
): BuiltInThemeId {
  return builtInOptions.some((option) => option.id === input) ? (input as BuiltInThemeId) : fallback;
}

function formatByteSize(value: number): string {
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
