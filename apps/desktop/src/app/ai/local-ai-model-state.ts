import type { AiLocalModelSettings, AiLocalModelStatus } from "@md-editor/ai";

export const DEFAULT_LOCAL_MODEL_ID = "md-editor-writer-small-v1";
export const LOCAL_AI_MODEL_PROGRESS_EVENT = "local-ai-model-progress";

export interface LocalAiModelCommandStatus extends AiLocalModelSettings {
  readonly displayName: string;
  readonly path: string | null;
}

export const DEFAULT_LOCAL_MODEL_SETTINGS: AiLocalModelSettings = {
  enabled: false,
  modelId: DEFAULT_LOCAL_MODEL_ID,
  version: null,
  status: "not-downloaded",
  downloadedBytes: 0,
  totalBytes: 0,
  error: null
};

export function normalizeLocalAiModelSettings(
  input: Partial<AiLocalModelSettings> | null | undefined
): AiLocalModelSettings {
  return {
    enabled: Boolean(input?.enabled),
    modelId: normalizeModelId(input?.modelId),
    version: normalizeNullableString(input?.version),
    status: normalizeLocalModelStatus(input?.status),
    downloadedBytes: normalizeByteCount(input?.downloadedBytes),
    totalBytes: normalizeByteCount(input?.totalBytes),
    error: normalizeNullableString(input?.error)
  };
}

export function normalizeLocalModelStatus(input: unknown): AiLocalModelStatus {
  return input === "downloading" || input === "verifying" || input === "available" || input === "failed"
    ? input
    : "not-downloaded";
}

export function mergeLocalAiModelStatus(
  settings: AiLocalModelSettings,
  status: Partial<LocalAiModelCommandStatus>
): AiLocalModelSettings {
  const normalizedStatus = toLocalAiModelCommandStatus(status);
  return {
    ...settings,
    modelId: normalizedStatus.modelId,
    version: normalizedStatus.version,
    status: normalizedStatus.status,
    downloadedBytes: normalizedStatus.downloadedBytes,
    totalBytes: normalizedStatus.totalBytes,
    error: normalizedStatus.error
  };
}

export function toLocalAiModelCommandStatus(
  input: Partial<LocalAiModelCommandStatus> | null | undefined
): LocalAiModelCommandStatus {
  const settings = normalizeLocalAiModelSettings(input);
  return {
    ...settings,
    displayName: normalizeString(input?.displayName, "md-editor Writer Small"),
    path: normalizeNullableString(input?.path)
  };
}

function normalizeModelId(input: unknown): string {
  const value = typeof input === "string" ? input.trim() : "";
  return value || DEFAULT_LOCAL_MODEL_ID;
}

function normalizeString(input: unknown, fallback: string): string {
  const value = typeof input === "string" ? input.trim() : "";
  return value || fallback;
}

function normalizeNullableString(input: unknown): string | null {
  const value = typeof input === "string" ? input.trim() : "";
  return value || null;
}

function normalizeByteCount(input: unknown): number {
  return typeof input === "number" && Number.isFinite(input) && input > 0
    ? Math.floor(input)
    : 0;
}
