/**
 * @file index.ts
 * @description `@md-editor/renderer-codemirror` 公开 API 统一导出。
 * 包含 CodeMirror 6 编辑器适配器、DocumentState ↔ Renderer 绑定层（bridge）、
 * 所见即所得交互命令、格式化按键绑定、AI 补全提示扩展、搜索面板、
 * 语法扩展插件机制与范围索引核心。
 */

export {
  createCodeMirrorEditorBridge,
  getRendererForTesting,
  type CodeMirrorEditorBridge,
  type CodeMirrorEditorBridgeOptions,
  type CodeMirrorEditorPorts,
  type CodeMirrorEditorSyncError,
  type CodeMirrorEditorExternalEditResult,
  type CodeMirrorEditorClipboardWriter,
  type MdxComponentsLookup,
} from "./bridge.ts";

export {
  createCodeMirrorRenderer,
  type CodeMirrorRenderer,
  type CodeMirrorRendererOptions,
  type CodeBlockLineNumberPortResult,
  type ExternalEditRequest,
  type ExternalEditResult,
} from "./renderer/index.ts";
export {
  aiSuggestionExtension,
  aiSuggestionLabelsFacet,
  DEFAULT_AI_SUGGESTION_LABELS,
  acceptAiSuggestion,
  dismissAiSuggestion,
  setAiSuggestionEffect,
  clearAiSuggestionEffect,
  aiSuggestionField,
  type AiSuggestionLabels,
  type AiSuggestionItem,
  type AiSuggestionInput,
  type AiSuggestionValue,
} from "./wysiwyg/view/suggestion.ts";
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
} from "./wysiwyg/editing/markdown-formatting.ts";
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
export { createLiquidSearchPanel } from "./wysiwyg/view/search-panel.ts";
export { smartLinkPasteExtension, isValidUrl } from "./wysiwyg/input/smart-paste.ts";
export { smartPairsExtension } from "./wysiwyg/input/smart-pairs.ts";
export type {
  ImagePreviewResolveInput,
  ImagePreviewResolver,
} from "./wysiwyg/view/image-resolver.ts";

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
} from "./wysiwyg/widgets/callout-widget.ts";
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
export {
  CJK_FRIENDLY_MARKDOWN_EXTENSIONS,
  cjkFriendlyEmphasisMarkdownExtension,
  cjkFriendlyStrikethroughMarkdownExtension,
  resolveCjkFriendlyDelimiterSides,
  readDelimiterNeighbors,
  type DelimiterMarker,
  type DelimiterNeighbors,
  type DelimiterSides,
} from "./markdown/cjk-friendly-emphasis.ts";
export {
  closeMediaViewerFor,
  openMediaViewer,
  createMediaViewerSession,
  ensureViewerStyleElement,
  rewriteSvgIds,
  collectSvgIds,
  findDanglingReferences,
  findLeakedIdTokens,
  VIEWER_CSS,
  VIEWER_STYLE_ELEMENT_ID,
  type MediaViewerContent,
  type MediaViewerHandle,
  type MediaViewerOptions,
  type MediaViewerSession,
  type MediaViewerSessionOptions,
  type MediaViewerZoomPan,
} from "./media-viewer/index.ts";
