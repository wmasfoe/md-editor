import { syntaxTree, syntaxTreeAvailable } from "@codemirror/language";
import {
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
import { getMarkdownNodePolicy, type MarkdownNodePolicy } from "./node-policy.ts";
import {
  fingerprintSource,
  freezeSourceRange,
  sourceRangeContains,
  sourceRangesOverlap,
  type MarkdownParseCoverage,
  type MarkdownRangeRecord,
  type MarkdownRangeSegment,
  type MarkdownRangeSegmentRole,
  type MarkdownSyntaxKind,
  type SourceRange,
} from "./range-types.ts";

export interface MarkdownRangeIndexBuildOptions {
  readonly coverage?: MarkdownParseCoverage;
  readonly version?: number;
  readonly includeRanges?: readonly SourceRange[];
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

export const markdownRangeIndexField = StateField.define<MarkdownRangeIndex>({
  create(state) {
    const diagnostics = getWysiwygDiagnostics(state);
    diagnostics?.recordFullIndexBuild();
    return buildMarkdownRangeIndex(state.doc.toString(), syntaxTree(state), {
      coverage: readCoverage(state),
    });
  },
  update(previous, transaction) {
    const diagnostics = getWysiwygDiagnostics(transaction.state);
    if (transaction.docChanged) {
      diagnostics?.recordDirtyBlockRebuild();
      return updateMarkdownRangeIndex(previous, transaction);
    }

    if (transaction.effects.some((effect) => effect.is(refreshMarkdownParseCoverageEffect))) {
      diagnostics?.recordParseCoverageRefresh();
      diagnostics?.recordFullIndexBuild();
      return buildMarkdownRangeIndex(transaction.newDoc.toString(), syntaxTree(transaction.state), {
        coverage: readCoverage(transaction.state),
        version: previous.version + 1,
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
  visitParserNode(
    tree.topNode,
    source,
    frontmatter,
    coverage,
    options.includeRanges ?? null,
    { from: 0, to: Math.min(tree.length, source.length) },
    records,
  );
  if (frontmatter) {
    insertRecord(records, createFrontmatterRecord(frontmatter, source, coverage));
  }
  return new MarkdownRangeIndex(records, coverage, source.length, options.version ?? 1);
}

function updateMarkdownRangeIndex(
  previous: MarkdownRangeIndex,
  transaction: Transaction,
): MarkdownRangeIndex {
  const oldSource = transaction.startState.doc.toString();
  const newSource = transaction.newDoc.toString();
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
  expandFrontmatterPriorityRanges(oldSource, newSource, changedRanges, oldDirty, newDirty);

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
  });
  const records = [...mapped];
  for (const record of rebuilt.records) {
    insertRecord(records, record);
  }
  getWysiwygDiagnostics(transaction.state)?.recordMappedRanges(mapped.length);
  return new MarkdownRangeIndex(records, coverage, newSource.length, previous.version + 1);
}

function readCoverage(state: EditorState): MarkdownParseCoverage {
  const tree = syntaxTree(state);
  const to = Math.min(tree.length, state.doc.length);
  return Object.freeze({
    to,
    complete: syntaxTreeAvailable(state, state.doc.length),
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
): void {
  for (let child = node.firstChild; child; child = child.nextSibling) {
    const childBlockRange = node.name === "Document" ? nodeRange(child) : blockRange;
    if (includeRanges && !touchesAny(nodeRange(child), includeRanges)) {
      continue;
    }
    if (!frontmatter || !sourceRangesOverlap(nodeRange(child), frontmatter.fullRange)) {
      const policy = getMarkdownNodePolicy(
        child.name,
        child.parent?.name ?? null,
        directChildren(child).map((directChild) => directChild.name),
      );
      if (policy) {
        insertRecord(output, createParserRecord(child, childBlockRange, source, policy, coverage));
        if (policy.renderPolicy === "deferred-raw" || policy.renderPolicy === "raw-fallback") {
          continue;
        }
      }
    }
    visitParserNode(child, source, frontmatter, coverage, includeRanges, childBlockRange, output);
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
    parserCoverage: fullRange.to <= coverage.to ? "complete" : "partial",
  });
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
  if (
    (record.contentRange && !contentRange) ||
    markerRanges.some((range) => !range) ||
    segments.some((segment) => !segment)
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
  });
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
