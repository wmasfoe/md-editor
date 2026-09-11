/**
 * @file settings.ts
 * @module @md-editor/ai
 * @description
 * AI 功能配置领域模型与预设清单。
 *
 * 维护云端模型提供商（OpenAI 兼容协议、DeepSeek）、本地大模型（Qwen3 架构 LoRA 矩阵）
 * 的连接端点、默认配置模板、以及健壮的持久化配置归一化（Normalization）逻辑。
 */

import type {
  AiLocalModelDescriptor,
  AiLocalModelSettings,
  AiLocalModelStatus,
  AiProviderType,
  AiSettings,
} from "./types.ts";

/** 默认 OpenAI 兼容协议的基础端点 */
export const DEFAULT_OPENAI_COMPATIBLE_ENDPOINT = "https://api.openai.com/v1";

/** 默认 DeepSeek 官方 API 端点 */
export const DEFAULT_DEEPSEEK_ENDPOINT = "https://api.deepseek.com";

/** 默认采用的本地模型 ID（标准版） */
export const DEFAULT_LOCAL_MODEL_ID = "md-editor-writer-standard";

/** 历史兼容使用的旧模型 ID */
export const LEGACY_LOCAL_MODEL_ID = "md-editor-writer-small-v1";

/** 极速轻量版模型 ID (0.6B) */
export const LITE_LOCAL_MODEL_ID = "md-editor-writer-lite";

/** 标准进阶版模型 ID (1.7B) */
export const STANDARD_LOCAL_MODEL_ID = "md-editor-writer-standard";

/** 旗舰级专业版模型 ID (规划中) */
export const PRO_LOCAL_MODEL_ID = "md-editor-writer-pro";

/**
 * md-editor 内置推荐的本地 AI 模型规格目录。
 */
export const BUILTIN_LOCAL_MODELS: readonly AiLocalModelDescriptor[] = [
  {
    id: "md-editor-writer-lite",
    tier: "lite",
    displayName: "Lite (0.6B)",
    parameterSize: "0.6B",
    downloadSizeBytes: 760_639_104,
    recommendedMemoryGb: 4,
    description: "Qwen3 架构任务专用 LoRA 矩阵（纠错 / 续写 / 提炼），极速轻量，支持独立调度。",
    isAvailable: true,
  },
  {
    id: "md-editor-writer-standard",
    tier: "standard",
    displayName: "Standard (1.7B)",
    parameterSize: "1.7B",
    downloadSizeBytes: 2_043_698_816,
    recommendedMemoryGb: 8,
    description: "Qwen3 进阶版，搭载语法纠错、行内续写与长文提炼三大任务专用 LoRA，能力全面。",
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

/**
 * 本地模型运行时默认状态配置。
 */
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

/**
 * md-editor 全局 AI 设置默认值。
 */
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

/**
 * 校验并归一化 AI 提供商标识，若不合法则兜底为 "openai-compatible"。
 *
 * @param input 任意输入值
 * @returns 合法的 AiProviderType
 */
export function normalizeAiProvider(input: unknown): AiProviderType {
  if (input === "deepseek" || input === "local") {
    return input;
  }

  return "openai-compatible";
}

/**
 * 判断指定的提供商是否属于远端 HTTP API 服务（非本地离线模型）。
 *
 * @param provider AI 提供商类型
 */
export function isRemoteAiProvider(provider: AiProviderType): boolean {
  return provider === "openai-compatible" || provider === "deepseek";
}

/**
 * 获取对应提供商在 UI 设置界面中的默认端点占位符。
 *
 * @param provider AI 提供商类型
 */
export function providerEndpointPlaceholder(provider: AiProviderType): string {
  return provider === "deepseek" ? DEFAULT_DEEPSEEK_ENDPOINT : DEFAULT_OPENAI_COMPATIBLE_ENDPOINT;
}

/**
 * 获取对应提供商在 UI 设置界面中的默认模型名占位符。
 *
 * @param provider AI 提供商类型
 */
export function providerModelPlaceholder(provider: AiProviderType): string {
  return provider === "deepseek" ? "deepseek-chat" : "gpt-4.1-mini";
}

/**
 * 校验并归一化本地模型的生命周期状态字符串。
 *
 * @param input 状态输入值
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
 * 归一化本地模型持久化配置对象，补全缺失字段并过滤无效数据。
 *
 * @param input 本地模型设置的不完全输入
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
 * 校验并归一化全局 AI 配置，确保其符合当前版本的模式定义。
 *
 * @param input 任意可能损坏或旧版本的配置输入
 * @returns 经过清洗与防御校验的完整 AiSettings 对象
 */
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

/**
 * 不可变地更新当前 AI 提供商，并在需要时自适应调整默认请求端点。
 *
 * @param settings 当前 AI 设置
 * @param provider 目标提供商
 */
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

/**
 * 不可变地开启或关闭特定 AI 子功能（如续写或智能纠错）。
 *
 * @param settings 当前 AI 设置
 * @param feature 功能项名称
 * @param enabled 是否启用
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
 * 清洗并格式化 API Base URL，移除末尾多余斜杠并填充默认值。
 */
function normalizeAiBaseUrl(input: string | undefined, provider: AiProviderType): string {
  if (provider === "deepseek") {
    return DEFAULT_DEEPSEEK_ENDPOINT;
  }

  const value = input?.trim().replace(/\/+$/u, "");
  return value || DEFAULT_AI_SETTINGS.openAiCompatible.baseUrl;
}

/**
 * 校验模型 ID 是否合法，自动映射旧模型别名到当前标准 ID。
 */
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

/**
 * 安全转换可能为空的字符串输入。
 */
function normalizeNullableString(input: unknown): string | null {
  const value = typeof input === "string" ? input.trim() : "";
  return value || null;
}

/**
 * 安全转换字节数大小，杜绝负数与 NaN。
 */
function normalizeByteCount(input: unknown): number {
  return typeof input === "number" && Number.isFinite(input) && input > 0 ? Math.floor(input) : 0;
}
