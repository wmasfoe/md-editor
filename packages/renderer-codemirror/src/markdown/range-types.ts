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
  | "table"
  | "html"
  | "mdx-jsx"
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
  | "table-widget"
  | "html-widget"
  | "mdx-widget"
  | "mdx-placeholder"
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
  "marker" | "content" | "destination" | "title" | "label" | "body" | "delimiter";

export interface MarkdownRangeSegment extends SourceRange {
  readonly role: MarkdownRangeSegmentRole;
}

export type MarkdownCodeBlockKind = "fenced" | "indented";

export type MarkdownCodeBlockFenceStyle = "backtick" | "tilde" | "none";

export type MarkdownCodeBlockStatus = "closed" | "unclosed" | "malformed" | "partial";

export interface MarkdownCodeBlockLineFingerprint extends SourceRange {
  readonly fingerprint: string;
}

export interface MarkdownCodeBlockLanguageInfo {
  readonly raw: string;
  readonly token: string;
  readonly resolvedName: string | null;
}

export interface MarkdownCodeBlockMetadata {
  readonly blockKind: MarkdownCodeBlockKind;
  readonly fenceStyle: MarkdownCodeBlockFenceStyle;
  readonly blockStatus: MarkdownCodeBlockStatus;
  readonly sourceBlockRange: SourceRange;
  readonly sourceFingerprint: string;
  readonly openingFenceRange: SourceRange | null;
  readonly rawInfoRange: SourceRange | null;
  readonly languageTokenRange: SourceRange | null;
  readonly infoSuffixRange: SourceRange | null;
  readonly bodySegments: readonly SourceRange[];
  readonly syntaxIndentRanges: readonly SourceRange[];
  readonly bodyEnvelopeRange: SourceRange | null;
  readonly closingFenceRange: SourceRange | null;
  readonly sourceLineFingerprints: readonly MarkdownCodeBlockLineFingerprint[];
  readonly languageInfo: MarkdownCodeBlockLanguageInfo;
}

export type MarkdownTableCellAlignment = "left" | "center" | "right" | "none";

export interface MarkdownTableCellRange extends SourceRange {
  readonly alignment: MarkdownTableCellAlignment;
}

export interface MarkdownTableBlockMetadata {
  readonly sourceBlockRange: SourceRange;
  readonly sourceFingerprint: string;
  readonly headerRowRange: SourceRange | null;
  readonly delimiterRowRange: SourceRange | null;
  readonly bodyRowRanges: readonly SourceRange[];
  readonly alignments: readonly MarkdownTableCellAlignment[];
  readonly columnCount: number;
  readonly bodyRowCount: number;
  readonly hasLeadingPipes: boolean;
  readonly sourceLineFingerprints: readonly MarkdownCodeBlockLineFingerprint[];
}

export interface MarkdownMdxBlockMetadata {
  readonly componentName: string;
  readonly attributes: readonly { readonly name: string; readonly value: string }[];
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
  readonly codeBlock?: MarkdownCodeBlockMetadata;
  readonly tableBlock?: MarkdownTableBlockMetadata;
  readonly mdxBlock?: MarkdownMdxBlockMetadata;
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
