/**
 * @file domain/types.ts
 * @module @md-editor/ai
 * @description
 * AI 领域层核心数据结构定义（纯领域模型，零平台/网络依赖）。
 *
 * 覆盖多协议云端提供商（OpenAI / Anthropic / Google + 自定义 Base URL）、
 * 桌面端本地 GGUF 小模型（Qwen 3 Lite / Gemma 4 Standard）、
 * 编辑器光标上下文快照以及结构化续写/纠错建议数据。
 */

/** 支持的标准云端推理协议类型 */
export type AiProtocolId = "openai" | "anthropic" | "google";

/** 全局激活的 AI 提供商类型：三大云端协议 + 桌面端离线本地模型 */
export type AiProviderType = AiProtocolId | "local";

/** App Harness 调度的稳定逻辑任务标识 */
export type AiTaskKind = "gec" | "completion" | "distill" | "style-analysis";

/** 本地模型下载与校验生命周期状态 */
export type AiLocalModelStatus =
  "not-downloaded" | "downloading" | "verifying" | "available" | "failed";

/** 本地模型硬件档位 */
export type LocalModelTier = "lite" | "standard" | "pro";

/** 编辑器视图模式 */
export type AiEditorMode = "source" | "wysiwyg";

/** 单个云端协议端点的连接凭据与模型配置 */
export interface AiProtocolEndpointSettings {
  /** 自定义或官方 API 根地址（例如 https://api.openai.com/v1 或 https://api.deepseek.com） */
  readonly baseUrl: string;
  /** 目标模型 ID（例如 gpt-4.1-mini、deepseek-chat、claude-sonnet-4-5、gemini-2.5-flash） */
  readonly model: string;
  /** API 访问密钥（连接本地 Ollama / LM Studio 等回环地址时允许为空） */
  readonly apiKey: string;
}

/** 按协议隔离保存的端点配置表（切换协议时不丢失已填 Key 与 URL） */
export type AiEndpointsRecord = Readonly<Record<AiProtocolId, AiProtocolEndpointSettings>>;

/** 快速填充预设项（支持一键切换 DeepSeek / Ollama / OpenAI / Claude / Gemini） */
export interface AiUrlPreset {
  readonly id: "openai" | "deepseek" | "ollama" | "anthropic" | "google";
  readonly label: string;
  readonly protocol: AiProtocolId;
  readonly baseUrl: string;
  readonly defaultModel: string;
  readonly apiKeyPlaceholder: string;
  readonly requiresApiKey: boolean;
}

/** 本地模型内置目录描述元数据 */
export interface AiLocalModelDescriptor {
  readonly id: string;
  readonly tier: LocalModelTier;
  readonly displayName: string;
  readonly parameterSize: string;
  readonly downloadSizeBytes: number;
  readonly recommendedMemoryGb: number;
  readonly description: string;
  readonly isAvailable: boolean;
}

/** AI 写作子能力开关 */
export interface AiFeatureSettings {
  /** 行内幽灵续写与主动续写 */
  readonly continuation: boolean;
  /** 局部语法、错别字与标点修复 (GEC) */
  readonly editing: boolean;
}

/** 本地模型运行时配置与进度状态 */
export interface AiLocalModelSettings {
  readonly enabled: boolean;
  readonly modelId: string;
  readonly version: string | null;
  readonly latestVersion?: string | null;
  readonly hasUpdate?: boolean;
  readonly status: AiLocalModelStatus;
  readonly downloadedBytes: number;
  readonly totalBytes: number;
  readonly error: string | null;
}

/** 三端统一的 AI 偏好设置领域对象 */
export interface AiSettings {
  readonly enabled: boolean;
  readonly provider: AiProviderType;
  readonly features: AiFeatureSettings;
  readonly endpoints: AiEndpointsRecord;
  readonly localModel: AiLocalModelSettings;
  /** 兼容历史 openAiCompatible 字段（与 endpoints.openai 双向同步，保障原生存储平滑升级） */
  readonly openAiCompatible?: AiProtocolEndpointSettings;
}

/** 连通性测试结果 */
export interface AiConnectionTestResult {
  readonly ok: boolean;
  readonly message: string;
  readonly latencyMs?: number;
}

/** 选区范围快照 */
export interface AiTextSelectionSnapshot {
  readonly from: number;
  readonly to: number;
}

/** 光标位置快照 */
export interface AiCursorSnapshot {
  readonly position: number;
  readonly selection?: AiTextSelectionSnapshot;
}

/** 文档基础元信息快照 */
export interface AiDocumentSnapshot {
  readonly filePath?: string | null;
  readonly language?: string;
  readonly title?: string;
}

/** 确定性 AST 提取与后台 Distill 融合后的宏观文档上下文 */
export interface AiDocumentContext {
  readonly title?: string;
  readonly outline?: readonly string[];
  readonly topic?: string;
  readonly domain?: string;
  readonly tags?: readonly string[];
  readonly isDistilled?: boolean;
}

/** Markdown 章节智能分块片段 */
export interface MarkdownSectionChunk {
  readonly heading?: string;
  readonly level: number;
  readonly content: string;
  readonly charCount: number;
}

/** 编辑器发起 AI 任务时的完整上下文快照 */
export interface AiContextSnapshot {
  readonly before: string;
  readonly after: string;
  readonly selectedText: string;
  readonly mode: AiEditorMode;
  readonly cursor?: AiCursorSnapshot;
  readonly document?: AiDocumentSnapshot;
  readonly documentContext?: AiDocumentContext;
}

/** RFC-002 / RFC-004 紧凑四元组 Diff 格式：[startCodePoint, endCodePoint, original, replacement] */
export type CompactTupleDiff = readonly [
  start: number,
  end: number,
  original: string,
  replacement: string,
];

/** 经过三重防御与文本锚点校验后的精确 UTF-16 Diff 条目 */
export interface ValidatedDiffItem {
  readonly start: number;
  readonly end: number;
  readonly utf16From: number;
  readonly utf16To: number;
  readonly original: string;
  readonly replacement: string;
  readonly wasAdjusted?: boolean;
}

/** 用户写作风格画像 */
export interface UserStyleProfile {
  readonly language?: string;
  readonly punctuation?: string;
  readonly preferredTerms?: readonly string[];
  readonly tone?: string;
}

/** 结构化单处或多处语法修改建议 */
export interface AiWritingEditSuggestion {
  readonly hasEdit?: boolean;
  readonly original: string;
  readonly replacement: string;
  readonly reason?: string;
  readonly start?: number;
  readonly end?: number;
  readonly utf16From?: number;
  readonly utf16To?: number;
  readonly diffs?: readonly ValidatedDiffItem[];
}

/** 交付给编辑器渲染层的最终纯领域建议结果 */
export interface AiWritingSuggestion {
  readonly hasContinuation?: boolean;
  readonly continuation?: string;
  readonly hasEdit?: boolean;
  readonly edit?: AiWritingEditSuggestion | null;
}
