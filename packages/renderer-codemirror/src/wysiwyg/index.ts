import type { Extension } from "@codemirror/state";
import { wysiwygChangeProtection } from "./change-protection.ts";
import { createMarkdownStructuredCommandExtensions } from "./markdown-commands.ts";
import { markdownParseProgressPlugin } from "./parse-progress.ts";
import {
  configureWysiwygProjectionFeatures,
  wysiwygProjectionField,
  type WysiwygProjectionFeature,
} from "./projection-state.ts";
import { visibleMarkdownMarksPlugin } from "./visible-marks.ts";

export function createWysiwygProjectionExtensions(
  features: readonly WysiwygProjectionFeature[],
): Extension {
  return [
    configureWysiwygProjectionFeatures(features),
    wysiwygProjectionField,
    visibleMarkdownMarksPlugin,
    wysiwygChangeProtection,
    markdownParseProgressPlugin,
    createMarkdownStructuredCommandExtensions(),
  ];
}
