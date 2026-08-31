import type {
  AiLocalModelDescriptor,
  AiLocalModelSettings,
  AiLocalModelStatus,
  AiProviderType,
  AiSettings,
} from "./types.ts";

export const DEFAULT_OPENAI_COMPATIBLE_ENDPOINT = "https://api.openai.com/v1";
export const DEFAULT_DEEPSEEK_ENDPOINT = "https://api.deepseek.com";
export const DEFAULT_LOCAL_MODEL_ID = "md-editor-writer-standard";
export const LEGACY_LOCAL_MODEL_ID = "md-editor-writer-small-v1";
export const LITE_LOCAL_MODEL_ID = "md-editor-writer-lite";
export const STANDARD_LOCAL_MODEL_ID = "md-editor-writer-standard";
export const PRO_LOCAL_MODEL_ID = "md-editor-writer-pro";

export const BUILTIN_LOCAL_MODELS: readonly AiLocalModelDescriptor[] = [
  {
    id: "md-editor-writer-lite",
    tier: "lite",
    displayName: "Lite (0.5B)",
    parameterSize: "0.5B",
    downloadSizeBytes: 491_400_032,
    recommendedMemoryGb: 4,
    description: "极速轻量，秒级响应，适合低内存或轻薄设备。",
    isAvailable: true,
  },
  {
    id: "md-editor-writer-standard",
    tier: "standard",
    displayName: "Standard (1.5B)",
    parameterSize: "1.5B",
    downloadSizeBytes: 1_050_000_000,
    recommendedMemoryGb: 8,
    description: "连贯写作与精准纠错，Markdown/MDX 语法边界更佳。",
    isAvailable: true,
  },
  {
    id: "md-editor-writer-pro",
    tier: "pro",
    displayName: "Pro",
    parameterSize: "",
    downloadSizeBytes: 0,
    recommendedMemoryGb: 0,
    description: "旗舰级深度长文创作、论文润色与逻辑重构（敬请期待）。",
    isAvailable: false,
  },
] as const;

export const DEFAULT_LOCAL_MODEL_SETTINGS: AiLocalModelSettings = {
  enabled: false,
  modelId: DEFAULT_LOCAL_MODEL_ID,
  version: null,
  latestVersion: null,
  hasUpdate: false,
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
    latestVersion: normalizeNullableString(input?.latestVersion),
    hasUpdate: Boolean(input?.hasUpdate),
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
  if (value === LEGACY_LOCAL_MODEL_ID || value === LITE_LOCAL_MODEL_ID) {
    return LITE_LOCAL_MODEL_ID;
  }
  if (value === PRO_LOCAL_MODEL_ID) {
    return PRO_LOCAL_MODEL_ID;
  }
  if (value === STANDARD_LOCAL_MODEL_ID) {
    return STANDARD_LOCAL_MODEL_ID;
  }
  return value || DEFAULT_LOCAL_MODEL_ID;
}

function normalizeNullableString(input: unknown): string | null {
  const value = typeof input === "string" ? input.trim() : "";
  return value || null;
}

function normalizeByteCount(input: unknown): number {
  return typeof input === "number" && Number.isFinite(input) && input > 0 ? Math.floor(input) : 0;
}
