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

export interface AiLocalModelSettings {
  readonly enabled: boolean;
  readonly modelId: string;
  readonly version: string | null;
  readonly status: AiLocalModelStatus;
  readonly downloadedBytes: number;
  readonly totalBytes: number;
  readonly error: string | null;
}

export interface AiFeatureSettings {
  readonly continuation: boolean;
  readonly editing: boolean;
}

export interface AiSettings {
  readonly enabled: boolean;
  readonly provider: AiProviderType;
  readonly features: AiFeatureSettings;
  readonly openAiCompatible: AiOpenAiCompatibleSettings;
  readonly localModel: AiLocalModelSettings;
}

export interface AiContextSnapshot {
  readonly before: string;
  readonly after: string;
  readonly selectedText: string;
  readonly mode: AiEditorMode;
  readonly cursor?: AiCursorSnapshot;
  readonly document?: AiDocumentSnapshot;
}

export type AiCompletionContext = AiContextSnapshot;

export interface AiWritingEditSuggestion {
  readonly original: string;
  readonly replacement: string;
  readonly reason?: string;
}

export interface AiWritingSuggestion {
  readonly continuation?: string;
  readonly edit?: AiWritingEditSuggestion;
}

export interface AiContinuationRequestOptions {
  readonly fetchImpl?: typeof fetch;
  readonly localInvokeImpl?: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}
