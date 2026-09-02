import { normalizeLocalAiModelSettings, type AiLocalModelSettings } from "@md-editor/ai";

export {
  BUILTIN_LOCAL_MODELS,
  DEFAULT_LOCAL_MODEL_ID,
  DEFAULT_LOCAL_MODEL_SETTINGS,
  LITE_LOCAL_MODEL_ID,
  PRO_LOCAL_MODEL_ID,
  STANDARD_LOCAL_MODEL_ID,
  normalizeLocalAiModelSettings,
  type AiLocalModelDescriptor,
  type LocalModelTier,
} from "@md-editor/ai";

export const LOCAL_AI_MODEL_PROGRESS_EVENT = "local-ai-model-progress";

export interface LocalAiModelCommandStatus extends AiLocalModelSettings {
  readonly displayName: string;
  readonly description: string;
  readonly tier: "lite" | "standard" | "pro";
  readonly isRecommended: boolean;
  readonly latestVersion: string | null;
  readonly hasUpdate: boolean;
  readonly isAvailableTier: boolean;
  readonly path: string | null;
}

export interface SystemSpecs {
  readonly totalMemoryBytes: number;
  readonly cpuArch: string;
  readonly os: string;
  readonly cpuCores: number;
}

export function getRecommendedModelId(specs: SystemSpecs | null): string {
  if (!specs) return "md-editor-writer-standard";
  const totalGb = specs.totalMemoryBytes / (1024 * 1024 * 1024);
  return totalGb >= 7.5 ? "md-editor-writer-standard" : "md-editor-writer-lite";
}

export function formatSystemSpecsLabel(specs: SystemSpecs | null): string {
  if (!specs) return "正在检测本机硬件配置...";
  const totalGb = Math.round(specs.totalMemoryBytes / (1024 * 1024 * 1024));
  const archLabel =
    specs.cpuArch === "aarch64"
      ? "Apple Silicon / ARM64"
      : `${specs.cpuArch} ${specs.cpuCores} 核 CPU`;
  return `${archLabel} · ${totalGb} GB 内存`;
}

export function mergeLocalAiModelStatus(
  settings: AiLocalModelSettings,
  status: Partial<LocalAiModelCommandStatus>,
): AiLocalModelSettings {
  const normalizedStatus = toLocalAiModelCommandStatus(status);
  return {
    ...settings,
    modelId: normalizedStatus.modelId,
    version: normalizedStatus.version,
    latestVersion: normalizedStatus.latestVersion,
    hasUpdate: normalizedStatus.hasUpdate,
    status: normalizedStatus.status,
    downloadedBytes: normalizedStatus.downloadedBytes,
    totalBytes: normalizedStatus.totalBytes,
    error: normalizedStatus.error,
  };
}

export function toLocalAiModelCommandStatus(
  input: Partial<LocalAiModelCommandStatus> | null | undefined,
): LocalAiModelCommandStatus {
  const settings = normalizeLocalAiModelSettings(input);
  const displayName = normalizeString(input?.displayName, "Standard (1.5B)");
  const fallbackTier = displayName.toLowerCase().includes("lite") ? "lite" : "standard";
  const fallbackDescription =
    fallbackTier === "lite"
      ? "自研微调轻量模型，极速响应，适合轻薄本与日常流畅写作。"
      : "自研微调高精度进阶版，更强复杂长句纠错与代码续写能力。";
  return {
    ...settings,
    displayName,
    description: normalizeString(input?.description, fallbackDescription),
    tier:
      input?.tier === "pro" || input?.tier === "standard" || input?.tier === "lite"
        ? input.tier
        : fallbackTier,
    isRecommended: Boolean(input?.isRecommended),
    latestVersion: normalizeNullableString(input?.latestVersion),
    hasUpdate: Boolean(input?.hasUpdate),
    isAvailableTier: input?.isAvailableTier !== false,
    path: normalizeNullableString(input?.path),
  };
}

function normalizeString(input: unknown, fallback: string): string {
  const value = typeof input === "string" ? input.trim() : "";
  return value || fallback;
}

function normalizeNullableString(input: unknown): string | null {
  const value = typeof input === "string" ? input.trim() : "";
  return value || null;
}
