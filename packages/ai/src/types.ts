export type AiProviderType = "openai-compatible" | "deepseek" | "local";

export type AiLocalModelStatus =
  "not-downloaded" | "downloading" | "verifying" | "available" | "failed";

export type AiEditorMode = "source" | "wysiwyg";

export interface AiTextSelectionSnapshot {
  readonly from: number;
  readonly to: number;
}

export interface AiCursorSnapshot {
  readonly position: number;
  readonly selection?: AiTextSelectionSnapshot;
}

export interface AiDocumentSnapshot {
  readonly filePath?: string | null;
  readonly language?: string;
  readonly title?: string;
}

export interface AiOpenAiCompatibleSettings {
  readonly baseUrl: string;
  readonly model: string;
  readonly apiKey: string;
}

export type LocalModelTier = "lite" | "standard" | "pro";

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

export interface AiFeatureSettings {
  readonly continuation: boolean;
  readonly editing: boolean;
}

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

export interface AiSettings {
  readonly enabled: boolean;
  readonly provider: AiProviderType;
  readonly features: AiFeatureSettings;
  readonly openAiCompatible: AiOpenAiCompatibleSettings;
  readonly localModel: AiLocalModelSettings;
}

export interface AiDocumentContext {
  readonly title?: string;
  readonly outline?: readonly string[];
  readonly topic?: string;
  readonly domain?: string;
  readonly tags?: readonly string[];
  readonly isDistilled?: boolean;
}

export interface MarkdownSectionChunk {
  readonly heading?: string;
  readonly level: number;
  readonly content: string;
  readonly charCount: number;
}

export interface AiContextSnapshot {
  readonly before: string;
  readonly after: string;
  readonly selectedText: string;
  readonly mode: AiEditorMode;
  readonly cursor?: AiCursorSnapshot;
  readonly document?: AiDocumentSnapshot;
  readonly documentContext?: AiDocumentContext;
}

export type AiCompletionContext = AiContextSnapshot;

export type CompactTupleDiff = readonly [
  start: number,
  end: number,
  original: string,
  replacement: string,
];

export interface ValidatedDiffItem {
  readonly start: number;
  readonly end: number;
  readonly utf16From: number;
  readonly utf16To: number;
  readonly original: string;
  readonly replacement: string;
  readonly wasAdjusted?: boolean;
}

export interface UserStyleProfile {
  readonly language?: string;
  readonly punctuation?: string;
  readonly preferredTerms?: readonly string[];
  readonly tone?: string;
}

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

export interface AiWritingSuggestion {
  readonly hasContinuation?: boolean;
  readonly continuation?: string;
  readonly hasEdit?: boolean;
  readonly edit?: AiWritingEditSuggestion | null;
}

export interface AiContinuationRequestOptions {
  readonly intent?: "continuation" | "editing" | "both" | "distill";
  readonly fetchImpl?: typeof fetch;
  readonly localInvokeImpl?: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  readonly profile?: UserStyleProfile;
  readonly isGhostText?: boolean;
  readonly language?: string;
  readonly documentContext?: AiDocumentContext;
  readonly previousSummary?: string;
}

