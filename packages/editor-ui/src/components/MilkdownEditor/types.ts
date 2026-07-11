import type { ReactNode } from "react";
import type { AiCompletionContext, AiSettings, AiWritingSuggestion } from "@md-editor/ai";
import type { DocumentSnapshot, EditorMode } from "@md-editor/editor-core";
import type { EditorUiCommandSlots } from "../../hooks/useEditorUi";
import type { MdxSnippetPlugin } from "../../hooks/useMdxAiController";
import type { OutlineItem } from "../OutlinePanel";
import type { EditorScrollTarget, TocTarget } from "../../types";
import type { WysiwygMarkdownSourceDraft } from "../../utils/wysiwyg-markdown-source";

export type MilkdownEditorCommandHandlers = EditorUiCommandSlots;

export interface MdxComponentMenuRenderProps<TPlugin extends MdxSnippetPlugin = MdxSnippetPlugin> {
  readonly plugins: readonly TPlugin[];
  readonly onInsert: (plugin: TPlugin) => void;
  readonly onClose: () => void;
}

export interface MilkdownEditorMdxAiOptions<TPlugin extends MdxSnippetPlugin = MdxSnippetPlugin> {
  readonly aiSettings: AiSettings;
  readonly getEditorMode: () => EditorMode;
  readonly showToast: (message: string | null) => void;
  readonly getMdxComponentPlugins: () => readonly TPlugin[];
  readonly getAiCompletionReadiness: (settings: AiSettings) => string | null;
  readonly requestAiCompletion: (
    settings: AiSettings,
    context: AiCompletionContext,
    request?: { readonly signal?: AbortSignal },
  ) => Promise<AiWritingSuggestion>;
}

export interface MilkdownEditorProps<
  TPlugin extends MdxSnippetPlugin = MdxSnippetPlugin,
> extends Omit<
  MilkdownEditorPrimitiveProps,
  | "insertRequest"
  | "aiSuggestionRequest"
  | "isAiSuggestionPending"
  | "aiAutoSuggestionsEnabled"
  | "onInsertRequestHandled"
  | "onAiSuggestionRequest"
  | "onAiSuggestionRequestHandled"
  | "onAiSuggestionError"
  | "outline"
  | "target"
  | "scrollTarget"
  | "onScrollRatioChange"
  | "onScrollTargetApplied"
  | "onActiveOutlineChange"
> {
  readonly mdxAi: MilkdownEditorMdxAiOptions<TPlugin>;
  readonly onEditorCommandsChange?: (commands: MilkdownEditorCommandHandlers) => void;
  readonly renderMdxComponentMenu?: (props: MdxComponentMenuRenderProps<TPlugin>) => ReactNode;
}

export interface MilkdownEditorPrimitiveProps {
  readonly snapshot: DocumentSnapshot;
  readonly outline?: readonly OutlineItem[];
  readonly target: TocTarget | null;
  readonly scrollTarget?: EditorScrollTarget | null;
  readonly insertRequest?: MarkdownInsertRequest | null;
  readonly aiSuggestionRequest?: AiSuggestionRequest | null;
  readonly isAiSuggestionPending?: boolean;
  readonly aiAutoSuggestionsEnabled?: boolean;
  readonly showCodeBlockLineNumbers?: boolean;
  readonly wysiwygFontSize?: number;
  readonly onInsertRequestHandled?: (id: number) => void;
  readonly onAiSuggestionRequest?: (
    context: AiCompletionContext,
    request: AiSuggestionRequest,
  ) => Promise<AiWritingSuggestion>;
  readonly onAiSuggestionRequestHandled?: (id: number) => void;
  readonly onAiSuggestionError?: (message: string) => void;
  readonly onChange: (markdown: string) => void;
  readonly onOpenLink?: (href: string) => void;
  readonly onScrollRatioChange?: (ratio: number) => void;
  readonly onScrollTargetApplied?: (nonce: number) => void;
  readonly onActiveOutlineChange?: (id: string | null) => void;
  readonly resolveImageSrc?: (src: string) => string;
  readonly sourceDrafts?: readonly WysiwygMarkdownSourceDraft[];
  readonly onSourceDraftsChange?: (drafts: readonly WysiwygMarkdownSourceDraft[]) => void;
}

export interface MarkdownInsertRequest {
  readonly id: number;
  readonly markdown: string;
}

export interface AiSuggestionRequest {
  readonly id: number;
  readonly signal?: AbortSignal;
}
