/**
 * @file frontmatter.ts
 * @description YAML Frontmatter 元数据记录生成与脏区间优先级扩展算法。
 * 确保文档头部的 Frontmatter 优先完整构建并正确映射。
 */

import {
  findFrontmatterSourceRange,
  type FrontmatterSourceRange,
} from "@md-editor/markdown-fidelity";
import {
  fingerprintSource,
  type MarkdownParseCoverage,
  type MarkdownRangeRecord,
  type MarkdownRangeSegment,
  type SourceRange,
} from "../range-types.ts";
import { freezeRecord, insertMergedRange, lineRangeForSource, rangesTouch } from "./common.ts";

/**
 * 根据文档头部解析到的 Frontmatter 范围创建结构化 MarkdownRangeRecord。
 *
 * @param frontmatter - Frontmatter 源码范围对象
 * @param source - Markdown 全量源码
 * @param coverage - 解析覆盖状态
 */
export function createFrontmatterRecord(
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

/**
 * 当编辑操作触碰文档头部优先级边界或 Frontmatter 状态发生变更时，
 * 扩展旧与新脏区间（dirty ranges）以强制重建 Frontmatter 记录。
 */
export function expandFrontmatterPriorityRanges(
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
