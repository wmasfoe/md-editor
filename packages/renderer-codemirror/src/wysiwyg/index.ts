import type { Extension } from "@codemirror/state";
import {
  codeBlockEmptyBodyInputHandler,
  codeBlockEmptyBodyPointerHandler,
  codeBlockKeymap,
  provideCodeBlockClipboard,
  type WriteClipboardText,
} from "./code-block-commands.ts";
import { codeBlockLineNumbersField, codeBlockProjectionTheme } from "./code-block-projection.ts";
import { codeBlockLineNumberTheme } from "./code-block-line-numbers.ts";
import { wysiwygChangeProtection } from "./change-protection.ts";
import { createMarkdownStructuredCommandExtensions } from "./markdown-commands.ts";
import { markdownParseProgressPlugin } from "./parse-progress.ts";
import {
  clearWysiwygTypedBoundaryOnBlur,
  configureWysiwygProjectionFeatures,
  visibleRangesProbePlugin,
  wysiwygProjectionField,
  type WysiwygProjectionFeature,
} from "./projection-state.ts";
import { htmlProjectionTheme } from "./html-projection.ts";
import { mdxProjectionTheme } from "./mdx-projection.ts";
import { tableProjectionTheme } from "./table-projection.ts";
import { visibleMarkdownMarksPlugin } from "./visible-marks.ts";

export function createWysiwygProjectionExtensions(
  features: readonly WysiwygProjectionFeature[],
  options: { readonly writeClipboardText?: WriteClipboardText } = {},
): Extension {
  return [
    configureWysiwygProjectionFeatures(features),
    provideCodeBlockClipboard(options.writeClipboardText),
    codeBlockLineNumbersField,
    codeBlockLineNumberTheme,
    codeBlockProjectionTheme,
    tableProjectionTheme,
    htmlProjectionTheme,
    mdxProjectionTheme,
    wysiwygProjectionField,
    clearWysiwygTypedBoundaryOnBlur,
    visibleRangesProbePlugin,
    visibleMarkdownMarksPlugin,
    wysiwygChangeProtection,
    markdownParseProgressPlugin,
    codeBlockEmptyBodyInputHandler,
    codeBlockEmptyBodyPointerHandler,
    codeBlockKeymap,
    createMarkdownStructuredCommandExtensions(),
  ];
}
