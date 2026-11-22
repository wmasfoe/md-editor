/**
 * @file index.ts
 * @description `@md-editor/editor` 公开 API 统一导出。
 * 包含 CodeMirror 6 编辑器适配器、DocumentState ↔ Renderer 绑定层（bridge）、
 * 所见即所得交互命令、格式化按键绑定、AI 补全提示扩展、搜索面板、
 * 语法扩展插件机制与范围索引核心。
 */

export { calculateDocumentMetrics, type DocumentMetrics } from "./markdown/document-metrics.ts";
export {
  createCodeMirrorEditorBridge,
  type CodeMirrorEditorBridge,
  type CodeMirrorEditorBridgeOptions,
  type CodeMirrorEditorPorts,
  type CodeMirrorEditorSyncError,
  type CodeMirrorEditorExternalEditResult,
  type CodeMirrorEditorClipboardWriter,
  type MdxComponentsLookup,
} from "./bridge.ts";
export {
  type CodeMirrorRenderer,
  type CodeMirrorRendererOptions,
  type CodeBlockLineNumberPortResult,
  type MarkdownLintPortResult,
  type ExternalEditRequest,
  type ExternalEditResult,
} from "./renderer/index.ts";
export { type SuggestionViewportPosition } from "./wysiwyg/view/suggestion.ts";
export {
  type AiSuggestionLabels,
  type AiSuggestionItem,
  type AiSuggestionInput,
  type AiSuggestionValue,
  type AiSuggestionKind,
  type AiSuggestionAcceptedEvent,
} from "./wysiwyg/view/suggestion-model.ts";
export { createDefaultSyntaxPluginHostPorts } from "./plugins/syntax-plugin-ports.ts";
export {
  THEME_VARIABLES,
  type InjectEditorStylesOptions,
  type StyleElementPort,
  type StyleInjectionPort,
  type ThemeVariableSpec,
} from "./styles/index.ts";
export {
  CODE_BLOCK_LANGUAGES,
  findCodeBlockLanguage,
  type CodeBlockLanguageLoadObserver,
} from "./markdown/code-languages.ts";
export {
  EDITOR_USER_NOTICE_EVENT,
  dispatchEditorUserNotice,
  type EditorUserNoticeDetail,
} from "./editor-user-notice.ts";
export {
  type MediaViewerContent,
  type MediaViewerHandle,
  type MediaViewerOptions,
  type MediaViewerZoomPan,
} from "./media-viewer/index.ts";
export {
  type MarkdownLintRunResult,
  type MarkdownLintFixAllResult,
  type DocumentLinterOptions,
  type LinkLintOptions,
  type LinkDiagnosticItem,
  type MarkdownLintDiagnostic,
} from "./lint/index.ts";
export {
  compileEditorTheme,
  type EditorTheme,
  type EditorThemeColors,
  type EditorThemeGeometry,
  type EditorThemeTypography,
  type ThemeVariables,
} from "./theme/index.ts";

export type {
  MarkdownLintEngine,
  MarkdownLintIssue,
  MarkdownLintRequest,
  MarkdownLintResult,
} from "./lint/engine.ts";
