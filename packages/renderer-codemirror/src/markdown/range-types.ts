export interface SourceRange {
  readonly from: number;
  readonly to: number;
}

export type MarkdownSyntaxKind =
  | "bold"
  | "italic"
  | "strikethrough"
  | "inline-code"
  | "heading-atx"
  | "heading-setext"
  | "quote"
  | "list-item-unordered"
  | "list-item-ordered"
  | "task"
  | "link"
  | "image"
  | "thematic-break"
  | "autolink"
  | "reference-link"
  | "reference-image"
  | "reference-definition"
  | "footnote"
  | "frontmatter"
  | "deferred-code"
  | "deferred-table"
  | "deferred-html"
  | "raw-fallback";

export type MarkdownRenderPolicy =
  | "inline-visible-markers"
  | "heading-active-marker"
  | "marker-hidden"
  | "link-segmented"
  | "image-widget"
  | "thematic-break-widget"
  | "source-only-atom"
  | "frontmatter-panel"
  | "deferred-raw"
  | "raw-fallback";

export type MarkdownEditPolicy = "native" | "structured" | "atom-delete" | "source-mode-only";

export type MarkdownInteractionPolicy =
  | "text"
  | "active-line"
  | "structured-block"
  | "toggle"
  | "reveal-source"
  | "select-atom"
  | "source-mode-required"
  | "none";

export type MarkdownRangeSegmentRole =
  "marker" | "content" | "destination" | "title" | "label" | "body";

export interface MarkdownRangeSegment extends SourceRange {
  readonly role: MarkdownRangeSegmentRole;
}

export interface MarkdownRangeRecord {
  readonly id: string;
  readonly kind: MarkdownSyntaxKind;
  readonly nodeName: string;
  readonly fullRange: SourceRange;
  readonly lineRange: SourceRange;
  readonly blockRange: SourceRange;
  readonly contentRange: SourceRange | null;
  readonly markerRanges: readonly SourceRange[];
  readonly segments: readonly MarkdownRangeSegment[];
  readonly renderPolicy: MarkdownRenderPolicy;
  readonly editPolicy: MarkdownEditPolicy;
  readonly interactionPolicy: MarkdownInteractionPolicy;
  readonly priority: number;
  readonly sourceFingerprint: string;
  readonly parserCoverage: "complete" | "partial";
}

export interface MarkdownParseCoverage {
  readonly to: number;
  readonly complete: boolean;
}

export function sourceRangesOverlap(left: SourceRange, right: SourceRange): boolean {
  return left.from < right.to && right.from < left.to;
}

export function sourceRangeContains(range: SourceRange, position: number): boolean {
  return position >= range.from && position <= range.to;
}

export function fingerprintSource(source: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function freezeSourceRange(range: SourceRange): SourceRange {
  return Object.freeze({ from: range.from, to: range.to });
}
