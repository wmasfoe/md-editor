export {
  createCodeMirrorRenderer,
  type CodeMirrorRenderer,
  type CodeMirrorRendererOptions,
  type CodeBlockLineNumberPortResult,
  type ExternalEditRequest,
  type ExternalEditResult,
} from "./renderer.ts";
export {
  aiSuggestionExtension,
  acceptAiSuggestion,
  dismissAiSuggestion,
  setAiSuggestionEffect,
  clearAiSuggestionEffect,
  aiSuggestionField,
  type AiSuggestionValue,
} from "./wysiwyg/suggestion.ts";
export type { ImagePreviewResolveInput, ImagePreviewResolver } from "./wysiwyg/image-resolver.ts";

export type {
  DocumentSnapshot,
  DocumentStateEvent,
  EditorMode,
  ModePortResult,
  ModeReceipt,
  ModeRequest,
  RendererExternalEditReceipt,
  RendererSyncResult,
} from "@md-editor/editor-core";
