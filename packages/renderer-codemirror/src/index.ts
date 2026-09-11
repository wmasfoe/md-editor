/**
 * @file index.ts
 * @description `@md-editor/renderer-codemirror` 公开 API 统一导出。
 * 包含 CodeMirror 6 编辑器适配器、所见即所得交互命令、格式化按键绑定、
 * AI 补全提示扩展、搜索面板、语法扩展插件机制与范围索引核心。
 */

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
  type AiSuggestionItem,
  type AiSuggestionInput,
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

export { type MarkdownSyntaxPlugin } from "./plugins/syntax-plugin.ts";
export { SyntaxPluginRegistry } from "./plugins/syntax-registry.ts";
export {
  CalloutHeaderWidget,
  CalloutFooterWidget,
  DirectiveHeaderWidget,
  defaultCalloutTitle,
  getCalloutSvg,
} from "./wysiwyg/callout-widget.ts";
export { markdownRangeIndexField, syntaxPluginRegistryFacet } from "./markdown/range-index.ts";
export type { MarkdownNodePolicy } from "./markdown/node-policy.ts";
export type {
  MarkdownRangeRecord,
  MarkdownSyntaxKind,
  SourceRange,
} from "./markdown/range-types.ts";
export {
  CODE_BLOCK_LANGUAGES,
  findCodeBlockLanguage,
  type CodeBlockLanguageLoadObserver,
} from "./markdown/code-languages.ts";
