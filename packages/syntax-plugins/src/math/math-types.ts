import type { SourceRange } from "@md-editor/renderer-codemirror";

export const MATH_NODES = {
  InlineMath: "InlineMath",
  BlockMath: "BlockMath",
  MathMark: "MathMark",
} as const;

export type MathKind = "inline" | "block";

export interface MathMetadata {
  readonly mathKind: MathKind;
  readonly expression: string;
  readonly openingMarkerRange: SourceRange;
  readonly closingMarkerRange: SourceRange | null;
  readonly contentRange: SourceRange;
}
