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
export {
  toggleBold,
  toggleItalic,
  toggleStrikethrough,
  toggleInlineCode,
  toggleHighlight,
  insertOrWrapLink,
  insertCodeBlock,
  toggleBlockquote,
  toggleBulletList,
  toggleOrderedList,
  toggleTaskList,
  setParagraph,
  setHeading1,
  setHeading2,
  setHeading3,
  setHeading4,
  setHeading5,
  setHeading6,
  createMarkdownFormattingKeymap,
} from "./wysiwyg/markdown-formatting.ts";
export {
  search,
  searchKeymap,
  openSearchPanel,
  closeSearchPanel,
  findNext,
  findPrevious,
  replaceNext,
  replaceAll,
} from "@codemirror/search";
export { createLiquidSearchPanel } from "./wysiwyg/search-panel.ts";
export { smartLinkPasteExtension, isValidUrl } from "./wysiwyg/smart-paste.ts";
export { smartPairsExtension } from "./wysiwyg/smart-pairs.ts";
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
