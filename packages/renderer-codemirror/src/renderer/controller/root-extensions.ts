import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { codeFolding } from "@codemirror/language";
import { search, searchKeymap } from "@codemirror/search";
import { EditorState, type Compartment, type Extension } from "@codemirror/state";
import { EditorView, keymap, type ViewUpdate } from "@codemirror/view";
import { createLintBaseExtensions } from "../../lint/index.ts";

import type { WysiwygDiagnostics } from "../../diagnostics.ts";
import { provideWysiwygDiagnostics } from "../../diagnostics.ts";
import {
  codeBlockTokenHighlighting,
  createMarkdownLanguageSupport,
} from "../../markdown/code-languages.ts";
import { M1_MARKDOWN_EXTENSIONS } from "../../markdown/extensions.ts";
import {
  markdownRangeIndexField,
  mdxModeFacet,
  syntaxPluginRegistryFacet,
} from "../../markdown/range-index.ts";
import { editorModeField } from "../../mode.ts";

import type { SyntaxPluginRegistry } from "../../plugins/syntax-registry.ts";
import { blockToolbarExtension } from "../../wysiwyg/blocks/block-toolbar.ts";
import { codeBlockSelectionExtension } from "../../wysiwyg/editing/code-block-selection.ts";
import { createWysiwygProjectionExtensions } from "../../wysiwyg/index.ts";
import { mdxComponentRegistryFacet } from "../../wysiwyg/projections/mdx-projection.ts";

import { focusDimOpacityFacet } from "../../wysiwyg/view/focus-mode.ts";
import { provideImagePreviewResolver } from "../../wysiwyg/view/image-resolver.ts";
import {
  linkInteractionExtension,
  openLinkTargetFacet,
} from "../../wysiwyg/view/link-interaction.ts";
import { createLiquidSearchPanel } from "../../wysiwyg/view/search-panel.ts";
import {
  aiSuggestionExtension,
  aiSuggestionLabelsFacet,
  type AiSuggestionLabels,
} from "../../wysiwyg/view/suggestion.ts";

import type { CodeMirrorRendererOptions } from "../types.ts";

/** Constructor-only extension assembly; no controller state is retained here. */
export interface RootExtensionContext {
  readonly aiSuggestionLabels: AiSuggestionLabels | undefined;
  readonly aiSuggestionLabelsCompartment: Compartment;
  readonly finishComposition: () => void;
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
    createLintBaseExtensions(),
    EditorState.allowMultipleSelections.of(true),
    EditorView.lineWrapping,
    codeFolding(),
    search({ top: true, createPanel: createLiquidSearchPanel }),
    keymap.of([...searchKeymap, ...defaultKeymap, ...historyKeymap]),
    context.markdownLanguageCompartment.of(
      context.useNativeCodeLanguages
        ? createMarkdownLanguageSupport(
            { extensions: markdownExtensions, addKeymap: false },
            context.wysiwygDiagnostics,
          )
        : markdown({ extensions: markdownExtensions, addKeymap: false }),
    ),
    context.syntaxRegistryCompartment.of(syntaxPluginRegistryFacet.of(context.syntaxRegistry)),
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
      { writeClipboardText: context.options.writeClipboardText },
    ),
    EditorView.updateListener.of((update) => context.handleViewUpdate(update)),
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
