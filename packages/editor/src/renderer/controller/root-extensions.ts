import { lintLanguageField } from "../../lint/markdown-lint-i18n.ts";
import { history } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { codeFolding } from "@codemirror/language";
import { search } from "@codemirror/search";
import {
  EditorState,
  type EditorSelection,
  type Compartment,
  type Extension,
} from "@codemirror/state";
import { EditorView, type ViewUpdate } from "@codemirror/view";
import { createLintBaseExtensions, createRealtimeMarkdownLintExtension } from "../../lint/index.ts";
import { markdownLintEngineFacet } from "../../lint/engine.ts";
import { createEditorKeymapExtension } from "./default-keymap-policy.ts";

import type { WysiwygDiagnostics } from "../../diagnostics.ts";
import { provideWysiwygDiagnostics } from "../../diagnostics.ts";
import {
  codeBlockTokenHighlighting,
  createMarkdownLanguageSupport,
} from "../../markdown/code-languages.ts";
import { M1_MARKDOWN_EXTENSIONS } from "../../markdown/extensions.ts";
import { syntaxPluginHostPortsFacet } from "@md-editor/plugin-sdk/syntax";
import {
  markdownRangeIndexField,
  mdxModeFacet,
  syntaxPluginRegistryFacet,
} from "../../markdown/range-index.ts";
import { createModeExtensions, editorModeField } from "../../mode.ts";
import { normalizeLineEndings } from "@md-editor/shared";
import type { DocumentSnapshot } from "@md-editor/core";

import type { SyntaxPluginRegistry } from "@md-editor/plugin-sdk/syntax";
import { createDefaultSyntaxPluginHostPorts } from "../../plugins/syntax-plugin-ports.ts";
import { blockToolbarExtension } from "../../wysiwyg/blocks/block-toolbar.ts";
import { codeBlockSelectionExtension } from "../../wysiwyg/editing/code-block-selection.ts";
import { initialCodeBlockLineNumbersFacet } from "../../wysiwyg/projections/code-block-projection.ts";
import { initialInlineStyleMarkersFacet } from "../../wysiwyg/projections/inline-heading.ts";
import { createWysiwygProjectionExtensions } from "../../wysiwyg/index.ts";
import { mdxComponentRegistryFacet } from "../../wysiwyg/projections/mdx-projection.ts";

import { focusDimOpacityFacet, focusModeInitialFacet } from "../../wysiwyg/view/focus-mode.ts";
import { typewriterModeInitialFacet } from "../../wysiwyg/input/typewriter-mode.ts";
import { provideImagePreviewResolver } from "../../wysiwyg/view/image-resolver.ts";
import {
  linkInteractionExtension,
  openLinkTargetFacet,
} from "../../wysiwyg/view/link-interaction.ts";
import { createLiquidSearchPanel } from "../../wysiwyg/view/search-panel.ts";
import { aiSuggestionExtension } from "../../wysiwyg/view/suggestion.ts";
import {
  aiSuggestionLabelsFacet,
  type AiSuggestionLabels,
  aiSuggestionAcceptedAnnotation,
} from "../../wysiwyg/view/suggestion-model.ts";

import type { MarkdownLintEngine } from "../../lint/engine.ts";
import type { CodeMirrorRendererOptions, ViewAxisState } from "../types.ts";

/** Constructor-only extension assembly; no controller state is retained here. */
export interface RootExtensionContext {
  readonly language: () => string | undefined;
  readonly aiSuggestionLabels: AiSuggestionLabels | undefined;
  readonly aiSuggestionLabelsCompartment: Compartment;
  readonly finishComposition: () => void;
  readonly editMermaid: () => boolean;
  readonly formattingKeymapCompartment: Compartment;
  /**
   * 内置命令键位（Mermaid 编辑、源码/所见即所得切换）的 compartment。
   * 宿主改键（`setKeymaps`）时在这里 reconfigure，避免重建整个 state。
   */
  readonly editorKeymapCompartment: Compartment;
  readonly handleViewUpdate: (update: ViewUpdate) => void;
  readonly markdownLanguageCompartment: Compartment;
  readonly options: CodeMirrorRendererOptions;
  readonly startComposition: () => void;
  readonly syntaxRegistry: SyntaxPluginRegistry;
  readonly syntaxRegistryCompartment: Compartment;
  readonly useNativeCodeLanguages: boolean;
  readonly wysiwygDiagnostics: WysiwygDiagnostics;
}
export function createRootExtensions(context: RootExtensionContext): readonly Extension[] {
  const pluginExtensions = context.syntaxRegistry.getMarkdownExtensions();
  const markdownExtensions = Object.freeze([...M1_MARKDOWN_EXTENSIONS, ...pluginExtensions]);

  return Object.freeze([
    history(),
    lintLanguageField.init(context.language),
    createLintBaseExtensions(),
    EditorState.allowMultipleSelections.of(true),
    EditorView.lineWrapping,
    codeFolding(),
    search({ top: true, createPanel: createLiquidSearchPanel }),
    // 内置命令键位 + 搜索 + 准入后的 CM 默认键位 + 撤销重做；准入规则见 default-keymap-policy.ts。
    context.editorKeymapCompartment.of(
      createEditorKeymapExtension({
        editMermaid: context.editMermaid,
        // 源码/所见即所得切换：由桥接层实现（owner: "editor"），宿主无需自己绑。
        onToggleSourceMode: context.options.onToggleSourceMode,
      }),
    ),
    context.markdownLanguageCompartment.of(
      context.useNativeCodeLanguages
        ? createMarkdownLanguageSupport(
            { extensions: markdownExtensions, addKeymap: false },
            context.wysiwygDiagnostics,
          )
        : markdown({ extensions: markdownExtensions, addKeymap: false }),
    ),
    context.syntaxRegistryCompartment.of(syntaxPluginRegistryFacet.of(context.syntaxRegistry)),
    // 语法插件宿主端口：以 facet 值注入渲染器能力，插件不再 import 渲染器。
    syntaxPluginHostPortsFacet.of(
      context.options.syntaxPluginHostPorts ??
        createDefaultSyntaxPluginHostPorts(context.options.translateEditorMessage),
    ),
    codeBlockTokenHighlighting,
    provideWysiwygDiagnostics(context.wysiwygDiagnostics),
    context.options.resolveImagePreview
      ? provideImagePreviewResolver(context.options.resolveImagePreview)
      : [],
    editorModeField,
    markdownRangeIndexField,
    mdxModeFacet.of(context.options.mdxMode ?? false),
    // 轮1 architect WATCH concern-8：renderer 选项 → facet 的宿主注入路径（通道端到端可行使）
    ...(context.options.focusDimOpacity === undefined
      ? []
      : [focusDimOpacityFacet.of(context.options.focusDimOpacity)]),
    mdxComponentRegistryFacet.of(context.options.mdxComponents ?? null),
    openLinkTargetFacet.of(context.options.openLinkTarget ?? null),
    linkInteractionExtension,
    blockToolbarExtension,
    codeBlockSelectionExtension,
    aiSuggestionExtension,
    context.aiSuggestionLabelsCompartment.of(
      aiSuggestionLabelsFacet.of(context.aiSuggestionLabels),
    ),
    createWysiwygProjectionExtensions(
      [
        "inline-styles",
        "headings",
        "blocks",
        "links",
        "images",
        "thematic-breaks",
        "default-atoms",
        "frontmatter",
        "tables",
        "html",
        "mdx",
        "directives",
      ],
      {
        writeClipboardText: context.options.writeClipboardText,
        formattingKeymapCompartment: context.formattingKeymapCompartment,
      },
    ),
    EditorView.updateListener.of((update) => context.handleViewUpdate(update)),
    // 采纳 AI 建议的事务带有注解；只在宿主订阅时通知，不参与文档同步协议。
    EditorView.updateListener.of((update) => {
      const notify = context.options.onAiSuggestionAccepted;
      if (!notify) return;
      for (const transaction of update.transactions) {
        const accepted = transaction.annotation(aiSuggestionAcceptedAnnotation);
        if (accepted) notify(accepted);
      }
    }),
    EditorView.domEventObservers({
      compositionstart: () => context.startComposition(),
      compositionend: () => {
        // CM6 may schedule its final DOM mutation flush from compositionend.
        // Run after that microtask so the local core revision wins stale checks.
        queueMicrotask(() => queueMicrotask(() => context.finishComposition()));
      },
    }),
  ]);
}

export function createInitialEditorState(input: {
  readonly snapshot: DocumentSnapshot;
  readonly viewAxis: ViewAxisState;
  readonly selection: EditorSelection;
  readonly rootExtensions: readonly Extension[];
  readonly codeBlockLineNumbers: boolean;
  readonly inlineStyleMarkers: boolean;
  readonly modeCompartment: Compartment;
  readonly markdownLintCompartment: Compartment;
  /** 引擎 late-arrive 的 reconfigure 位。 */
  readonly markdownLintEngineCompartment: Compartment;
  /** 当前引擎（模式切换会重建 state，必须沿用运行期注入的那一个）。 */
  readonly markdownLintEngine: MarkdownLintEngine | undefined;
  readonly markdownLintEnabled: boolean;
}): EditorState {
  return EditorState.create({
    doc: normalizeLineEndings(input.snapshot.markdown),
    selection: input.selection,
    extensions: [
      ...input.rootExtensions,
      initialCodeBlockLineNumbersFacet.of(input.codeBlockLineNumbers),
      initialInlineStyleMarkersFacet.of(input.inlineStyleMarkers),
      input.modeCompartment.of(createModeExtensions(input.snapshot.mode)),
      input.markdownLintCompartment.of(
        createRealtimeMarkdownLintExtension(input.markdownLintEnabled),
      ),
      input.markdownLintEngineCompartment.of(markdownLintEngineFacet.of(input.markdownLintEngine)),
      focusModeInitialFacet.of(input.viewAxis.focus),
      typewriterModeInitialFacet.of(input.viewAxis.typewriter),
    ],
  });
}
