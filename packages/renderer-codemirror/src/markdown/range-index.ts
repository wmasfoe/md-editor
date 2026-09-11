/**
 * @file range-index.ts
 * @description Markdown 文档语法范围索引（Range Index）核心模块。
 *
 * ## 架构角色
 * Range Index 是 WYSIWYG 渲染管道的结构化骨架：
 * 1. 在 Lezer AST 解析树之上构建块级与内联语法范围记录（`MarkdownRangeRecord`）；
 * 2. 维护区间前缀最大值数组（`#prefixMaximumEnds`），通过二分查找实现 O(log N + K) 的点查与重叠查询；
 * 3. 作为 CodeMirror `StateField` 运行，并在文档发生编辑时，通过脏区间合并（Dirty Blocks）
 *    与不可变映射（`mapRecord`）提供毫秒级的高效增量重建。
 *
 * 各语法类型的深度提取逻辑已拆分至 `extractors/` 子模块（代码块、表格、警示块、Frontmatter、MDX 等）。
 */

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
import type { MdxJsxElement } from "./mdx-parse.ts";
import { getMarkdownNodePolicy, type MarkdownNodePolicy } from "./node-policy.ts";
import { SyntaxPluginRegistry } from "../plugins/syntax-registry.ts";
import {
  fingerprintSource,
  sourceRangeContains,
  sourceRangesOverlap,
  type MarkdownParseCoverage,
  type MarkdownDirectiveMetadata,
  type MarkdownRangeRecord,
  type MarkdownRangeSegment,
  type MarkdownSyntaxKind,
  type SourceRange,
} from "./range-types.ts";
import {
  collectMarkerRanges,
  directChildren,
  freezeRecord,
  insertMergedRange,
  insertRecord,
  lineRangeForDocument,
  lineRangeForSource,
  mapRange,
  mergeRanges,
  metadataRole,
  nodeRange,
  rangesTouch,
  resolveContentRange,
  touchesAny,
  unionRanges,
} from "./extractors/common.ts";
import { resolveAlertMetadata } from "./extractors/alert.ts";
import { createCodeBlockMetadata, mapCodeBlockMetadata } from "./extractors/code-block.ts";
import { createTableBlockMetadata, mapTableBlockMetadata } from "./extractors/table.ts";
import {
  createFrontmatterRecord,
  expandFrontmatterPriorityRanges,
} from "./extractors/frontmatter.ts";
import { collectMdxElements, createMdxRecord } from "./extractors/mdx.ts";

/**
 * 构建 Markdown 范围索引的配置选项。
 */
export interface MarkdownRangeIndexBuildOptions {
  /** 语法树解析覆盖范围与完整度标记 */
  readonly coverage?: MarkdownParseCoverage;
  /** 索引版本号（单调递增） */
  readonly version?: number;
  /** 仅针对指定的脏区间执行局部重解析（增量构建时使用） */
  readonly includeRanges?: readonly SourceRange[];
  /** MDX 模式：大写 JSX 标签（如 `<Callout/>`）按组件解析，纯 Markdown 下作为普通 HTML */
  readonly mdxMode?: boolean;
  /** 外部语法扩展插件注册中心 */
  readonly pluginRegistry?: SyntaxPluginRegistry;
}

/**
 * Markdown 文档结构化范围索引。
 * 维护全文档所有语法块及原子标记的有序记录，提供快速空间范围查找。
 */
export class MarkdownRangeIndex {
  /** 所有解析生成的语法范围记录（已排序并冻结） */
  readonly records: readonly MarkdownRangeRecord[];
  /** 解析覆盖情况 */
  readonly coverage: MarkdownParseCoverage;
  /** 构建时文档的总长度 */
  readonly documentLength: number;
  /** 索引版本号 */
  readonly version: number;
  /** 用于二分搜索的前缀最大右边界数组 */
  readonly #prefixMaximumEnds: readonly number[];
  /** ID 到记录的快速映射表 */
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

  /**
   * 查询包含指定字符偏移量的所有记录。
   *
   * @param position - 文档中的字符偏移位置
   * @returns 覆盖该位置的记录列表
   */
  at(position: number): readonly MarkdownRangeRecord[] {
    return this.overlapping(position, position);
  }

  /**
   * 空间区间重叠查询：检索与指定 [from, to] 区间存在重叠的所有语法记录。
   * 利用二分查找定位首个可能相交的记录，实现次线性时间开销。
   *
   * @param from - 查询区间起始点
   * @param to - 查询区间结束点
   * @returns 相交记录数组
   */
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

  /**
   * 按语法种类（kind）过滤记录。
   *
   * @param kind - 语法种类（如 'code-block', 'table', 'frontmatter' 等）
   */
  byKind(kind: MarkdownSyntaxKind): readonly MarkdownRangeRecord[] {
    return Object.freeze(this.records.filter((record) => record.kind === kind));
  }

  /**
   * 根据唯一 record ID 检索单条记录。
   */
  get(id: string): MarkdownRangeRecord | null {
    return this.#recordsById.get(id) ?? null;
  }
}

/**
 * 触发强制刷新 Markdown 语法树覆盖度的 StateEffect。
 */
export const refreshMarkdownParseCoverageEffect = StateEffect.define<null>();

/**
 * 文档是否为 MDX 模式的 Facet。
 * MDX 模式下大写标签(`<Callout/>`)按组件解析；纯 Markdown 模式下大写标签保持 HTML 路径。
 */
export const mdxModeFacet = Facet.define<boolean, boolean>({
  combine: (values) => values[0] ?? false,
});

/**
 * 语法插件注册中心 Facet，用于向 Range Index 注入自定义节点策略与元数据解析器。
 */
export const syntaxPluginRegistryFacet = Facet.define<SyntaxPluginRegistry, SyntaxPluginRegistry>({
  combine: (values) => values[0] ?? new SyntaxPluginRegistry(),
});

/**
 * CodeMirror StateField：维护当前编辑器状态的 `MarkdownRangeIndex` 单例。
 * 在文档修改或语法树覆盖度刷新时自动更新。
 */
export const markdownRangeIndexField = StateField.define<MarkdownRangeIndex>({
  create(state) {
    const diagnostics = getWysiwygDiagnostics(state);
    diagnostics?.recordFullIndexBuild();
    const tree = ensureSyntaxTree(state, state.doc.length, 5_000) ?? syntaxTree(state);
    return buildMarkdownRangeIndex(state.doc.toString(), tree, {
      coverage: readCoverage(state),
      mdxMode: state.facet(mdxModeFacet),
      pluginRegistry: state.facet(syntaxPluginRegistryFacet),
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
        pluginRegistry: transaction.state.facet(syntaxPluginRegistryFacet),
      });
    }

    return previous;
  },
});

/**
 * 全量或指定区间构建 MarkdownRangeIndex。
 *
 * @param source - Markdown 文档源文本
 * @param tree - Lezer 语法分析树
 * @param options - 构建选项
 * @returns 构造完成的不可变索引对象
 */
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
    options.pluginRegistry,
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
 * 增量更新 MarkdownRangeIndex：
 * 1. 搜集变更区间并扩展旧/新脏区间（dirty ranges）；
 * 2. 复用未变动的历史记录（通过 `mapRecord` 进行偏移调整并验证指纹）；
 * 3. 仅对脏区间进行语法节点重解析并合并。
 */
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
    pluginRegistry: transaction.state.facet(syntaxPluginRegistryFacet),
  });
  const records = [...mapped];
  for (const record of rebuilt.records) {
    insertRecord(records, record);
  }
  getWysiwygDiagnostics(transaction.state)?.recordMappedRanges(mapped.length);
  return new MarkdownRangeIndex(records, coverage, newSource.length, previous.version + 1);
}

/**
 * 计算语法树的解析覆盖深度与完成状态。
 */
function readCoverage(state: EditorState): MarkdownParseCoverage {
  const tree = ensureSyntaxTree(state, state.doc.length, 5_000) ?? syntaxTree(state);
  const to = Math.min(tree.length, state.doc.length);
  return Object.freeze({
    to,
    complete: to >= state.doc.length || syntaxTreeAvailable(state, state.doc.length),
  });
}

/**
 * 递归遍历 AST 语法树节点并匹配策略生成范围记录。
 */
function visitParserNode(
  node: SyntaxNode,
  source: string,
  frontmatter: FrontmatterSourceRange | null,
  coverage: MarkdownParseCoverage,
  includeRanges: readonly SourceRange[] | null,
  blockRange: SourceRange,
  output: MarkdownRangeRecord[],
  mdxElements: readonly MdxJsxElement[],
  pluginRegistry?: SyntaxPluginRegistry,
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
        pluginRegistry,
      );
      if (policy) {
        insertRecord(
          output,
          createParserRecord(child, childBlockRange, source, policy, coverage, pluginRegistry),
        );
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
      pluginRegistry,
    );
  }
}

/**
 * 将匹配到策略的单个语法节点转换为 MarkdownRangeRecord。
 */
function createParserRecord(
  node: SyntaxNode,
  blockRange: SourceRange,
  source: string,
  policy: MarkdownNodePolicy,
  coverage: MarkdownParseCoverage,
  pluginRegistry?: SyntaxPluginRegistry,
): MarkdownRangeRecord {
  const fullRange = nodeRange(node);
  const children = directChildren(node);
  const markerRanges = collectMarkerRanges(node, children, policy);
  const customMetadata = pluginRegistry?.extractMetadata(node.name, node, source, children);
  const directive =
    (customMetadata?.directive as MarkdownDirectiveMetadata | undefined) ?? undefined;
  const alert = policy.kind === "quote" ? resolveAlertMetadata(node, source) : undefined;
  const contentRange =
    pluginRegistry?.resolveContentRange(node.name, node, source, children, markerRanges) ??
    resolveContentRange(node, children, markerRanges, policy, source);
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
    ...(directive ? { directive } : {}),
    ...(alert ? { alert } : {}),
    ...(customMetadata ? { metadata: customMetadata } : {}),
  });
}

/**
 * 增量映射单条记录：检查位置映射后源码文本指纹是否保持一致。
 */
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

/**
 * 搜集编辑事务中所有变更的起止范围对。
 */
function collectChangedRanges(
  transaction: Transaction,
): readonly { readonly oldRange: SourceRange; readonly newRange: SourceRange }[] {
  const ranges: Array<{ oldRange: SourceRange; newRange: SourceRange }> = [];
  transaction.changes.iterChangedRanges((fromA, toA, fromB, toB) => {
    ranges.push({ oldRange: { from: fromA, to: toA }, newRange: { from: fromB, to: toB } });
  });
  return ranges;
}

/**
 * 结合旧文档及旧记录边界扩展旧脏区间。
 */
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

/**
 * 结合新文档及顶层语法块边界扩展新脏区间。
 */
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

/**
 * 提取语法树顶层子节点范围。
 */
function getTopLevelRanges(tree: Tree): readonly SourceRange[] {
  const ranges: SourceRange[] = [];
  for (let child = tree.topNode.firstChild; child; child = child.nextSibling) {
    ranges.push(nodeRange(child));
  }
  return ranges;
}

/**
 * 二分查找定位满足 prefixMaximumEnds[index] >= position 的最小下标。
 */
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
