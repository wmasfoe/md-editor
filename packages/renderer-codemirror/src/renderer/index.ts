/**
 * @file index.ts
 * @description `renderer/` 子模块的装配边界：冻结门面、工厂函数与测试探针。
 *
 * 本模块只在控制器之后求值（`controller` → `view-adapter` → 本模块），
 * 因此不存在 const/class 求值环。
 */

import type {
  DocumentSnapshot,
  DocumentStateEvent,
  ModeReceipt,
  ModeRequest,
} from "@md-editor/editor-core";
import type { MarkdownSyntaxPlugin } from "../plugins/syntax-plugin.ts";
import type { AiSuggestionInput, AiSuggestionLabels } from "../wysiwyg/view/suggestion.ts";
import { CodeMirrorRendererController } from "./controller.ts";
import { DomRendererViewAdapter, controllerByRenderer } from "./view-adapter.ts";
import type {
  CodeMirrorRenderer,
  CodeMirrorRendererControllerOptions,
  CodeMirrorRendererOptions,
  ExternalEditRequest,
  RendererViewFactory,
  RendererTestingProbeInternal,
  DocumentLinterOptions,
} from "./types.ts";

export type {
  CodeBlockLineNumberPortResult,
  InlineStyleMarkerPortResult,
  MarkdownLintPortResult,
  CodeMirrorRenderer,
  CodeMirrorRendererControllerOptions,
  CodeMirrorRendererOptions,
  ExternalEditRequest,
  ExternalEditResult,
  RendererViewAdapter,
  RendererViewFactory,
  RendererViewFactoryInput,
  RendererTestingProbeInternal,
} from "./types.ts";

function createRendererFacade(controller: CodeMirrorRendererController): CodeMirrorRenderer {
  const renderer: CodeMirrorRenderer = Object.freeze({
    clientId: controller.clientId,
    sync: (event: DocumentStateEvent) => controller.sync(event),
    reconcile: (snapshot: DocumentSnapshot) => controller.reconcile(snapshot),
    applyReservedExternalEdit: (request: ExternalEditRequest) =>
      controller.applyReservedExternalEdit(request),
    applyMode: (request: ModeRequest) => controller.applyMode(request),
    rollbackMode: (receipt: ModeReceipt) => controller.rollbackMode(receipt),
    setCodeBlockLineNumbers: (enabled: boolean) => controller.setCodeBlockLineNumbers(enabled),
    setInlineStyleMarkers: (enabled: boolean) => controller.setInlineStyleMarkers(enabled),
    setMarkdownLint: (enabled: boolean) => controller.setMarkdownLint(enabled),
    recomputeMarkdownLint: () => controller.recomputeMarkdownLint(),
    setHostVisibility: (hidden: boolean) => controller.setHostVisibility(hidden),
    showSuggestion: (suggestion: AiSuggestionInput) => controller.showSuggestion(suggestion),
    setAiSuggestionLabels: (labels: AiSuggestionLabels) => controller.setAiSuggestionLabels(labels),
    acceptSuggestion: () => controller.acceptSuggestion(),
    moveBlockUp: () => controller.moveBlockUp(),
    moveBlockDown: () => controller.moveBlockDown(),
    duplicateBlock: () => controller.duplicateBlock(),
    deleteBlock: () => controller.deleteBlock(),
    toggleFocusMode: () => controller.toggleFocusMode(),
    getViewModeState: () => controller.getViewModeState(),
    toggleTypewriterMode: () => controller.toggleTypewriterMode(),
    dismissSuggestion: () => controller.dismissSuggestion(),
    getSuggestion: () => controller.getSuggestion(),
    getSelectionSnapshot: () => controller.getSelectionSnapshot(),
    get isComposing(): boolean {
      return controller.isComposing;
    },
    focus: () => controller.focus(),
    setSelection: (from: number, to: number) => controller.setSelection(from, to),
    scrollToLine: (
      line: number,
      options?: { readonly select?: boolean; readonly focus?: boolean },
    ) => controller.scrollToLine(line, options),
    requestMeasure: () => controller.requestMeasure(),
    flushPendingEdits: () => controller.flushPendingEdits(),
    use: (...plugins: (MarkdownSyntaxPlugin | readonly MarkdownSyntaxPlugin[])[]) => {
      controller.use(...plugins);
      return renderer;
    },
    setPlugins: (plugins: readonly MarkdownSyntaxPlugin[]) => {
      controller.setPlugins(plugins);
      return renderer;
    },
    runDocumentLint: (options?: DocumentLinterOptions) => controller.runDocumentLint(options),
    runMarkdownLintCommand: (config?: Record<string, unknown>) =>
      controller.runMarkdownLintCommand(config),
    fixAllMarkdownLint: (config?: Record<string, unknown>) => controller.fixAllMarkdownLint(config),
    clearMarkdownLint: () => controller.clearMarkdownLint(),
    destroy: () => controller.destroy(),
  });
  controllerByRenderer.set(renderer, controller);
  return renderer;
}

export function createCodeMirrorRenderer(options: CodeMirrorRendererOptions): CodeMirrorRenderer {
  return createCodeMirrorRendererWithFactory(
    options,
    (input) => new DomRendererViewAdapter(input),
    { useNativeCodeLanguages: true },
  );
}

/** @internal Exported only for the package's state-backed protocol test harness. */
export function createCodeMirrorRendererWithFactory(
  options: CodeMirrorRendererOptions,
  viewFactory: RendererViewFactory,
  controllerOptions: CodeMirrorRendererControllerOptions = { useNativeCodeLanguages: false },
): CodeMirrorRenderer {
  return createRendererFacade(
    new CodeMirrorRendererController(options, viewFactory, controllerOptions),
  );
}

/** @internal Exported only through `@md-editor/renderer-codemirror/testing`. */
export function inspectRendererForTesting(
  renderer: CodeMirrorRenderer,
): RendererTestingProbeInternal {
  const controller = controllerByRenderer.get(renderer);
  if (!controller) {
    throw new Error("Renderer was not created by this package instance.");
  }
  return controller.probe;
}
