import { ensureSyntaxTree, syntaxTree, syntaxTreeAvailable } from "@codemirror/language";
import {
  Facet,
  StateEffect,
  StateField,
  type ChangeDesc,
  type EditorState,
  type Text,
  type Transaction,
} from "@codemirror/state";
import type { SyntaxNode, Tree } from "@lezer/common";
import {
  findFrontmatterSourceRange,
  type FrontmatterSourceRange,
} from "@md-editor/markdown-fidelity";
import { getWysiwygDiagnostics } from "../diagnostics.ts";
import { findCodeBlockLanguage } from "./code-languages.ts";
import { parseMdxJsxElements, type MdxJsxElement } from "./mdx-parse.ts";
import { getMarkdownNodePolicy, type MarkdownNodePolicy } from "./node-policy.ts";
import {
  fingerprintSource,
  freezeSourceRange,
  sourceRangeContains,
  sourceRangesOverlap,
  type MarkdownParseCoverage,
  type MarkdownCodeBlockMetadata,
  type MarkdownCodeBlockStatus,
  type MarkdownCodeBlockFenceStyle,
  type MarkdownCodeBlockLineFingerprint,
  type MarkdownMdxBlockMetadata,
  type MarkdownRangeRecord,
  type MarkdownRangeSegment,
  type MarkdownRangeSegmentRole,
  type MarkdownSyntaxKind,
  type MarkdownTableBlockMetadata,
  type MarkdownTableCellAlignment,
  type SourceRange,
} from "./range-types.ts";

export interface MarkdownRangeIndexBuildOptions {
  readonly coverage?: MarkdownParseCoverage;
  readonly version?: number;
  readonly includeRanges?: readonly SourceRange[];
  /** MDX 模式下大写标签按组件解析;默认 false(纯 Markdown) */
  readonly mdxMode?: boolean;
}

export class MarkdownRangeIndex {
  readonly records: readonly MarkdownRangeRecord[];
  readonly coverage: MarkdownParseCoverage;
  readonly documentLength: number;
  readonly version: number;
  readonly #prefixMaximumEnds: readonly number[];
  readonly #recordsById: ReadonlyMap<string, MarkdownRangeRecord>;

  constructor(
    records: readonly MarkdownRangeRecord[],
    coverage: MarkdownParseCoverage,
    documentLength: number,
    version: number,
  ) {
    this.records = Object.freeze([...records]);
    this.coverage = Object.freeze({ ...coverage });
    this.documentLength = documentLength;
    this.version = version;
    const prefixMaximumEnds: number[] = [];
    const recordsById = new Map<string, MarkdownRangeRecord>();
    let maximumEnd = 0;
    for (const record of this.records) {
      maximumEnd = Math.max(maximumEnd, record.fullRange.to);
      prefixMaximumEnds.push(maximumEnd);
      recordsById.set(record.id, record);
    }
    this.#prefixMaximumEnds = Object.freeze(prefixMaximumEnds);
    this.#recordsById = recordsById;
    Object.freeze(this);
  }

  at(position: number): readonly MarkdownRangeRecord[] {
    return this.overlapping(position, position);
  }

  overlapping(from: number, to: number): readonly MarkdownRangeRecord[] {
    const query = { from, to };
    const records: MarkdownRangeRecord[] = [];
    const firstCandidate = findFirstCandidate(this.#prefixMaximumEnds, from);
    for (let index = firstCandidate; index < this.records.length; index += 1) {
      const record = this.records[index];
      if (record.fullRange.from > to || (from !== to && record.fullRange.from >= to)) {
        break;
      }
      if (
        from === to
          ? sourceRangeContains(record.fullRange, from)
          : sourceRangesOverlap(record.fullRange, query)
      ) {
        records.push(record);
      }
    }
    return Object.freeze(records);
  }

  byKind(kind: MarkdownSyntaxKind): readonly MarkdownRangeRecord[] {
    return Object.freeze(this.records.filter((record) => record.kind === kind));
  }

  get(id: string): MarkdownRangeRecord | null {
    return this.#recordsById.get(id) ?? null;
  }
}

export const refreshMarkdownParseCoverageEffect = StateEffect.define<null>();

/**
 * 文档是否为 MDX 文件(renderer 配置注入)。
 * MDX 模式下大写标签(`<Callout/>`)按组件解析;纯 Markdown 模式下
 * 大写标签是合法 HTML 标签,保持 HTML 路径,不启用 mdx-jsx 解析。
 */
export const mdxModeFacet = Facet.define<boolean, boolean>({
  combine: (values) => values[0] ?? false,
});

export const markdownRangeIndexField = StateField.define<MarkdownRangeIndex>({
  create(state) {
    const diagnostics = getWysiwygDiagnostics(state);
    diagnostics?.recordFullIndexBuild();
    const tree = ensureSyntaxTree(state, state.doc.length, 5_000) ?? syntaxTree(state);
    return buildMarkdownRangeIndex(state.doc.toString(), tree, {
      coverage: readCoverage(state),
      mdxMode: state.facet(mdxModeFacet),
    });
  },
  update(previous, transaction) {
    const diagnostics = getWysiwygDiagnostics(transaction.state);
    if (transaction.docChanged) {
      return updateMarkdownRangeIndex(previous, transaction);
    }

    if (transaction.effects.some((effect) => effect.is(refreshMarkdownParseCoverageEffect))) {
      diagnostics?.recordParseCoverageRefresh();
      diagnostics?.recordFullIndexBuild();
      const tree =
        ensureSyntaxTree(transaction.state, transaction.state.doc.length, 5_000) ??
        syntaxTree(transaction.state);
      return buildMarkdownRangeIndex(transaction.newDoc.toString(), tree, {
        coverage: readCoverage(transaction.state),
        version: previous.version + 1,
        mdxMode: transaction.state.facet(mdxModeFacet),
      });
    }

    return previous;
  },
});

export function buildMarkdownRangeIndex(
  source: string,
  tree: Tree,
  options: MarkdownRangeIndexBuildOptions = {},
): MarkdownRangeIndex {
  const coverage = options.coverage ?? {
    to: Math.min(tree.length, source.length),
    complete: tree.length >= source.length,
  };
  const frontmatter = findFrontmatterSourceRange(source);
  const records: MarkdownRangeRecord[] = [];
  // MDX 组件(micromark 无 acorn)优先于 CM6 HTMLBlock/HTMLTag:
  // `<Callout>` 会被 lang-markdown 当成 HTML 节点,由 mdx-jsx record 接管。
  // 仅 MDX 模式启用;纯 Markdown 下大写标签是合法 HTML,保持 HTML 路径。
  const mdxElements = options.mdxMode
    ? collectMdxElements(source, options.includeRanges ?? null)
    : [];
  visitParserNode(
    tree.topNode,
    source,
    frontmatter,
    coverage,
    options.includeRanges ?? null,
    { from: 0, to: Math.min(tree.length, source.length) },
    records,
    mdxElements,
  );
  if (frontmatter) {
    insertRecord(records, createFrontmatterRecord(frontmatter, source, coverage));
  }
  for (const element of mdxElements) {
    insertRecord(records, createMdxRecord(element, source, coverage));
  }
  return new MarkdownRangeIndex(records, coverage, source.length, options.version ?? 1);
}

/**
 * 收集 MDX 组件元素。预筛 `<[A-Z]`(纯文本/普通文档零开销,安全评审
 * §3.2 允许 isLikelyMdxBlock 类预筛);includeRanges 存在时只保留
 * 与 dirty 区间相交的元素,支持增量重建。
 */
function collectMdxElements(
  source: string,
  includeRanges: readonly SourceRange[] | null,
): readonly MdxJsxElement[] {
  if (!/<\/?[A-Z]/.test(source)) {
    return [];
  }
  const elements = parseMdxJsxElements(source);
  if (!includeRanges) {
    return elements;
  }
  return elements.filter((element) =>
    includeRanges.some((range) =>
      sourceRangesOverlap(range, { from: element.from, to: element.to }),
    ),
  );
}

function createMdxRecord(
  element: MdxJsxElement,
  source: string,
  coverage: MarkdownParseCoverage,
): MarkdownRangeRecord {
  const fullRange = freezeSourceRange({ from: element.from, to: element.to });
  const fingerprint = fingerprintSource(source.slice(element.from, element.to));
  const contentRange =
    element.childrenFrom >= 0
      ? freezeSourceRange({ from: element.childrenFrom, to: element.childrenTo })
      : null;
  const segments: MarkdownRangeSegment[] = contentRange
    ? [{ ...contentRange, role: "content" }]
    : [];
  const mdxBlock: MarkdownMdxBlockMetadata = {
    componentName: element.name,
    attributes: element.attributes,
  };
  return freezeRecord({
    id: `mdx-jsx:${element.from}:${element.to}:${fingerprint}`,
    kind: "mdx-jsx",
    nodeName: `mdx-jsx:${element.name}`,
    fullRange,
    lineRange: lineRangeForSource(source, fullRange),
    blockRange: fullRange,
    contentRange,
    markerRanges: [],
    segments,
    // 统一 mdx-widget;投影层按 registry 匹配决定渲染组件还是占位
    renderPolicy: "mdx-widget",
    editPolicy: "structured",
    interactionPolicy: "structured-block",
    priority: 30,
    sourceFingerprint: fingerprint,
    parserCoverage: fullRange.to <= coverage.to ? "complete" : "partial",
    mdxBlock,
  });
}

function updateMarkdownRangeIndex(
  previous: MarkdownRangeIndex,
  transaction: Transaction,
): MarkdownRangeIndex {
  const oldSource = transaction.startState.doc.toString();
  const newSource = transaction.newDoc.toString();
  // 结构化编辑（如表格增删行）后必须拿到完整语法树，否则 dirty rebuild
  // 无法识别顶层 Table 节点，导致 range-index 短暂丢表。
  ensureSyntaxTree(transaction.state, transaction.state.doc.length, 5_000);
  const tree = syntaxTree(transaction.state);
  const changedRanges = collectChangedRanges(transaction);
  const oldDirty = mergeRanges(
    changedRanges.map(({ oldRange }) =>
      expandOldDirtyRange(transaction.startState.doc, oldRange, previous.records),
    ),
  );
  const newTopLevelRanges = getTopLevelRanges(tree);
  const newDirty = mergeRanges(
    changedRanges.map(({ newRange }) =>
      expandNewDirtyRange(transaction.newDoc, newRange, newTopLevelRanges),
    ),
  );
  // 将 oldDirty 映射到新文档并入 newDirty。删除表格末行时，newRange 可能落在
  // 剩余 Table 节点之外，若不映射会漏 rebuild，导致 range-index 丢表。
  for (const range of oldDirty) {
    const mapped = mapRange(range, transaction.changes);
    if (mapped) {
      insertMergedRange(
        newDirty,
        expandNewDirtyRange(transaction.newDoc, mapped, newTopLevelRanges),
      );
    }
  }
  expandFrontmatterPriorityRanges(oldSource, newSource, changedRanges, oldDirty, newDirty);
  getWysiwygDiagnostics(transaction.state)?.recordDirtyBlockRebuild(newDirty);

  const mapped: MarkdownRangeRecord[] = [];
  for (const record of previous.records) {
    if (record.kind === "frontmatter" || touchesAny(record.blockRange, oldDirty)) {
      continue;
    }
    const nextRecord = mapRecord(record, transaction.changes, newSource);
    if (nextRecord && !touchesAny(nextRecord.blockRange, newDirty)) {
      insertRecord(mapped, nextRecord);
    }
  }

  const coverage = readCoverage(transaction.state);
  const rebuilt = buildMarkdownRangeIndex(newSource, tree, {
    coverage,
    version: previous.version + 1,
    includeRanges: newDirty,
    mdxMode: transaction.state.facet(mdxModeFacet),
  });
  const records = [...mapped];
  for (const record of rebuilt.records) {
    insertRecord(records, record);
  }
  getWysiwygDiagnostics(transaction.state)?.recordMappedRanges(mapped.length);
  return new MarkdownRangeIndex(records, coverage, newSource.length, previous.version + 1);
}

function readCoverage(state: EditorState): MarkdownParseCoverage {
  const tree = ensureSyntaxTree(state, state.doc.length, 5_000) ?? syntaxTree(state);
  const to = Math.min(tree.length, state.doc.length);
  return Object.freeze({
    to,
    complete: to >= state.doc.length || syntaxTreeAvailable(state, state.doc.length),
  });
}

function visitParserNode(
  node: SyntaxNode,
  source: string,
  frontmatter: FrontmatterSourceRange | null,
  coverage: MarkdownParseCoverage,
  includeRanges: readonly SourceRange[] | null,
  blockRange: SourceRange,
  output: MarkdownRangeRecord[],
  mdxElements: readonly MdxJsxElement[],
): void {
  for (let child = node.firstChild; child; child = child.nextSibling) {
    const childBlockRange = node.name === "Document" ? nodeRange(child) : blockRange;
    if (includeRanges && !touchesAny(nodeRange(child), includeRanges)) {
      continue;
    }
    // MDX 组件接管:<Callout> 等在 CM6 语法树中是 HTMLBlock/HTMLTag,
    // 若与 mdx-jsx 元素区间重叠,跳过(不产生 html record,避免双重投影)。
    if (child.name === "HTMLBlock" || child.name === "HTMLTag") {
      const childRange = nodeRange(child);
      if (
        mdxElements.some((element) => childRange.from < element.to && element.from < childRange.to)
      ) {
        continue;
      }
    }
    if (!frontmatter || !sourceRangesOverlap(nodeRange(child), frontmatter.fullRange)) {
      const policy = getMarkdownNodePolicy(
        child.name,
        child.parent?.name ?? null,
        directChildren(child).map((directChild) => directChild.name),
      );
      if (policy) {
        insertRecord(output, createParserRecord(child, childBlockRange, source, policy, coverage));
        if (
          policy.renderPolicy === "deferred-raw" ||
          policy.renderPolicy === "raw-fallback" ||
          policy.renderPolicy === "html-widget" ||
          // Tables claim a structured record but their cell content must not
          // be promoted to inline atom records. The same parse boundary
          // applies to deferred-code and html-widget blocks.
          policy.renderPolicy === "table-widget"
        ) {
          continue;
        }
      }
    }
    visitParserNode(
      child,
      source,
      frontmatter,
      coverage,
      includeRanges,
      childBlockRange,
      output,
      mdxElements,
    );
  }
}

function createParserRecord(
  node: SyntaxNode,
  blockRange: SourceRange,
  source: string,
  policy: MarkdownNodePolicy,
  coverage: MarkdownParseCoverage,
): MarkdownRangeRecord {
  const fullRange = nodeRange(node);
  const children = directChildren(node);
  const markerRanges = collectMarkerRanges(node, children, policy);
  const contentRange = resolveContentRange(node, children, markerRanges, policy, source);
  const parserCoverage = fullRange.to <= coverage.to ? "complete" : "partial";
  const codeBlock =
    node.name === "FencedCode" || node.name === "CodeBlock"
      ? createCodeBlockMetadata(node, children, source, parserCoverage)
      : undefined;
  const tableBlock =
    node.name === "Table" ? createTableBlockMetadata(node, children, source) : undefined;
  const segments: MarkdownRangeSegment[] = markerRanges.map((range) => ({
    ...range,
    role: "marker",
  }));
  if (contentRange) {
    segments.push({ ...contentRange, role: "content" });
  }
  for (const child of children) {
    const role = metadataRole(child.name);
    if (role) {
      segments.push({ ...nodeRange(child), role });
    }
  }
  const fingerprint = fingerprintSource(source.slice(fullRange.from, fullRange.to));
  return freezeRecord({
    id: `${policy.kind}:${fullRange.from}:${fullRange.to}:${fingerprint}`,
    kind: policy.kind,
    nodeName: node.name,
    fullRange,
    lineRange: lineRangeForSource(source, fullRange),
    blockRange,
    contentRange,
    markerRanges,
    segments,
    renderPolicy: policy.renderPolicy,
    editPolicy: policy.editPolicy,
    interactionPolicy: policy.interactionPolicy,
    priority: policy.priority,
    sourceFingerprint: fingerprint,
    parserCoverage,
    ...(codeBlock ? { codeBlock } : {}),
    ...(tableBlock ? { tableBlock } : {}),
  });
}

function createCodeBlockMetadata(
  node: SyntaxNode,
  children: readonly SyntaxNode[],
  source: string,
  parserCoverage: "complete" | "partial",
): MarkdownCodeBlockMetadata {
  return node.name === "FencedCode"
    ? createFencedCodeBlockMetadata(node, children, source, parserCoverage)
    : createIndentedCodeBlockMetadata(node, children, source, parserCoverage);
}

function createFencedCodeBlockMetadata(
  node: SyntaxNode,
  children: readonly SyntaxNode[],
  source: string,
  parserCoverage: "complete" | "partial",
): MarkdownCodeBlockMetadata {
  const fullRange = nodeRange(node);
  const codeMarks = children.filter((child) => child.name === "CodeMark").map(nodeRange);
  const openingFenceRange = codeMarks[0] ?? null;
  const closingFenceRange = codeMarks.length >= 2 ? (codeMarks.at(-1) ?? null) : null;
  const rawInfoRange = children.find((child) => child.name === "CodeInfo");
  const bodySegments = children.filter((child) => child.name === "CodeText").map(nodeRange);
  const sourceBlockRange = lineRangeForSource(source, fullRange);
  const languageRanges = rawInfoRange
    ? deriveLanguageInfoRanges(source, nodeRange(rawInfoRange))
    : { languageTokenRange: null, infoSuffixRange: null };
  const languageToken = languageRanges.languageTokenRange
    ? source.slice(languageRanges.languageTokenRange.from, languageRanges.languageTokenRange.to)
    : "";
  const resolvedLanguage = findCodeBlockLanguage(languageToken);
  const stableStatus = validateFencedCodeBlockMarks(source, openingFenceRange, closingFenceRange);
  const status = resolveCodeBlockStatus(parserCoverage, stableStatus);
  return {
    blockKind: "fenced",
    fenceStyle: openingFenceRange
      ? fenceStyleFor(source.slice(openingFenceRange.from, openingFenceRange.to))
      : "none",
    blockStatus: status,
    sourceBlockRange,
    sourceFingerprint: fingerprintSource(source.slice(sourceBlockRange.from, sourceBlockRange.to)),
    openingFenceRange,
    rawInfoRange: rawInfoRange ? nodeRange(rawInfoRange) : null,
    languageTokenRange: languageRanges.languageTokenRange,
    infoSuffixRange: languageRanges.infoSuffixRange,
    bodySegments,
    syntaxIndentRanges: [],
    bodyEnvelopeRange: envelopeRange(bodySegments),
    closingFenceRange,
    sourceLineFingerprints: fingerprintSourceLines(source, sourceBlockRange),
    languageInfo: {
      raw: rawInfoRange ? source.slice(rawInfoRange.from, rawInfoRange.to) : "",
      token: languageToken,
      resolvedName: resolvedLanguage?.name ?? null,
    },
  };
}

function createIndentedCodeBlockMetadata(
  node: SyntaxNode,
  children: readonly SyntaxNode[],
  source: string,
  parserCoverage: "complete" | "partial",
): MarkdownCodeBlockMetadata {
  const fullRange = nodeRange(node);
  const bodySegments = children.filter((child) => child.name === "CodeText").map(nodeRange);
  const sourceBlockRange = lineRangeForSource(source, {
    from: bodySegments[0]?.from ?? fullRange.from,
    to: bodySegments.at(-1)?.to ?? fullRange.to,
  });
  const syntaxIndentRanges = collectIndentedSyntaxRanges(source, bodySegments);
  return {
    blockKind: "indented",
    fenceStyle: "none",
    blockStatus: resolveCodeBlockStatus(parserCoverage, "closed"),
    sourceBlockRange,
    sourceFingerprint: fingerprintSource(source.slice(sourceBlockRange.from, sourceBlockRange.to)),
    openingFenceRange: null,
    rawInfoRange: null,
    languageTokenRange: null,
    infoSuffixRange: null,
    bodySegments,
    syntaxIndentRanges,
    bodyEnvelopeRange: envelopeRange(bodySegments),
    closingFenceRange: null,
    sourceLineFingerprints: fingerprintSourceLines(source, sourceBlockRange),
    languageInfo: {
      raw: "",
      token: "",
      resolvedName: null,
    },
  };
}

function createTableBlockMetadata(
  node: SyntaxNode,
  children: readonly SyntaxNode[],
  source: string,
): MarkdownTableBlockMetadata {
  const fullRange = nodeRange(node);
  const headerNode = children.find((child) => child.name === "TableHeader") ?? null;
  const delimiterNode = children.find((child) => child.name === "TableDelimiter") ?? null;
  const bodyRowNodes = children.filter((child) => child.name === "TableRow");
  const alignments = delimiterNode
    ? deriveTableColumnAlignments(source, nodeRange(delimiterNode))
    : [];
  const sourceBlockRange = lineRangeForSource(source, {
    from: headerNode?.from ?? fullRange.from,
    to: bodyRowNodes.at(-1)?.to ?? delimiterNode?.to ?? fullRange.to,
  });
  const bodyRowRanges = bodyRowNodes.map(nodeRange);
  const headerRowRange = headerNode ? nodeRange(headerNode) : null;
  const delimiterRowRange = delimiterNode ? nodeRange(delimiterNode) : null;
  const hasLeadingPipes = hasLeadingPipe(source, headerNode, delimiterNode);
  return {
    sourceBlockRange,
    sourceFingerprint: fingerprintSource(source.slice(sourceBlockRange.from, sourceBlockRange.to)),
    headerRowRange,
    delimiterRowRange,
    bodyRowRanges: Object.freeze(bodyRowRanges),
    alignments: Object.freeze(alignments),
    columnCount: alignments.length,
    bodyRowCount: bodyRowRanges.length,
    hasLeadingPipes,
    sourceLineFingerprints: fingerprintSourceLines(source, sourceBlockRange),
  };
}

function deriveTableColumnAlignments(
  source: string,
  delimiterRange: SourceRange,
): readonly MarkdownTableCellAlignment[] {
  const line = source.slice(delimiterRange.from, delimiterRange.to);
  const cellTexts = splitTableDelimiterLine(line);
  return cellTexts.map((cell) => classifyTableAlignment(cell));
}

function splitTableDelimiterLine(line: string): readonly string[] {
  // Drop leading/trailing pipes if present, then split on remaining pipes.
  const trimmed = line.replace(/^\s*\|/, "").replace(/\|\s*$/, "");
  if (!trimmed.trim()) {
    return [];
  }
  return trimmed.split("|").map((cell) => cell.trim());
}

function classifyTableAlignment(cell: string): MarkdownTableCellAlignment {
  const trimmed = cell.trim();
  if (!trimmed.includes("-")) {
    return "none";
  }
  const leftColon = trimmed.startsWith(":");
  const rightColon = trimmed.endsWith(":");
  if (leftColon && rightColon) {
    return "center";
  }
  if (rightColon) {
    return "right";
  }
  if (leftColon) {
    return "left";
  }
  return "none";
}

function hasLeadingPipe(
  source: string,
  headerNode: SyntaxNode | null,
  delimiterNode: SyntaxNode | null,
): boolean {
  for (const node of [headerNode, delimiterNode]) {
    if (!node) continue;
    const slice = source.slice(node.from, Math.min(node.to, node.from + 1));
    if (slice === "|") {
      return true;
    }
    return false;
  }
  return false;
}

function deriveLanguageInfoRanges(
  source: string,
  rawInfoRange: SourceRange,
): Pick<MarkdownCodeBlockMetadata, "languageTokenRange" | "infoSuffixRange"> {
  let tokenFrom = rawInfoRange.from;
  while (tokenFrom < rawInfoRange.to && isHorizontalSpace(source[tokenFrom] ?? "")) {
    tokenFrom += 1;
  }
  let tokenTo = tokenFrom;
  while (tokenTo < rawInfoRange.to && !isHorizontalSpace(source[tokenTo] ?? "")) {
    tokenTo += 1;
  }
  if (tokenFrom === tokenTo) {
    return { languageTokenRange: null, infoSuffixRange: rawInfoRange };
  }
  return {
    languageTokenRange: { from: tokenFrom, to: tokenTo },
    infoSuffixRange: { from: tokenTo, to: rawInfoRange.to },
  };
}

function collectIndentedSyntaxRanges(
  source: string,
  bodySegments: readonly SourceRange[],
): SourceRange[] {
  const ranges: SourceRange[] = [];
  for (const segment of bodySegments) {
    let lineStart = source.lastIndexOf("\n", Math.max(0, segment.from - 1)) + 1;
    while (lineStart < segment.to) {
      const lineEnd = source.indexOf("\n", lineStart);
      const to = lineEnd === -1 ? segment.to : Math.min(lineEnd + 1, segment.to);
      const bodyStart =
        lineStart === source.lastIndexOf("\n", Math.max(0, segment.from - 1)) + 1
          ? segment.from
          : lineStart;
      if (lineStart < bodyStart) {
        ranges.push({ from: lineStart, to: bodyStart });
      }
      lineStart = to;
    }
  }
  return ranges;
}

function envelopeRange(ranges: readonly SourceRange[]): SourceRange | null {
  if (ranges.length === 0) {
    return null;
  }
  return { from: ranges[0].from, to: ranges.at(-1)?.to ?? ranges[0].to };
}

function resolveCodeBlockStatus(
  parserCoverage: "complete" | "partial",
  stableStatus: Exclude<MarkdownCodeBlockStatus, "partial">,
): MarkdownCodeBlockStatus {
  return parserCoverage === "partial" ? "partial" : stableStatus;
}

function validateFencedCodeBlockMarks(
  source: string,
  openingFenceRange: SourceRange | null,
  closingFenceRange: SourceRange | null,
): Exclude<MarkdownCodeBlockStatus, "partial"> {
  if (!openingFenceRange) {
    return "malformed";
  }
  const openingMark = source.slice(openingFenceRange.from, openingFenceRange.to);
  const openingStyle = fenceStyleFor(openingMark);
  if (openingStyle === "none" || openingMark.length < 3) {
    return "malformed";
  }
  if (!closingFenceRange) {
    return "unclosed";
  }
  const closingMark = source.slice(closingFenceRange.from, closingFenceRange.to);
  if (fenceStyleFor(closingMark) !== openingStyle || closingMark.length < openingMark.length) {
    return "malformed";
  }
  return "closed";
}

function fenceStyleFor(mark: string): MarkdownCodeBlockFenceStyle {
  if (mark.startsWith("`")) {
    return "backtick";
  }
  if (mark.startsWith("~")) {
    return "tilde";
  }
  return "none";
}

function fingerprintSourceLines(
  source: string,
  sourceBlockRange: SourceRange,
): MarkdownCodeBlockLineFingerprint[] {
  const fingerprints: MarkdownCodeBlockLineFingerprint[] = [];
  let from = sourceBlockRange.from;
  while (from <= sourceBlockRange.to && from < source.length) {
    const newline = source.indexOf("\n", from);
    const to = newline === -1 || newline > sourceBlockRange.to ? sourceBlockRange.to : newline;
    fingerprints.push({
      from,
      to,
      fingerprint: fingerprintSource(source.slice(from, to)),
    });
    if (newline === -1 || newline >= sourceBlockRange.to) {
      break;
    }
    from = newline + 1;
  }
  if (sourceBlockRange.from === sourceBlockRange.to) {
    fingerprints.push({
      ...sourceBlockRange,
      fingerprint: fingerprintSource(""),
    });
  }
  return fingerprints;
}

function collectMarkerRanges(
  node: SyntaxNode,
  children: readonly SyntaxNode[],
  policy: MarkdownNodePolicy,
): SourceRange[] {
  if (policy.kind !== "quote") {
    return children.filter((child) => policy.markerNodeNames.includes(child.name)).map(nodeRange);
  }

  // A blockquote marker on a continued list line is nested below ListItem in
  // Lezer's tree. Keep it with the nearest Blockquote, while leaving nested
  // Blockquote markers to their own records.
  const markers: SourceRange[] = [];
  const visit = (parent: SyntaxNode): void => {
    for (let child = parent.firstChild; child; child = child.nextSibling) {
      if (child.name === "Blockquote") {
        continue;
      }
      if (child.name === "QuoteMark") {
        markers.push(nodeRange(child));
      } else {
        visit(child);
      }
    }
  };
  visit(node);
  return markers;
}

function createFrontmatterRecord(
  frontmatter: FrontmatterSourceRange,
  source: string,
  coverage: MarkdownParseCoverage,
): MarkdownRangeRecord {
  const markerRanges = [
    frontmatter.openingFenceRange,
    ...(frontmatter.closingFenceRange ? [frontmatter.closingFenceRange] : []),
  ];
  const segments: MarkdownRangeSegment[] = [
    ...markerRanges.map((range) => ({ ...range, role: "marker" as const })),
    { ...frontmatter.contentRange, role: "body" },
  ];
  const fingerprint = fingerprintSource(
    source.slice(frontmatter.fullRange.from, frontmatter.fullRange.to),
  );
  return freezeRecord({
    id: `frontmatter:${frontmatter.status}:${fingerprint}`,
    kind: "frontmatter",
    nodeName: frontmatter.status === "closed" ? "Frontmatter" : "FrontmatterUnterminated",
    fullRange: frontmatter.fullRange,
    lineRange: lineRangeForSource(source, frontmatter.fullRange),
    blockRange: frontmatter.fullRange,
    contentRange: frontmatter.contentRange,
    markerRanges,
    segments,
    renderPolicy: frontmatter.status === "closed" ? "frontmatter-panel" : "raw-fallback",
    editPolicy: "native",
    interactionPolicy: frontmatter.status === "closed" ? "structured-block" : "none",
    priority: 100,
    sourceFingerprint: fingerprint,
    parserCoverage: frontmatter.fullRange.to <= coverage.to ? "complete" : "partial",
  });
}

function resolveContentRange(
  node: SyntaxNode,
  children: readonly SyntaxNode[],
  markers: readonly SourceRange[],
  policy: MarkdownNodePolicy,
  source: string,
): SourceRange | null {
  const fullRange = nodeRange(node);
  switch (policy.contentStrategy) {
    case "between-markers": {
      if (markers.length === 0) {
        return fullRange;
      }
      const from = skipHorizontalSpace(source, markers[0].to, fullRange.to);
      const to = markers.length > 1 ? (markers.at(-1)?.from ?? fullRange.to) : fullRange.to;
      return from <= to ? { from, to } : null;
    }
    case "after-first-marker": {
      const from = skipHorizontalSpace(source, markers[0]?.to ?? fullRange.from, fullRange.to);
      return { from, to: fullRange.to };
    }
    case "before-last-marker": {
      const marker = markers.at(-1);
      const to = trimTrailingLineBreak(source, marker?.from ?? fullRange.to, fullRange.from);
      return { from: fullRange.from, to };
    }
    case "link-label": {
      return markers.length >= 2 ? { from: markers[0].to, to: markers[1].from } : null;
    }
    case "url": {
      const url = children.find((child) => child.name === "URL");
      return url ? nodeRange(url) : null;
    }
    case "full":
      return fullRange;
    case "none":
      return null;
  }
}

function metadataRole(nodeName: string): MarkdownRangeSegmentRole | null {
  if (nodeName === "URL") {
    return "destination";
  }
  if (nodeName === "LinkTitle") {
    return "title";
  }
  if (nodeName === "LinkLabel") {
    return "label";
  }
  return null;
}

function freezeRecord(record: MarkdownRangeRecord): MarkdownRangeRecord {
  return Object.freeze({
    ...record,
    fullRange: freezeSourceRange(record.fullRange),
    lineRange: freezeSourceRange(record.lineRange),
    blockRange: freezeSourceRange(record.blockRange),
    contentRange: record.contentRange ? freezeSourceRange(record.contentRange) : null,
    markerRanges: Object.freeze(record.markerRanges.map(freezeSourceRange)),
    segments: Object.freeze(record.segments.map((segment) => Object.freeze({ ...segment }))),
    ...(record.codeBlock ? { codeBlock: freezeCodeBlockMetadata(record.codeBlock) } : {}),
    ...(record.tableBlock ? { tableBlock: freezeTableBlockMetadata(record.tableBlock) } : {}),
  });
}

function freezeCodeBlockMetadata(metadata: MarkdownCodeBlockMetadata): MarkdownCodeBlockMetadata {
  return Object.freeze({
    ...metadata,
    sourceBlockRange: freezeSourceRange(metadata.sourceBlockRange),
    openingFenceRange: metadata.openingFenceRange
      ? freezeSourceRange(metadata.openingFenceRange)
      : null,
    rawInfoRange: metadata.rawInfoRange ? freezeSourceRange(metadata.rawInfoRange) : null,
    languageTokenRange: metadata.languageTokenRange
      ? freezeSourceRange(metadata.languageTokenRange)
      : null,
    infoSuffixRange: metadata.infoSuffixRange ? freezeSourceRange(metadata.infoSuffixRange) : null,
    bodySegments: Object.freeze(metadata.bodySegments.map(freezeSourceRange)),
    syntaxIndentRanges: Object.freeze(metadata.syntaxIndentRanges.map(freezeSourceRange)),
    bodyEnvelopeRange: metadata.bodyEnvelopeRange
      ? freezeSourceRange(metadata.bodyEnvelopeRange)
      : null,
    closingFenceRange: metadata.closingFenceRange
      ? freezeSourceRange(metadata.closingFenceRange)
      : null,
    sourceLineFingerprints: Object.freeze(
      metadata.sourceLineFingerprints.map((line) =>
        Object.freeze({
          ...freezeSourceRange(line),
          fingerprint: line.fingerprint,
        }),
      ),
    ),
    languageInfo: Object.freeze({ ...metadata.languageInfo }),
  });
}

function freezeTableBlockMetadata(
  metadata: MarkdownTableBlockMetadata,
): MarkdownTableBlockMetadata {
  return Object.freeze({
    ...metadata,
    sourceBlockRange: freezeSourceRange(metadata.sourceBlockRange),
    headerRowRange: metadata.headerRowRange ? freezeSourceRange(metadata.headerRowRange) : null,
    delimiterRowRange: metadata.delimiterRowRange
      ? freezeSourceRange(metadata.delimiterRowRange)
      : null,
    bodyRowRanges: Object.freeze(metadata.bodyRowRanges.map(freezeSourceRange)),
    alignments: Object.freeze([...metadata.alignments]),
    sourceLineFingerprints: Object.freeze(
      metadata.sourceLineFingerprints.map((line) =>
        Object.freeze({
          ...freezeSourceRange(line),
          fingerprint: line.fingerprint,
        }),
      ),
    ),
  });
}

function mapRecord(
  record: MarkdownRangeRecord,
  changes: ChangeDesc,
  newSource: string,
): MarkdownRangeRecord | null {
  const fullRange = mapRange(record.fullRange, changes);
  if (!fullRange) {
    return null;
  }
  if (
    fingerprintSource(newSource.slice(fullRange.from, fullRange.to)) !== record.sourceFingerprint
  ) {
    return null;
  }
  const lineRange = mapRange(record.lineRange, changes);
  const blockRange = mapRange(record.blockRange, changes);
  if (!lineRange || !blockRange) {
    return null;
  }
  const contentRange = record.contentRange ? mapRange(record.contentRange, changes) : null;
  const markerRanges = record.markerRanges.map((range) => mapRange(range, changes));
  const segments = record.segments.map((segment) => {
    const range = mapRange(segment, changes);
    return range ? { ...range, role: segment.role } : null;
  });
  const codeBlock = record.codeBlock
    ? mapCodeBlockMetadata(record.codeBlock, changes, newSource)
    : undefined;
  const tableBlock = record.tableBlock
    ? mapTableBlockMetadata(record.tableBlock, changes, newSource)
    : undefined;
  if (
    (record.contentRange && !contentRange) ||
    markerRanges.some((range) => !range) ||
    segments.some((segment) => !segment) ||
    (record.codeBlock && !codeBlock) ||
    (record.tableBlock && !tableBlock)
  ) {
    return null;
  }
  return freezeRecord({
    ...record,
    fullRange,
    lineRange,
    blockRange,
    contentRange,
    markerRanges: markerRanges as SourceRange[],
    segments: segments as MarkdownRangeSegment[],
    ...(codeBlock ? { codeBlock } : {}),
    ...(tableBlock ? { tableBlock } : {}),
  });
}

function mapCodeBlockMetadata(
  metadata: MarkdownCodeBlockMetadata,
  changes: ChangeDesc,
  newSource: string,
): MarkdownCodeBlockMetadata | null {
  const sourceBlockRange = mapRange(metadata.sourceBlockRange, changes);
  const openingFenceRange = mapOptionalRange(metadata.openingFenceRange, changes);
  const rawInfoRange = mapOptionalRange(metadata.rawInfoRange, changes);
  const languageTokenRange = mapOptionalRange(metadata.languageTokenRange, changes);
  const infoSuffixRange = mapOptionalRange(metadata.infoSuffixRange, changes);
  const bodySegments = metadata.bodySegments.map((range) => mapRange(range, changes));
  const syntaxIndentRanges = metadata.syntaxIndentRanges.map((range) => mapRange(range, changes));
  const bodyEnvelopeRange = mapOptionalRange(metadata.bodyEnvelopeRange, changes);
  const closingFenceRange = mapOptionalRange(metadata.closingFenceRange, changes);
  const sourceLineFingerprints = metadata.sourceLineFingerprints.map((line) => {
    const range = mapRange(line, changes);
    return range ? { ...range, fingerprint: line.fingerprint } : null;
  });
  if (
    !sourceBlockRange ||
    openingFenceRange === undefined ||
    rawInfoRange === undefined ||
    languageTokenRange === undefined ||
    infoSuffixRange === undefined ||
    bodySegments.some((range) => !range) ||
    syntaxIndentRanges.some((range) => !range) ||
    bodyEnvelopeRange === undefined ||
    closingFenceRange === undefined ||
    sourceLineFingerprints.some((line) => !line)
  ) {
    return null;
  }
  if (
    fingerprintSource(newSource.slice(sourceBlockRange.from, sourceBlockRange.to)) !==
    metadata.sourceFingerprint
  ) {
    return null;
  }
  return {
    ...metadata,
    sourceBlockRange,
    openingFenceRange,
    rawInfoRange,
    languageTokenRange,
    infoSuffixRange,
    bodySegments: bodySegments as SourceRange[],
    syntaxIndentRanges: syntaxIndentRanges as SourceRange[],
    bodyEnvelopeRange,
    closingFenceRange,
    sourceLineFingerprints: sourceLineFingerprints as MarkdownCodeBlockLineFingerprint[],
  };
}

function mapTableBlockMetadata(
  metadata: MarkdownTableBlockMetadata,
  changes: ChangeDesc,
  newSource: string,
): MarkdownTableBlockMetadata | null {
  const sourceBlockRange = mapRange(metadata.sourceBlockRange, changes);
  const headerRowRange = mapOptionalRange(metadata.headerRowRange, changes);
  const delimiterRowRange = mapOptionalRange(metadata.delimiterRowRange, changes);
  const bodyRowRanges = metadata.bodyRowRanges.map((range) => mapRange(range, changes));
  const sourceLineFingerprints = metadata.sourceLineFingerprints.map((line) => {
    const range = mapRange(line, changes);
    return range ? { ...range, fingerprint: line.fingerprint } : null;
  });
  if (
    !sourceBlockRange ||
    headerRowRange === undefined ||
    delimiterRowRange === undefined ||
    bodyRowRanges.some((range) => !range) ||
    sourceLineFingerprints.some((line) => !line)
  ) {
    return null;
  }
  if (
    fingerprintSource(newSource.slice(sourceBlockRange.from, sourceBlockRange.to)) !==
    metadata.sourceFingerprint
  ) {
    return null;
  }
  return {
    ...metadata,
    sourceBlockRange,
    headerRowRange,
    delimiterRowRange,
    bodyRowRanges: bodyRowRanges as SourceRange[],
    sourceLineFingerprints: sourceLineFingerprints as MarkdownCodeBlockLineFingerprint[],
  };
}

function mapOptionalRange(
  range: SourceRange | null,
  changes: ChangeDesc,
): SourceRange | null | undefined {
  return range ? (mapRange(range, changes) ?? undefined) : null;
}

function mapRange(range: SourceRange, changes: ChangeDesc): SourceRange | null {
  const from = changes.mapPos(range.from, 1);
  const to = changes.mapPos(range.to, -1);
  return from <= to ? { from, to } : null;
}

function collectChangedRanges(
  transaction: Transaction,
): readonly { readonly oldRange: SourceRange; readonly newRange: SourceRange }[] {
  const ranges: Array<{ oldRange: SourceRange; newRange: SourceRange }> = [];
  transaction.changes.iterChangedRanges((fromA, toA, fromB, toB) => {
    ranges.push({ oldRange: { from: fromA, to: toA }, newRange: { from: fromB, to: toB } });
  });
  return ranges;
}

function expandOldDirtyRange(
  document: Text,
  changed: SourceRange,
  records: readonly MarkdownRangeRecord[],
): SourceRange {
  let expanded = lineRangeForDocument(document, changed);
  for (const record of records) {
    if (rangesTouch(record.blockRange, expanded)) {
      expanded = unionRanges(expanded, record.blockRange);
    }
  }
  return expanded;
}

function expandNewDirtyRange(
  document: Text,
  changed: SourceRange,
  topLevelRanges: readonly SourceRange[],
): SourceRange {
  let expanded = lineRangeForDocument(document, changed);
  for (const topLevel of topLevelRanges) {
    if (rangesTouch(topLevel, expanded)) {
      expanded = unionRanges(expanded, topLevel);
    }
  }
  return expanded;
}

function expandFrontmatterPriorityRanges(
  oldSource: string,
  newSource: string,
  changes: readonly { readonly oldRange: SourceRange; readonly newRange: SourceRange }[],
  oldDirty: SourceRange[],
  newDirty: SourceRange[],
): void {
  const oldFrontmatter = findFrontmatterSourceRange(oldSource);
  const newFrontmatter = findFrontmatterSourceRange(newSource);
  const oldBoundary = oldFrontmatter?.fullRange.to ?? Math.min(4, oldSource.length);
  const touchesPriorityBoundary = changes.some(({ oldRange }) =>
    rangesTouch(oldRange, { from: 0, to: oldBoundary }),
  );
  if (!touchesPriorityBoundary && oldFrontmatter?.status === newFrontmatter?.status) {
    return;
  }
  insertMergedRange(oldDirty, { from: 0, to: oldBoundary });
  insertMergedRange(newDirty, {
    from: 0,
    to: newFrontmatter?.fullRange.to ?? Math.min(4, newSource.length),
  });
}

function getTopLevelRanges(tree: Tree): readonly SourceRange[] {
  const ranges: SourceRange[] = [];
  for (let child = tree.topNode.firstChild; child; child = child.nextSibling) {
    ranges.push(nodeRange(child));
  }
  return ranges;
}

function mergeRanges(ranges: readonly SourceRange[]): SourceRange[] {
  const merged: SourceRange[] = [];
  for (const range of ranges) {
    insertMergedRange(merged, range);
  }
  return merged;
}

function insertMergedRange(ranges: SourceRange[], incoming: SourceRange): void {
  let from = incoming.from;
  let to = incoming.to;
  let index = 0;
  while (index < ranges.length && ranges[index].to < from) {
    index += 1;
  }
  while (index < ranges.length && ranges[index].from <= to) {
    from = Math.min(from, ranges[index].from);
    to = Math.max(to, ranges[index].to);
    ranges.splice(index, 1);
  }
  ranges.splice(index, 0, { from, to });
}

function insertRecord(records: MarkdownRangeRecord[], record: MarkdownRangeRecord): void {
  let index = 0;
  while (index < records.length && compareRecords(records[index], record) <= 0) {
    index += 1;
  }
  records.splice(index, 0, record);
}

function compareRecords(left: MarkdownRangeRecord, right: MarkdownRangeRecord): number {
  return (
    left.fullRange.from - right.fullRange.from ||
    right.fullRange.to - left.fullRange.to ||
    right.priority - left.priority ||
    left.id.localeCompare(right.id)
  );
}

function directChildren(node: SyntaxNode): readonly SyntaxNode[] {
  const children: SyntaxNode[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) {
    children.push(child);
  }
  return children;
}

function nodeRange(node: SyntaxNode): SourceRange {
  return { from: node.from, to: node.to };
}

function lineRangeForSource(source: string, range: SourceRange): SourceRange {
  const from = source.lastIndexOf("\n", Math.max(0, range.from - 1)) + 1;
  const newline = source.indexOf("\n", range.to);
  return { from, to: newline === -1 ? source.length : newline };
}

function lineRangeForDocument(document: Text, range: SourceRange): SourceRange {
  const fromPosition = Math.min(range.from, document.length);
  const toPosition = Math.min(Math.max(range.from, range.to), document.length);
  return {
    from: document.lineAt(fromPosition).from,
    to: document.lineAt(toPosition).to,
  };
}

function skipHorizontalSpace(source: string, from: number, to: number): number {
  let position = from;
  while (position < to && (source[position] === " " || source[position] === "\t")) {
    position += 1;
  }
  return position;
}

function isHorizontalSpace(character: string): boolean {
  return character === " " || character === "\t";
}

function trimTrailingLineBreak(source: string, from: number, minimum: number): number {
  let position = from;
  while (position > minimum && (source[position - 1] === "\n" || source[position - 1] === "\r")) {
    position -= 1;
  }
  return position;
}

function rangesTouch(left: SourceRange, right: SourceRange): boolean {
  if (left.from === left.to) {
    return sourceRangeContains(right, left.from);
  }
  if (right.from === right.to) {
    return sourceRangeContains(left, right.from);
  }
  return sourceRangesOverlap(left, right);
}

function touchesAny(range: SourceRange, candidates: readonly SourceRange[]): boolean {
  return candidates.some((candidate) => rangesTouch(range, candidate));
}

function unionRanges(left: SourceRange, right: SourceRange): SourceRange {
  return { from: Math.min(left.from, right.from), to: Math.max(left.to, right.to) };
}

function findFirstCandidate(prefixMaximumEnds: readonly number[], position: number): number {
  let low = 0;
  let high = prefixMaximumEnds.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (prefixMaximumEnds[middle] < position) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
}
