/**
 * @file domain/settings.ts
 * @module @md-editor/ai
 * @description
 * AI 多协议配置、URL 快速预设、RFC-004 v1.4.0 本地模型矩阵与持久化迁移逻辑。
 *
 * 支持：
 * 1. `openai` / `anthropic` / `google` 三大标准协议 + 自定义 Base URL；
 * 2. OpenAI / DeepSeek / Ollama / Anthropic / Google Gemini 一键预设填充；
 * 3. 无缝迁移 Desktop 旧版（`openai-compatible` / `deepseek` / `openAiCompatible`）
 *    与 Web 旧版（`deepseek` / `openai-compatible` / `ollama` 扁平字段）持久化配置。
 */

import type {
  AiEndpointsRecord,
  AiLocalModelDescriptor,
  AiLocalModelSettings,
  AiLocalModelStatus,
  AiProtocolEndpointSettings,
  AiProtocolId,
  AiProviderType,
  AiSettings,
  AiUrlPreset,
} from "./types.ts";

/** OpenAI 官方默认 API 根路径 */
export const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";

/** DeepSeek 官方默认 API 根路径（兼容 OpenAI Chat Completions 协议） */
export const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com";

/** Ollama 本地 HTTP 服务默认 OpenAI 兼容根路径 */
export const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434/v1";

/** Anthropic 官方默认 API 根路径 */
export const DEFAULT_ANTHROPIC_BASE_URL = "https://api.anthropic.com";

/** Google Gemini 官方默认 API 根路径 */
export const DEFAULT_GOOGLE_BASE_URL = "https://generativelanguage.googleapis.com";

/** 极速轻量版模型 ID (Qwen 3 0.6B + GEC LoRA) */
export const LITE_LOCAL_MODEL_ID = "md-editor-writer-lite";

/** 标准专业版模型 ID (Google Gemma 4 E2B 原生零微调) */
export const STANDARD_LOCAL_MODEL_ID = "md-editor-writer-standard";

/** 旗舰级专业版模型 ID (规划中) */
export const PRO_LOCAL_MODEL_ID = "md-editor-writer-pro";

/** 默认采用的本地模型 ID */
export const DEFAULT_LOCAL_MODEL_ID = STANDARD_LOCAL_MODEL_ID;

/** 历史兼容旧模型 ID */
export const LEGACY_LOCAL_MODEL_ID = "md-editor-writer-small-v1";

/** 三大协议列表 */
export const AI_PROTOCOLS: readonly AiProtocolId[] = ["openai", "anthropic", "google"] as const;

/**
 * 内置 URL 快速预设清单：
 * 通过自定义 Base URL 原生覆盖 DeepSeek、Ollama 以及三大官方端点。
 */
export const AI_URL_PRESETS: readonly AiUrlPreset[] = [
  {
    id: "openai",
    label: "OpenAI",
    protocol: "openai",
    baseUrl: DEFAULT_OPENAI_BASE_URL,
    defaultModel: "gpt-4.1-mini",
    apiKeyPlaceholder: "sk-...",
    requiresApiKey: true,
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    protocol: "openai",
    baseUrl: DEFAULT_DEEPSEEK_BASE_URL,
    defaultModel: "deepseek-chat",
    apiKeyPlaceholder: "sk-...",
    requiresApiKey: true,
  },
  {
    id: "anthropic",
    label: "Anthropic",
    protocol: "anthropic",
    baseUrl: DEFAULT_ANTHROPIC_BASE_URL,
    defaultModel: "claude-sonnet-4-5",
    apiKeyPlaceholder: "sk-ant-...",
    requiresApiKey: true,
  },
  {
    id: "google",
    label: "Google Gemini",
    protocol: "google",
    baseUrl: DEFAULT_GOOGLE_BASE_URL,
    defaultModel: "gemini-2.5-flash",
    apiKeyPlaceholder: "AIza...",
    requiresApiKey: true,
  },
  {
    id: "ollama",
    label: "Ollama (Local)",
    protocol: "openai",
    baseUrl: DEFAULT_OLLAMA_BASE_URL,
    defaultModel: "qwen3:0.6b",
    apiKeyPlaceholder: "ollama",
    requiresApiKey: false,
  },
] as const;

/**
 * RFC-004 (v1.4.0) 内置本地 AI 模型规格目录：
 * - Lite: Qwen 3 0.6B Q8_0 + GEC LoRA
 * - Standard: Google Gemma 4 E2B Q4_K_M 原生零微调
 */
export const BUILTIN_LOCAL_MODELS: readonly AiLocalModelDescriptor[] = [
  {
    id: LITE_LOCAL_MODEL_ID,
    tier: "lite",
    displayName: "Lite (Qwen 3 0.6B)",
    parameterSize: "0.6B",
    downloadSizeBytes: 667_000_000,
    recommendedMemoryGb: 4,
    description: "极速轻量档：内存占用 <300MB，首字延迟 <30ms，适合老旧轻薄本与快速输入",
    isAvailable: true,
  },
  {
    id: STANDARD_LOCAL_MODEL_ID,
    tier: "standard",
    displayName: "Standard (Google Gemma 4 E2B)",
    parameterSize: "E2B",
    downloadSizeBytes: 1_680_000_000,
    recommendedMemoryGb: 8,
    description:
      "高精度专业档：Google Gemma 4 端侧基座，原生推理与长句逻辑极强，无错识别率接近 100%",
    isAvailable: true,
  },
  {
    id: PRO_LOCAL_MODEL_ID,
    tier: "pro",
    displayName: "Pro",
    parameterSize: "",
    downloadSizeBytes: 0,
    recommendedMemoryGb: 0,
    description: "旗舰级深度长文创作、论文润色与逻辑重构（敬请期待）。",
    isAvailable: false,
  },
] as const;

/** 默认多协议端点配置 */
export const DEFAULT_AI_ENDPOINTS: AiEndpointsRecord = {
  openai: {
    baseUrl: DEFAULT_OPENAI_BASE_URL,
    model: "",
    apiKey: "",
  },
  anthropic: {
    baseUrl: DEFAULT_ANTHROPIC_BASE_URL,
    model: "",
    apiKey: "",
  },
  google: {
    baseUrl: DEFAULT_GOOGLE_BASE_URL,
    model: "",
    apiKey: "",
  },
};

/** 本地模型运行时默认状态配置 */
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

/** 全局 AI 设置默认值 */
export const DEFAULT_AI_SETTINGS: AiSettings = {
  enabled: true,
  provider: "openai",
  features: {
    continuation: false,
    editing: true,
  },
  endpoints: DEFAULT_AI_ENDPOINTS,
  localModel: DEFAULT_LOCAL_MODEL_SETTINGS,
};

export interface NormalizeAiSettingsOptions {
  /** 当前宿主平台是否支持离线本地模型（Desktop 为 true，Web / uTools 为 false） */
  readonly allowLocal?: boolean;
  /** 未持久化时的默认预设（例如 Web 端可默认填充 deepseek 端点） */
  readonly defaultPresetId?: AiUrlPreset["id"];
}

/**
 * 判断指定的提供商是否属于远端/HTTP 协议（非内置本地 GGUF 模型）。
 */
export function isRemoteAiProvider(provider: AiProviderType): provider is AiProtocolId {
  return provider === "openai" || provider === "anthropic" || provider === "google";
}

/**
 * 判断 Base URL 是否指向本机回环 HTTP 服务（如 Ollama / LM Studio / 本地 llama-server）。
 * 本机回环服务默认免强制校验 API Key。
 */
export function isLoopbackHttpEndpoint(baseUrl: string): boolean {
  const trimmed = baseUrl.trim();
  if (!trimmed) {
    return false;
  }
  try {
    const parsed = new URL(trimmed);
    return (
      parsed.hostname === "localhost" ||
      parsed.hostname === "127.0.0.1" ||
      parsed.hostname === "::1" ||
      parsed.hostname === "[::1]"
    );
  } catch {
    return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/iu.test(trimmed);
  }
}

/**
 * 归一化 AI 提供商标识，自动将旧版 `openai-compatible` / `deepseek` / `ollama` 映射为 `openai`。
 */
export function normalizeAiProvider(
  input: unknown,
  options: { readonly allowLocal?: boolean } = {},
): AiProviderType {
  const allowLocal = options.allowLocal !== false;
  if (input === "local") {
    return allowLocal ? "local" : "openai";
  }
  if (input === "anthropic" || input === "google" || input === "openai") {
    return input;
  }
  // 旧版 provider ("openai-compatible" | "deepseek" | "ollama") 全部归入标准 openai 协议
  return "openai";
}

/**
 * 获取协议对应的官方默认 Base URL。
 */
export function protocolDefaultBaseUrl(protocol: AiProtocolId): string {
  switch (protocol) {
    case "anthropic":
      return DEFAULT_ANTHROPIC_BASE_URL;
    case "google":
      return DEFAULT_GOOGLE_BASE_URL;
    case "openai":
      return DEFAULT_OPENAI_BASE_URL;
  }
}

/**
 * 获取协议对应的默认模型占位提示词。
 */
export function protocolModelPlaceholder(protocol: AiProtocolId, baseUrl?: string): string {
  if (protocol === "openai" && baseUrl) {
    const clean = stripTrailingSlashes(baseUrl).toLowerCase();
    if (clean.includes("deepseek.com")) {
      return "deepseek-chat";
    }
    if (clean.includes("11434") || clean.includes("ollama")) {
      return "qwen3:0.6b";
    }
  }
  switch (protocol) {
    case "anthropic":
      return "claude-sonnet-4-5";
    case "google":
      return "gemini-2.5-flash";
    case "openai":
      return "gpt-4.1-mini";
  }
}

/**
 * 获取协议对应的 API Key 占位提示词。
 */
export function protocolApiKeyPlaceholder(protocol: AiProtocolId, baseUrl?: string): string {
  if (protocol === "openai" && baseUrl && isLoopbackHttpEndpoint(baseUrl)) {
    return "ollama (本地服务可留空)";
  }
  switch (protocol) {
    case "anthropic":
      return "sk-ant-...";
    case "google":
      return "AIza...";
    case "openai":
      return "sk-...";
  }
}

/**
 * 获取当前激活的云端协议配置；若当前为 `local` 则返回 `null`。
 */
export function getActiveEndpointSettings(settings: AiSettings): AiProtocolEndpointSettings | null {
  if (!isRemoteAiProvider(settings.provider)) {
    return null;
  }
  return settings.endpoints[settings.provider];
}

/**
 * 根据当前协议与 Base URL 匹配命中的内置预设（若用户修改了自定义 URL 则返回 null）。
 */
export function matchActiveUrlPreset(settings: AiSettings): AiUrlPreset | null {
  if (!isRemoteAiProvider(settings.provider)) {
    return null;
  }
  const active = settings.endpoints[settings.provider];
  const cleanUrl = stripTrailingSlashes(active.baseUrl);
  return (
    AI_URL_PRESETS.find(
      (preset) =>
        preset.protocol === settings.provider && stripTrailingSlashes(preset.baseUrl) === cleanUrl,
    ) ?? null
  );
}

/**
 * 校验并归一化本地模型的生命周期状态。
 */
export function normalizeLocalModelStatus(input: unknown): AiLocalModelStatus {
  return input === "downloading" ||
    input === "verifying" ||
    input === "available" ||
    input === "failed"
    ? input
    : "not-downloaded";
}

/**
 * 归一化本地模型持久化配置对象。
 */
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

/**
 * 兼容旧版 Desktop 与 Web 数据结构的全局 AI 配置归一化函数。
 *
 * 迁移规则：
 * - Desktop 旧版 `{ provider: "deepseek" | "openai-compatible", openAiCompatible: { baseUrl, model, apiKey } }`
 *   自动迁移至 `provider: "openai"` + `endpoints.openai`（当旧 provider 为 `deepseek` 时自动将 baseUrl 修正为 `https://api.deepseek.com`）；
 * - Web 旧版 `{ enabled, provider: "deepseek" | "openai-compatible" | "ollama", baseUrl, model, apiKey }`
 *   自动迁移至 `provider: "openai"` + `endpoints.openai`。
 */
export function normalizeAiSettings(
  input: unknown,
  options: NormalizeAiSettingsOptions = {},
): AiSettings {
  const record = isPlainRecord(input) ? input : {};
  const rawProvider = record.provider;
  const provider = normalizeAiProvider(rawProvider, { allowLocal: options.allowLocal });

  const defaultPreset = options.defaultPresetId
    ? AI_URL_PRESETS.find((item) => item.id === options.defaultPresetId)
    : undefined;

  const rawEndpoints = isPlainRecord(record.endpoints) ? record.endpoints : {};
  const legacyOpenAi = isPlainRecord(record.openAiCompatible) ? record.openAiCompatible : null;

  // 提取扁平旧版字段（Web 端历史结构）
  const legacyFlatBaseUrl = typeof record.baseUrl === "string" ? record.baseUrl : undefined;
  const legacyFlatModel = typeof record.model === "string" ? record.model : undefined;
  const legacyFlatApiKey = typeof record.apiKey === "string" ? record.apiKey : undefined;

  const rawOpenAiEndpoint = isPlainRecord(rawEndpoints.openai) ? rawEndpoints.openai : null;
  const rawAnthropicEndpoint = isPlainRecord(rawEndpoints.anthropic)
    ? rawEndpoints.anthropic
    : null;
  const rawGoogleEndpoint = isPlainRecord(rawEndpoints.google) ? rawEndpoints.google : null;

  // 计算 OpenAI 协议槽位的迁移值
  let openAiFallbackUrl =
    defaultPreset?.protocol === "openai" ? defaultPreset.baseUrl : DEFAULT_OPENAI_BASE_URL;
  if (rawProvider === "deepseek") {
    openAiFallbackUrl = DEFAULT_DEEPSEEK_BASE_URL;
  } else if (rawProvider === "ollama") {
    openAiFallbackUrl = DEFAULT_OLLAMA_BASE_URL;
  }

  const migratedOpenAiUrl =
    typeof rawOpenAiEndpoint?.baseUrl === "string"
      ? rawOpenAiEndpoint.baseUrl
      : typeof legacyOpenAi?.baseUrl === "string" && legacyOpenAi.baseUrl.trim()
        ? legacyOpenAi.baseUrl
        : typeof legacyFlatBaseUrl === "string" && legacyFlatBaseUrl.trim()
          ? legacyFlatBaseUrl
          : rawProvider === "deepseek"
            ? DEFAULT_DEEPSEEK_BASE_URL
            : openAiFallbackUrl;

  const migratedOpenAiModel =
    typeof rawOpenAiEndpoint?.model === "string"
      ? rawOpenAiEndpoint.model
      : typeof legacyOpenAi?.model === "string"
        ? legacyOpenAi.model
        : (legacyFlatModel ??
          (defaultPreset?.protocol === "openai" ? defaultPreset.defaultModel : ""));

  const migratedOpenAiKey =
    typeof rawOpenAiEndpoint?.apiKey === "string"
      ? rawOpenAiEndpoint.apiKey
      : typeof legacyOpenAi?.apiKey === "string"
        ? legacyOpenAi.apiKey
        : (legacyFlatApiKey ?? "");

  const endpoints: AiEndpointsRecord = {
    openai: normalizeEndpointSlot(
      {
        baseUrl: migratedOpenAiUrl,
        model: migratedOpenAiModel,
        apiKey: migratedOpenAiKey,
      },
      openAiFallbackUrl,
    ),
    anthropic: normalizeEndpointSlot(
      rawAnthropicEndpoint,
      defaultPreset?.protocol === "anthropic" ? defaultPreset.baseUrl : DEFAULT_ANTHROPIC_BASE_URL,
      defaultPreset?.protocol === "anthropic" ? defaultPreset.defaultModel : "",
    ),
    google: normalizeEndpointSlot(
      rawGoogleEndpoint,
      defaultPreset?.protocol === "google" ? defaultPreset.baseUrl : DEFAULT_GOOGLE_BASE_URL,
      defaultPreset?.protocol === "google" ? defaultPreset.defaultModel : "",
    ),
  };

  const rawFeatures = isPlainRecord(record.features) ? record.features : null;
  const features = {
    continuation:
      rawFeatures !== null
        ? Boolean(rawFeatures.continuation)
        : // Web 端旧版无 features 字段但默认开启续写时保留可用性
          Boolean(legacyFlatBaseUrl !== undefined && record.enabled !== false),
    editing: rawFeatures !== null ? rawFeatures.editing !== false : true,
  };

  const enabled =
    typeof record.enabled === "boolean"
      ? record.enabled
      : rawFeatures !== null
        ? features.continuation || features.editing
        : true;

  const rawLocalModel = isPlainRecord(record.localModel)
    ? (record.localModel as Partial<AiLocalModelSettings>)
    : undefined;

  return {
    enabled,
    provider,
    features,
    endpoints,
    localModel: normalizeLocalAiModelSettings(rawLocalModel),
  };
}

/**
 * 不可变地切换当前激活的协议或本地模型。
 */
export function updateAiProvider(settings: AiSettings, provider: AiProviderType): AiSettings {
  return {
    ...settings,
    provider,
  };
}

/**
 * 不可变地更新指定云端协议槽位的连接字段。
 */
export function updateAiEndpoint(
  settings: AiSettings,
  protocol: AiProtocolId,
  patch: Partial<AiProtocolEndpointSettings>,
): AiSettings {
  const current = settings.endpoints[protocol];
  return {
    ...settings,
    endpoints: {
      ...settings.endpoints,
      [protocol]: {
        baseUrl: patch.baseUrl !== undefined ? patch.baseUrl : current.baseUrl,
        model: patch.model !== undefined ? patch.model : current.model,
        apiKey: patch.apiKey !== undefined ? patch.apiKey : current.apiKey,
      },
    },
  };
}

/**
 * 一键应用 URL 预设（自动切换对应协议、填入预设 Base URL，并在模型名为空或属于其他预设默认值时同步切换推荐模型名）。
 */
export function applyAiUrlPreset(settings: AiSettings, presetId: AiUrlPreset["id"]): AiSettings {
  const preset = AI_URL_PRESETS.find((item) => item.id === presetId);
  if (!preset) {
    return settings;
  }

  const currentSlot = settings.endpoints[preset.protocol];
  const isKnownPresetDefaultModel = AI_URL_PRESETS.some(
    (item) => item.defaultModel === currentSlot.model.trim(),
  );
  const nextModel =
    !currentSlot.model.trim() || isKnownPresetDefaultModel
      ? preset.defaultModel
      : currentSlot.model;

  return {
    ...settings,
    provider: preset.protocol,
    endpoints: {
      ...settings.endpoints,
      [preset.protocol]: {
        ...currentSlot,
        baseUrl: preset.baseUrl,
        model: nextModel,
      },
    },
  };
}

/**
 * 不可变地开启或关闭特定 AI 子功能（如续写或智能纠错）。
 */
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

/**
 * 获取指定协议在界面上展示的 Base URL 占位提示。
 */
export function providerEndpointPlaceholder(provider: AiProviderType): string {
  switch (provider) {
    case "anthropic":
      return DEFAULT_ANTHROPIC_BASE_URL;
    case "google":
      return DEFAULT_GOOGLE_BASE_URL;
    case "openai":
    default:
      return DEFAULT_OPENAI_BASE_URL;
  }
}

/**
 * 获取指定协议在界面上展示的 Model 模型名称占位提示。
 */
export function providerModelPlaceholder(provider: AiProviderType): string {
  switch (provider) {
    case "anthropic":
      return "claude-sonnet-4-5";
    case "google":
      return "gemini-2.5-flash";
    case "openai":
    default:
      return "gpt-4o-mini / deepseek-chat";
  }
}

/**
 * 检查当前 AI 设置是否已满足指定任务的发起条件。
 *
 * @returns 若未就绪返回具体的用户友好提示文案；就绪则返回 `null`。
 */
export function getAiCompletionReadiness(
  settings: AiSettings,
  intent: "continuation" | "editing" | "both" | "distill" = "both",
  options: { readonly allowLocal?: boolean } = {},
): string | null {
  if (!settings.enabled) {
    return "请先在设置中开启 AI 功能。";
  }

  if (intent !== "distill") {
    if (intent === "continuation" && !settings.features.continuation) {
      return "请先在设置中开启 AI 续写功能。";
    }
    if (intent === "editing" && !settings.features.editing) {
      return "请先在设置中开启语法标点修复功能。";
    }
    if (!settings.features.continuation && !settings.features.editing) {
      return "请先开启 AI 续写或语法标点修复。";
    }
  }

  if (settings.provider === "local") {
    if (options.allowLocal === false) {
      return "当前运行环境不支持离线本地模型，请切换至云端协议或使用原生桌面端。";
    }
    if (!settings.localModel.enabled) {
      return "请先在设置中启用本地模型。";
    }
    if (settings.localModel.status !== "available") {
      return "本地模型尚未下载，当前还不能使用 AI。";
    }
    return null;
  }

  const endpoint = settings.endpoints[settings.provider];
  const cleanUrl = endpoint.baseUrl.trim();
  if (!cleanUrl) {
    return "请先配置 API Endpoint (Base URL)。";
  }
  if (!endpoint.model.trim()) {
    return "请先配置 AI 模型名称 (Model)。";
  }
  if (!endpoint.apiKey.trim() && !isLoopbackHttpEndpoint(cleanUrl)) {
    return "请先配置 API Key。";
  }

  return null;
}

function normalizeEndpointSlot(
  raw: Record<string, unknown> | Partial<AiProtocolEndpointSettings> | null | undefined,
  fallbackBaseUrl: string,
  fallbackModel = "",
): AiProtocolEndpointSettings {
  const baseUrlInput = typeof raw?.baseUrl === "string" ? stripTrailingSlashes(raw.baseUrl) : "";
  const modelInput = typeof raw?.model === "string" ? raw.model.trim() : "";
  const apiKeyInput = typeof raw?.apiKey === "string" ? raw.apiKey : "";

  return {
    baseUrl: baseUrlInput || fallbackBaseUrl,
    model: modelInput || fallbackModel,
    apiKey: apiKeyInput,
  };
}

function stripTrailingSlashes(value: string): string {
  return value.trim().replace(/\/+$/u, "");
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

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
