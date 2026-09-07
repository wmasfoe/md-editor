import type { SourceRange } from "@md-editor/renderer-codemirror";

export const MERMAID_NODES = {
  MermaidBlock: "MermaidBlock",
  MermaidMarker: "MermaidMarker",
} as const;

export interface MermaidMetadata {
  readonly code: string;
  readonly openingMarkerRange: SourceRange;
  readonly closingMarkerRange: SourceRange | null;
  readonly contentRange: SourceRange;
}
