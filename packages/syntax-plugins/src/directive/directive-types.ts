import type { SourceRange } from "@md-editor/plugin-sdk/syntax";

export type DirectiveType =
  "info" | "tip" | "note" | "important" | "warning" | "danger" | "caution" | string;

export interface DirectiveMetadata {
  readonly directiveType: string;
  readonly title: string;
  readonly openingMarkerRange: SourceRange;
  readonly closingMarkerRange: SourceRange | null;
  readonly headerRange: SourceRange;
}
