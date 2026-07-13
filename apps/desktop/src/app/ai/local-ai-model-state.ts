import { normalizeLocalAiModelSettings, type AiLocalModelSettings } from "@md-editor/ai";

export {
  DEFAULT_LOCAL_MODEL_ID,
  DEFAULT_LOCAL_MODEL_SETTINGS,
  normalizeLocalAiModelSettings,
} from "@md-editor/ai";
export const LOCAL_AI_MODEL_PROGRESS_EVENT = "local-ai-model-progress";

export interface LocalAiModelCommandStatus extends AiLocalModelSettings {
  readonly displayName: string;
  readonly path: string | null;
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
  return {
    ...settings,
    displayName: normalizeString(input?.displayName, "md-editor Writer Small"),
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
