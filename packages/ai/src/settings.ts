import type {
  AiLocalModelSettings,
  AiLocalModelStatus,
  AiProviderType,
  AiSettings,
} from "./types.ts";

export const DEFAULT_OPENAI_COMPATIBLE_ENDPOINT = "https://api.openai.com/v1";
export const DEFAULT_DEEPSEEK_ENDPOINT = "https://api.deepseek.com";
export const DEFAULT_LOCAL_MODEL_ID = "md-editor-writer-small-v1";

export const DEFAULT_LOCAL_MODEL_SETTINGS: AiLocalModelSettings = {
  enabled: false,
  modelId: DEFAULT_LOCAL_MODEL_ID,
  version: null,
  status: "not-downloaded",
  downloadedBytes: 0,
  totalBytes: 0,
  error: null,
};

export const DEFAULT_AI_SETTINGS: AiSettings = {
  enabled: true,
  provider: "openai-compatible",
  features: {
    continuation: false,
    editing: true,
  },
  openAiCompatible: {
    baseUrl: DEFAULT_OPENAI_COMPATIBLE_ENDPOINT,
    model: "",
    apiKey: "",
  },
  localModel: DEFAULT_LOCAL_MODEL_SETTINGS,
};

export function normalizeAiProvider(input: unknown): AiProviderType {
  if (input === "deepseek" || input === "local") {
    return input;
  }

  return "openai-compatible";
}

export function isRemoteAiProvider(provider: AiProviderType): boolean {
  return provider === "openai-compatible" || provider === "deepseek";
}

export function providerEndpointPlaceholder(provider: AiProviderType): string {
  return provider === "deepseek" ? DEFAULT_DEEPSEEK_ENDPOINT : DEFAULT_OPENAI_COMPATIBLE_ENDPOINT;
}

export function providerModelPlaceholder(provider: AiProviderType): string {
  return provider === "deepseek" ? "deepseek-chat" : "gpt-4.1-mini";
}

export function normalizeLocalModelStatus(input: unknown): AiLocalModelStatus {
  return input === "downloading" ||
    input === "verifying" ||
    input === "available" ||
    input === "failed"
    ? input
    : "not-downloaded";
}

export function normalizeLocalAiModelSettings(
  input: Partial<AiLocalModelSettings> | null | undefined,
): AiLocalModelSettings {
  return {
    enabled: Boolean(input?.enabled),
    modelId: normalizeModelId(input?.modelId),
    version: normalizeNullableString(input?.version),
    status: normalizeLocalModelStatus(input?.status),
    downloadedBytes: normalizeByteCount(input?.downloadedBytes),
    totalBytes: normalizeByteCount(input?.totalBytes),
    error: normalizeNullableString(input?.error),
  };
}

export function normalizeAiSettings(input: Partial<AiSettings> | null | undefined): AiSettings {
  const provider = normalizeAiProvider(input?.provider);
  const hasFeatureSettings = input?.features !== undefined;
  const features = {
    continuation: Boolean(input?.features?.continuation),
    editing: input?.features?.editing ?? true,
  };
  return {
    enabled: hasFeatureSettings ? (input?.enabled ?? true) : true,
    provider,
    features,
    openAiCompatible: {
      baseUrl: normalizeAiBaseUrl(input?.openAiCompatible?.baseUrl, provider),
      model: input?.openAiCompatible?.model?.trim() ?? "",
      apiKey: input?.openAiCompatible?.apiKey ?? "",
    },
    localModel: normalizeLocalAiModelSettings(input?.localModel),
  };
}

export function updateAiProvider(settings: AiSettings, provider: AiProviderType): AiSettings {
  const currentBaseUrl = settings.openAiCompatible.baseUrl;
  const baseUrl =
    provider === "deepseek"
      ? DEFAULT_DEEPSEEK_ENDPOINT
      : provider === "openai-compatible" && currentBaseUrl === DEFAULT_DEEPSEEK_ENDPOINT
        ? DEFAULT_OPENAI_COMPATIBLE_ENDPOINT
        : currentBaseUrl;

  return {
    ...settings,
    provider,
    openAiCompatible: {
      ...settings.openAiCompatible,
      baseUrl,
    },
  };
}

export function updateAiFeature(
  settings: AiSettings,
  feature: keyof AiSettings["features"],
  enabled: boolean,
): AiSettings {
  const nextFeatures = {
    ...settings.features,
    [feature]: enabled,
  };
  return {
    ...settings,
    enabled: nextFeatures.continuation || nextFeatures.editing,
    features: nextFeatures,
  };
}

function normalizeAiBaseUrl(input: string | undefined, provider: AiProviderType): string {
  if (provider === "deepseek") {
    return DEFAULT_DEEPSEEK_ENDPOINT;
  }

  const value = input?.trim().replace(/\/+$/u, "");
  return value || DEFAULT_AI_SETTINGS.openAiCompatible.baseUrl;
}

function normalizeModelId(input: unknown): string {
  const value = typeof input === "string" ? input.trim() : "";
  return value || DEFAULT_LOCAL_MODEL_ID;
}

function normalizeNullableString(input: unknown): string | null {
  const value = typeof input === "string" ? input.trim() : "";
  return value || null;
}

function normalizeByteCount(input: unknown): number {
  return typeof input === "number" && Number.isFinite(input) && input > 0 ? Math.floor(input) : 0;
}
