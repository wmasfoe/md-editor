/**
 * @file internals.ts
 * @internal 本文件导出的全部符号**不承诺稳定**：名字、签名与存在性都可能在任何版本改变。
 *
 * 这里的每个条目都在 `docs/agent/architecture/public_api_extensibility_matrix.md`
 * 的白名单里有登记，说明它"为什么还不是正式 API"。想用某个能力时，优先走那三条通道
 * （theme / syntax plugins / ports）；确实需要内部件时，请提 issue 说明场景，
 * 满足晋级规则（≥2 个真实外部需求）后会被提升为语义化的正式 API。
 */
export {
  type ImageInsertionInput,
  type ImageInsertionOptions,
  type PreparedImageInsertion,
} from "./image-insertion.ts";
export { createCodeMirrorRenderer } from "./renderer/index.ts";
export {
  aiSuggestionExtension,
  acceptAiSuggestion,
  dismissAiSuggestion,
  setAiSuggestionEffect,
  clearAiSuggestionEffect,
  aiSuggestionField,
  getSuggestionViewportStatus,
} from "./wysiwyg/view/suggestion.ts";
export {
  aiSuggestionLabelsFacet,
  DEFAULT_AI_SUGGESTION_LABELS,
  aiSuggestionAcceptedAnnotation,
} from "./wysiwyg/view/suggestion-model.ts";
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
  normalizeCodeMirrorKey,
} from "./wysiwyg/editing/markdown-formatting.ts";
export { createLiquidSearchPanel } from "./wysiwyg/view/search-panel.ts";
export { smartPasteExtension, isValidUrl } from "./wysiwyg/input/smart-paste.ts";
export { smartPairsExtension } from "./wysiwyg/input/smart-pairs.ts";
export {
  type ImagePreviewResolveInput,
  type ImagePreviewResolver,
} from "./wysiwyg/view/image-resolver.ts";
export {
  /** @internal 外部包类型：本入口同样不承诺稳定 */
  type DocumentSnapshot,
  /** @internal 外部包类型：本入口同样不承诺稳定 */
  type DocumentStateEvent,
  /** @internal 外部包类型：本入口同样不承诺稳定 */
  type EditorMode,
  /** @internal 外部包类型：本入口同样不承诺稳定 */
  type ModePortResult,
  /** @internal 外部包类型：本入口同样不承诺稳定 */
  type ModeReceipt,
  /** @internal 外部包类型：本入口同样不承诺稳定 */
  type ModeRequest,
  /** @internal 外部包类型：本入口同样不承诺稳定 */
  type RendererExternalEditReceipt,
  /** @internal 外部包类型：本入口同样不承诺稳定 */
  type RendererSyncResult,
} from "@md-editor/core";
export {
  EDITOR_STYLE_CSS,
  EDITOR_STYLE_ELEMENT_ID,
  createDocumentStylePort,
  ensureStyleElement,
  injectEditorStyles,
} from "./styles/index.ts";
export {
  CalloutHeaderWidget,
  CalloutFooterWidget,
  DirectiveHeaderWidget,
} from "./wysiwyg/widgets/callout-widget.ts";
export { markdownRangeIndexField, syntaxPluginRegistryFacet } from "./markdown/range-index.ts";
export { closeMediaViewerFor, openMediaViewer } from "./media-viewer/index.ts";
export {
  createLintBaseExtensions,
  createRealtimeMarkdownLintExtension,
  clearMarkdownLintDiagnostics,
  collectPreservedNonMarkdownDiagnostics,
  createDiagnosticDomNode,
  lintLiquidTheme,
  executeDocumentLint,
  runMarkdownLint,
  runMarkdownLintCommand,
  fixAllMarkdownLintIssues,
  runLinkValidation,
} from "./lint/index.ts";
