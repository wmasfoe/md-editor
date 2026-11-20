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
import { getMarkdownNodePolicy } from "./node-policy.ts";
import { SyntaxPluginRegistry } from "../plugins/syntax-registry.ts";
import type {
  MarkdownNodePolicy,
  MarkdownParseCoverage,
  MarkdownDirectiveMetadata,
  MarkdownGraphicalCodeBlockMetadata,
  MarkdownRangeRecord,
  MarkdownRangeSegment,
  MarkdownSyntaxKind,
  SourceRange,
} from "@md-editor/plugin-sdk/syntax";
import { fingerprintSource, sourceRangeContains, sourceRangesOverlap } from "./range-types.ts";
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
import { projectCoverage } from "./coverage.ts";
import { mergeSortedRecords } from "./record-merge.ts";
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
   * 闭区间“触及”查询：检索与 `[from, to]` **闭区间**相交或相邻的一切记录。
   *
   * 与 `overlapping()` 的差别（二者语义必须并存，不得合并）：
   * - `overlapping()` 对范围查询用**严格重叠**（`sourceRangesOverlap`），并在
   *   `record.fullRange.from >= to` 处提前 break——这是**全局激活契约**（atomic /
   *   protected ranges / link reveal 共用），一字不得改。
   * - `touching()` 用**闭区间**（`record.fullRange.from <= to && record.fullRange.to >= from`），
   *   使“光标/选区紧贴记录首尾外侧”也命中，专供四类内置行内标记的**源码显形**判定。
   * - 折叠光标下两者等价（都退化为 `sourceRangeContains`），差别只在范围选区贴边。
   *
   * 仅与 `overlapping()` 共享候选定位 helper `findFirstCandidate`（`prefixMaximumEnds`
   * 保证所有可能触及的候选都在该下标之后），循环体各自独立，以免一处修改影响两处。
   */
  touching(from: number, to: number): readonly MarkdownRangeRecord[] {
    const records: MarkdownRangeRecord[] = [];
    const firstCandidate = findFirstCandidate(this.#prefixMaximumEnds, from);
    for (let index = firstCandidate; index < this.records.length; index += 1) {
      const record = this.records[index];
      // 闭区间：记录起点超过查询终点才可能越过，此处不含 `>=` 提前 break。
      if (record.fullRange.from > to) {
        break;
      }
      if (record.fullRange.to >= from) {
        records.push(record);
      }
    }
    return Object.freeze(records);
  }

  /**
   * 按语法种类（kind）过滤记录。
   *
   * @param kind - 语法种类（如 'code-block'、'table'、'frontmatter' 等）
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
      // 覆盖度必须由**这棵** tree 推导（不能回头读 syntaxTree 快照，见下方注释）。
      coverage: coverageOfTree(tree, state.doc.length),
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
        coverage: coverageOfTree(tree, transaction.state.doc.length),
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
  // Keep ordinary typing incremental. CodeMirror parses the changed viewport as needed,
  // while table and MDX edits need the complete tree to preserve structural boundaries.
  if (requiresCompleteParse(transaction, previous)) {
    ensureSyntaxTree(transaction.state, transaction.state.doc.length, 5_000);
  }
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

  // 复用未受影响的记录。
  //
  // ⚠️ 这里必须 `push` 而不是 `insertRecord`：`insertRecord` 是线性插入排序
  // （`while (index < records.length && compareRecords(...) <= 0) index++`），
  // 对 n 条记录逐条插入是 O(n²)。实测 3999 条记录时，仅 `insertRecord` +
  // `compareRecords` 就占每次按键 48ms 中的 **74%**（CPU profile），是本文件最大的热点。
  //
  // 可以安全追加的前提：`previous.records` 本身已按 `compareRecords` 全序排列
  // （`MarkdownRangeIndex` 的构造不变量），且 `mapRecord` 保持相对顺序不变
  // （单调映射 + 单点插入不会让两条记录的先后关系反转）。
  const mapped: MarkdownRangeRecord[] = [];
  for (const record of previous.records) {
    if (record.kind === "frontmatter" || touchesAny(record.blockRange, oldDirty)) {
      continue;
    }
    const nextRecord = mapRecord(record, transaction.changes, newSource);
    if (nextRecord && !touchesAny(nextRecord.blockRange, newDirty)) {
      mapped.push(nextRecord);
    }
  }

  const coverage = projectCoverage(previous.coverage, newSource.length);
  const rebuilt = buildMarkdownRangeIndex(newSource, tree, {
    coverage,
    version: previous.version + 1,
    includeRanges: newDirty,
    mdxMode: transaction.state.facet(mdxModeFacet),
    pluginRegistry: transaction.state.facet(syntaxPluginRegistryFacet),
  });
  // 两段都已按 `compareRecords` 有序，做一次线性归并而不是逐条插入排序。
  const records = mergeSortedRecords(mapped, rebuilt.records);
  getWysiwygDiagnostics(transaction.state)?.recordMappedRanges(mapped.length);
  return new MarkdownRangeIndex(records, coverage, newSource.length, previous.version + 1);
}

function requiresCompleteParse(transaction: Transaction, previous: MarkdownRangeIndex): boolean {
  if (transaction.state.facet(mdxModeFacet)) return true;
  // The partial index cannot prove that a newly created block outside parser coverage is
  // absent. Recover complete coverage before applying structural edits to a partial index.
  if (!previous.coverage.complete) return true;
  let touchesTable = false;
  // `previous` 是旧文档的索引，只能用旧坐标（`fromA`/`toA`）查。
  // 用新坐标 `fromB`/`toB` 查旧索引会坐标系错配（漏判或误判）。
  transaction.changes.iterChangedRanges((fromA, toA) => {
    if (previous.overlapping(fromA, toA).some((record) => record.kind === "table")) {
      touchesTable = true;
    }
  });
  return touchesTable;
}

/**
 * 从**已存在**的语法树读取解析覆盖深度（不做任何解析工作）。
 *
 * 为什么不在这里 `ensureSyntaxTree`：该函数会被增量更新路径（每次按键）调用，
 * 而 `ensureSyntaxTree` 是**同步阻塞**的全文档解析 —— 实测 8000 行文档每次 20-77ms，
 * 直接把打字卡成幻灯片（远超 16ms 帧预算）。
 *
 * 增量编辑后 CM 复用未变动的子树，`syntaxTree(state)` 通常已覆盖全文
 * （取用约 0.001ms）。需要「确保完整解析」的场景（MDX / 结构编辑 / 覆盖度不足）
 * 由 `requiresCompleteParse` 在更新前显式调用 `ensureSyntaxTree`：
 * **解析决策归 `requiresCompleteParse`，覆盖度测量归本函数**。
 */
function readCoverage(state: EditorState): MarkdownParseCoverage {
  const tree = syntaxTree(state);
  const to = Math.min(tree.length, state.doc.length);
  return Object.freeze({
    to,
    complete: to >= state.doc.length || syntaxTreeAvailable(state, state.doc.length),
  });
}

/**
 * 由**权威语法树**推导覆盖度（纯函数，不做任何解析）。
 *
 * `tree` 必须是调用方实际拿去 `buildMarkdownRangeIndex` 的那一棵 ——
 * 通常是 `ensureSyntaxTree(...)` 的**返回值**。
 *
 * ## 绝不能在 `ensureSyntaxTree` 之后回头读 `syntaxTree(state)`
 *
 * 语法树有两个**不同步**的视图：`syntaxTree(state)` 是 `EditorState.update` 期间由
 * `takeTree()` 截下的**快照**；`ensureSyntaxTree` 只推进会 `LanguageState.context`
 * 并返回新树，**不更新**快照；`syntaxTreeAvailable` 读的则是已推进的 context。
 *
 * 混用两者的后果：`LanguageState` 初始化只解析 `Work.InitViewport`（约 3000 字符），
 * 大文档首次建索引会得到 `{ to: ~3000, complete: true }`，其后记录全被误判为
 * `parserCoverage: "partial"`，标题/表格/代码块/列表投影集体退化为源码
 * （实测 6379 字符、200 标题 → `coverage.to = 3017`，102 个标题 partial）。
 *
 * 本函数只接受树本身，从签名上杜绝这种混用。
 */
function coverageOfTree(tree: Tree, documentLength: number): MarkdownParseCoverage {
  const to = Math.min(tree.length, documentLength);
  return Object.freeze({ to, complete: to >= documentLength });
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
    if (child.name === "HTMLBlock" || child.name === "HTMLTag" || child.name === "CommentBlock") {
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
  const graphicalCodeBlock =
    (customMetadata?.graphicalCodeBlock as MarkdownGraphicalCodeBlockMetadata | undefined) ??
    undefined;
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
    ...(graphicalCodeBlock ? { graphicalCodeBlock } : {}),
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
  const graphicalCodeBlock = record.graphicalCodeBlock
    ? mapGraphicalCodeBlockMetadata(record.graphicalCodeBlock, changes)
    : undefined;
  const tableBlock = record.tableBlock
    ? mapTableBlockMetadata(record.tableBlock, changes, newSource)
    : undefined;
  if (
    (record.contentRange && !contentRange) ||
    markerRanges.some((range) => !range) ||
    segments.some((segment) => !segment) ||
    (record.codeBlock && !codeBlock) ||
    (record.graphicalCodeBlock && !graphicalCodeBlock) ||
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
    ...(graphicalCodeBlock ? { graphicalCodeBlock } : {}),
    ...(tableBlock ? { tableBlock } : {}),
  });
}

function mapGraphicalCodeBlockMetadata(
  metadata: MarkdownGraphicalCodeBlockMetadata,
  changes: ChangeDesc,
): MarkdownGraphicalCodeBlockMetadata | null {
  const bodyRange = mapRange(metadata.bodyRange, changes);
  const openingFenceRange = mapRange(metadata.openingFenceRange, changes);
  const closingFenceRange = metadata.closingFenceRange
    ? mapRange(metadata.closingFenceRange, changes)
    : null;
  if (!bodyRange || !openingFenceRange || (metadata.closingFenceRange && !closingFenceRange))
    return null;
  return { ...metadata, bodyRange, openingFenceRange, closingFenceRange };
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
 *
 * ## 为什么必须二分而不是线性扫描
 *
 * 本函数在**每次按键**的增量更新路径上被调用（见 `updateMarkdownRangeIndex`）。
 * 历史实现遍历全部 `records` 并对每个记录做 `rangesTouch` —— 4000 条记录时单次
 * 按键即 ~55ms（实测），打字直接掉帧。
 *
 * 但“扩展”会**迭代放大**查询区间：某个记录被并入后 `expanded` 变宽，可能再触及
 * 邻居记录。因此不能只查一次：每轮用二分定位首个候选（`blockRange.from` 有序），
 * 向后扫描到 `blockRange.from > expanded.to` 即停，直到区间不再增长。
 *
 * 记录按 `blockRange.from` 升序排列（`insertRecord` 保证），故用
 * `findFirstCandidate` 对前缀最大值数组做 O(log N) 定位。
 */
function expandOldDirtyRange(
  document: Text,
  changed: SourceRange,
  records: readonly MarkdownRangeRecord[],
): SourceRange {
  let expanded = lineRangeForDocument(document, changed);
  if (records.length === 0) {
    return expanded;
  }
  // 记录数组按 blockRange.from 升序；用其终点前缀最大值做二分候选定位。
  const prefixMaximumEnds: number[] = [];
  let maximumEnd = -1;
  for (const record of records) {
    maximumEnd = Math.max(maximumEnd, record.blockRange.to);
    prefixMaximumEnds.push(maximumEnd);
  }

  let previousFrom = expanded.from;
  let previousTo = expanded.to;
  for (;;) {
    const firstCandidate = findFirstCandidate(prefixMaximumEnds, expanded.from);
    for (let index = firstCandidate; index < records.length; index += 1) {
      const blockRange = records[index].blockRange;
      // 起点已越过当前区间终点：后续记录的起点只会更大，不可能再触及。
      if (blockRange.from > expanded.to) {
        break;
      }
      if (rangesTouch(blockRange, expanded)) {
        expanded = unionRanges(expanded, blockRange);
      }
    }
    if (expanded.from === previousFrom && expanded.to === previousTo) {
      return expanded;
    }
    previousFrom = expanded.from;
    previousTo = expanded.to;
  }
}

/**
 * 结合新文档及顶层语法块边界扩展新脏区间。
 *
 * 与 {@link expandOldDirtyRange} 同构：顶层节点数量可达数千（每个段落/列表各一个），
 * 线性扫描同样是每次按键的 O(n) 成本。顶层范围天然按起点升序，同样用二分定位候选。
 */
function expandNewDirtyRange(
  document: Text,
  changed: SourceRange,
  topLevelRanges: readonly SourceRange[],
): SourceRange {
  let expanded = lineRangeForDocument(document, changed);
  if (topLevelRanges.length === 0) {
    return expanded;
  }
  const prefixMaximumEnds: number[] = [];
  let maximumEnd = -1;
  for (const topLevel of topLevelRanges) {
    maximumEnd = Math.max(maximumEnd, topLevel.to);
    prefixMaximumEnds.push(maximumEnd);
  }

  let previousFrom = expanded.from;
  let previousTo = expanded.to;
  for (;;) {
    const firstCandidate = findFirstCandidate(prefixMaximumEnds, expanded.from);
    for (let index = firstCandidate; index < topLevelRanges.length; index += 1) {
      const topLevel = topLevelRanges[index];
      if (topLevel.from > expanded.to) {
        break;
      }
      if (rangesTouch(topLevel, expanded)) {
        expanded = unionRanges(expanded, topLevel);
      }
    }
    if (expanded.from === previousFrom && expanded.to === previousTo) {
      return expanded;
    }
    previousFrom = expanded.from;
    previousTo = expanded.to;
  }
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
