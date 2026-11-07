import type { SourceRange } from "@md-editor/plugin-sdk/syntax";

export const HIGHLIGHT_NODES = {
  Highlight: "Highlight",
  HighlightMark: "HighlightMark",
} as const;

export interface HighlightMetadata {
  readonly text: string;
  readonly openingMarkerRange: SourceRange;
  readonly closingMarkerRange: SourceRange;
  readonly contentRange: SourceRange;
}
