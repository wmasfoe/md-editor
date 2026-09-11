/**
 * @file table.ts
 * @description GFM 表格（Table）结构元数据提取器。
 * 负责提取表头、分隔行、数据行、各列对齐方式、管道符特征、行指纹及编辑映射。
 */

import type { SyntaxNode } from "@lezer/common";
import type { ChangeDesc } from "@codemirror/state";
import {
  fingerprintSource,
  freezeSourceRange,
  type MarkdownCodeBlockLineFingerprint,
  type MarkdownTableBlockMetadata,
  type MarkdownTableCellAlignment,
  type SourceRange,
} from "../range-types.ts";
import {
  fingerprintSourceLines,
  lineRangeForSource,
  mapOptionalRange,
  mapRange,
  nodeRange,
} from "./common.ts";

/**
 * 构建 Markdown 表格的完整元数据。
 *
 * @param node - Lezer Table 语法节点
 * @param children - 子节点列表
 * @param source - 完整源文档文本
 */
export function createTableBlockMetadata(
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

/**
 * 从分隔行源码推导每一列的文本对齐模式。
 */
export function deriveTableColumnAlignments(
  source: string,
  delimiterRange: SourceRange,
): readonly MarkdownTableCellAlignment[] {
  const line = source.slice(delimiterRange.from, delimiterRange.to);
  const cellTexts = splitTableDelimiterLine(line);
  return cellTexts.map((cell) => classifyTableAlignment(cell));
}

/**
 * 分割表格分隔行，剔除首尾管道符并拆分单元格。
 */
export function splitTableDelimiterLine(line: string): readonly string[] {
  // Drop leading/trailing pipes if present, then split on remaining pipes.
  const trimmed = line.replace(/^\s*\|/, "").replace(/\|\s*$/, "");
  if (!trimmed.trim()) {
    return [];
  }
  return trimmed.split("|").map((cell) => cell.trim());
}

/**
 * 根据分隔单元格中的冒号规则判断对齐方式。
 * `:---:` -> center, `---:` -> right, `:---` -> left, `---` -> none
 */
export function classifyTableAlignment(cell: string): MarkdownTableCellAlignment {
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

/**
 * 判断表格是否以管道符 `|` 开始。
 */
export function hasLeadingPipe(
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

/**
 * 深度冻结表格元数据对象。
 */
export function freezeTableBlockMetadata(
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

/**
 * 在文档编辑事务中增量映射表格元数据；若范围破坏或指纹不符则返回 null。
 */
export function mapTableBlockMetadata(
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
