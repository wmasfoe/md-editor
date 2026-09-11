/**
 * @file range-types.ts
 * @description Markdown 语法范围索引核心类型定义与常用区间操作工具。
 * 定义了源文本范围、语法种类、渲染/编辑/交互策略枚举、结构化代码块/表格/警示块元数据、
 * 以及单条语法范围记录 MarkdownRangeRecord 数据契约。
 */

/**
 * 源码字符起止闭区间（0-indexed, [from, to]）。
 */
export interface SourceRange {
  readonly from: number;
  readonly to: number;
}

/**
 * Markdown 语法节点分类。
 */
export type MarkdownSyntaxKind =
  | "bold"
  | "italic"
  | "strikethrough"
  | "inline-code"
  | "highlight"
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
  | "directive"
  | "inline-math"
  | "block-math"
  | "deferred-code"
  | "deferred-table"
  | "deferred-html"
  | "raw-fallback";

/**
 * 投影渲染策略，决定视觉层如何装饰或替换语法节点。
 */
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
  | "directive-panel"
  | "deferred-raw"
  | "raw-fallback";

/**
 * 编辑保护策略，决定直接键盘输入、删除或粘贴如何处理。
 */
export type MarkdownEditPolicy = "native" | "structured" | "atom-delete" | "source-mode-only";

/**
 * 交互语义策略，决定光标移动、点击展开、块选择等行为。
 */
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

export interface MarkdownDirectiveMetadata {
  readonly directiveType: string;
  readonly title: string;
  readonly openingMarkerRange: SourceRange;
  readonly closingMarkerRange: SourceRange | null;
  readonly headerRange: SourceRange;
}

export type MarkdownAlertType = "note" | "tip" | "important" | "warning" | "caution";

export interface MarkdownAlertMetadata {
  readonly alertType: MarkdownAlertType;
  readonly title: string;
  readonly markerRange: SourceRange;
  readonly headerLineRange: SourceRange;
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
  readonly directive?: MarkdownDirectiveMetadata;
  readonly alert?: MarkdownAlertMetadata;
  readonly metadata?: Readonly<Record<string, unknown>>;
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
