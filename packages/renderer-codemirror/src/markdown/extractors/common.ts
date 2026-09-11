/**
 * @file common.ts
 * @description Markdown 语法提取公共工具函数库。
 * 提供节点范围提取、子节点遍历、字符与行范围计算、范围映射与碰撞检测、
 * 以及不可变元数据冻结等底层基础设施。
 */

import type { SyntaxNode } from "@lezer/common";
import type { ChangeDesc, Text } from "@codemirror/state";
import type { MarkdownNodePolicy } from "../node-policy.ts";
import {
  fingerprintSource,
  freezeSourceRange,
  sourceRangeContains,
  sourceRangesOverlap,
  type MarkdownCodeBlockLineFingerprint,
  type MarkdownDirectiveMetadata,
  type MarkdownRangeRecord,
  type MarkdownRangeSegmentRole,
  type SourceRange,
} from "../range-types.ts";

/**
 * 提取语法树节点的源码起始闭区间。
 *
 * @param node - Lezer 语法树节点
 * @returns 节点在文档中的字节/字符范围
 */
export function nodeRange(node: SyntaxNode): SourceRange {
  return { from: node.from, to: node.to };
}

/**
 * 获取语法节点的直接子节点列表（扁平数组）。
 *
 * @param node - 父语法节点
 * @returns 直接子节点集合
 */
export function directChildren(node: SyntaxNode): readonly SyntaxNode[] {
  const children: SyntaxNode[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) {
    children.push(child);
  }
  return children;
}

/**
 * 计算给定区间在文档中的行范围（从该行首字符到该行末字符）。
 *
 * @param source - 完整源文档字符串
 * @param range - 目标区间
 * @returns 扩展到行首和行末的整行 SourceRange
 */
export function lineRangeForSource(source: string, range: SourceRange): SourceRange {
  const from = source.lastIndexOf("\n", Math.max(0, range.from - 1)) + 1;
  const newline = source.indexOf("\n", range.to);
  return { from, to: newline === -1 ? source.length : newline };
}

/**
 * 根据 CodeMirror Text 模型计算给定区间所跨越的整行范围。
 *
 * @param document - CodeMirror Text 文本对象
 * @param range - 目标区间
 * @returns 起始行首至结束行末的范围
 */
export function lineRangeForDocument(document: Text, range: SourceRange): SourceRange {
  const fromPosition = Math.min(range.from, document.length);
  const toPosition = Math.min(Math.max(range.from, range.to), document.length);
  return {
    from: document.lineAt(fromPosition).from,
    to: document.lineAt(toPosition).to,
  };
}

/**
 * 跳过连续的水平空白字符（空格与制表符）。
 *
 * @param source - 源码文本
 * @param from - 起始扫描偏移量
 * @param to - 上限偏移量
 * @returns 首个非空白字符位置，或达到 to 时的位置
 */
export function skipHorizontalSpace(source: string, from: number, to: number): number {
  let position = from;
  while (position < to && (source[position] === " " || source[position] === "\t")) {
    position += 1;
  }
  return position;
}

/**
 * 判断字符是否属于水平空白（空格或制表符）。
 */
export function isHorizontalSpace(character: string): boolean {
  return character === " " || character === "\t";
}

/**
 * 向前剥离连续的换行符（CR / LF）。
 *
 * @param source - 源码字符串
 * @param from - 截断起始位置
 * @param minimum - 截断不能小于的最小边界
 * @returns 剥离尾部换行后的位置
 */
export function trimTrailingLineBreak(source: string, from: number, minimum: number): number {
  let position = from;
  while (position > minimum && (source[position - 1] === "\n" || source[position - 1] === "\r")) {
    position -= 1;
  }
  return position;
}

/**
 * 判断两个区间是否相交或边界接触（含端点重合）。
 */
export function rangesTouch(left: SourceRange, right: SourceRange): boolean {
  if (left.from === left.to) {
    return sourceRangeContains(right, left.from);
  }
  if (right.from === right.to) {
    return sourceRangeContains(left, right.from);
  }
  return sourceRangesOverlap(left, right);
}

/**
 * 判断目标区间是否与候选区间集中的任意一个发生触碰。
 */
export function touchesAny(range: SourceRange, candidates: readonly SourceRange[]): boolean {
  return candidates.some((candidate) => rangesTouch(range, candidate));
}

/**
 * 计算包含两个区间的最小凸外包区间（Union）。
 */
export function unionRanges(left: SourceRange, right: SourceRange): SourceRange {
  return { from: Math.min(left.from, right.from), to: Math.max(left.to, right.to) };
}

/**
 * 应用 CodeMirror ChangeDesc 映射区间。若区间被完全折叠或退化为无效顺序则返回 null。
 */
export function mapRange(range: SourceRange, changes: ChangeDesc): SourceRange | null {
  const from = changes.mapPos(range.from, 1);
  const to = changes.mapPos(range.to, -1);
  return from <= to ? { from, to } : null;
}

/**
 * 映射可选区间，返回映射后的区间或 null（若输入为 null）；若映射失效返回 undefined。
 */
export function mapOptionalRange(
  range: SourceRange | null,
  changes: ChangeDesc,
): SourceRange | null | undefined {
  return range ? (mapRange(range, changes) ?? undefined) : null;
}

/**
 * 计算多个子区间的包络范围（从第一个区间的 from 到最后一个区间的 to）。
 */
export function envelopeRange(ranges: readonly SourceRange[]): SourceRange | null {
  if (ranges.length === 0) {
    return null;
  }
  return { from: ranges[0].from, to: ranges.at(-1)?.to ?? ranges[0].to };
}

/**
 * 逐行计算目标区间内各行的文本指纹，用于细粒度行变更诊断与增量复用校验。
 */
export function fingerprintSourceLines(
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

/**
 * 解析链接或图像语法节点的元数据角色。
 */
export function metadataRole(nodeName: string): MarkdownRangeSegmentRole | null {
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

/**
 * 根据节点的标记节点提取 marker 区间列表。
 * 特别处理引用块（Blockquote），将嵌套列表中跨行的 QuoteMark 正确归属到就近引用块。
 */
export function collectMarkerRanges(
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

/**
 * 根据节点的策略策略（contentStrategy）计算内容区间。
 */
export function resolveContentRange(
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
  return null;
}

/**
 * 冻结指令（Directive）自定义元数据。
 */
export function freezeDirectiveMetadata(
  metadata: MarkdownDirectiveMetadata,
): MarkdownDirectiveMetadata {
  return Object.freeze({
    ...metadata,
    openingMarkerRange: freezeSourceRange(metadata.openingMarkerRange),
    closingMarkerRange: metadata.closingMarkerRange
      ? freezeSourceRange(metadata.closingMarkerRange)
      : null,
    headerRange: freezeSourceRange(metadata.headerRange),
  });
}

/**
 * 深度冻结记录对象，确保不可变性。
 */
export function freezeRecord(record: MarkdownRangeRecord): MarkdownRangeRecord {
  return Object.freeze({
    ...record,
    fullRange: freezeSourceRange(record.fullRange),
    lineRange: freezeSourceRange(record.lineRange),
    blockRange: freezeSourceRange(record.blockRange),
    contentRange: record.contentRange ? freezeSourceRange(record.contentRange) : null,
    markerRanges: Object.freeze(record.markerRanges.map(freezeSourceRange)),
    segments: Object.freeze(record.segments.map((segment) => Object.freeze({ ...segment }))),
    ...(record.directive ? { directive: freezeDirectiveMetadata(record.directive) } : {}),
    ...(record.metadata ? { metadata: Object.freeze({ ...record.metadata }) } : {}),
  });
}

/**
 * 将记录有序插入记录列表中，排序规则：
 * 1. 起始位置升序
 * 2. 结束位置降序（外层包含内层优先）
 * 3. 优先级降序
 * 4. ID 字典序稳定保序
 */
export function insertRecord(records: MarkdownRangeRecord[], record: MarkdownRangeRecord): void {
  let index = 0;
  while (index < records.length && compareRecords(records[index], record) <= 0) {
    index += 1;
  }
  records.splice(index, 0, record);
}

/**
 * 记录比较函数，定义 RangeIndex 记录的标准先后顺序。
 */
export function compareRecords(left: MarkdownRangeRecord, right: MarkdownRangeRecord): number {
  return (
    left.fullRange.from - right.fullRange.from ||
    right.fullRange.to - left.fullRange.to ||
    right.priority - left.priority ||
    left.id.localeCompare(right.id)
  );
}

/**
 * 将连续或重叠的区间集进行合并。
 */
export function mergeRanges(ranges: readonly SourceRange[]): SourceRange[] {
  const merged: SourceRange[] = [];
  for (const range of ranges) {
    insertMergedRange(merged, range);
  }
  return merged;
}

/**
 * 将新区间插入已合并排序的区间列表中，自动合并重叠与邻接区间。
 */
export function insertMergedRange(ranges: SourceRange[], incoming: SourceRange): void {
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
