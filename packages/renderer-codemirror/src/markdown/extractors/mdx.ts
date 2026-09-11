/**
 * @file mdx.ts
 * @description MDX JSX 元素收集与范围索引记录创建器。
 * 支持预筛选、脏区间交集优化、自定义属性与子节点提取。
 */

import {
  fingerprintSource,
  freezeSourceRange,
  sourceRangesOverlap,
  type MarkdownMdxBlockMetadata,
  type MarkdownParseCoverage,
  type MarkdownRangeRecord,
  type MarkdownRangeSegment,
  type SourceRange,
} from "../range-types.ts";
import { parseMdxJsxElements, type MdxJsxElement } from "../mdx-parse.ts";
import { freezeRecord, lineRangeForSource } from "./common.ts";

/**
 * 收集 MDX 组件元素。预筛 `<[A-Z]`(纯文本/普通文档零开销,安全评审
 * §3.2 允许 isLikelyMdxBlock 类预筛);includeRanges 存在时只保留
 * 与 dirty 区间相交的元素,支持增量重建。
 *
 * @param source - Markdown/MDX 源码
 * @param includeRanges - 增量构建的脏区间过滤列表（若为 null 则全量收集）
 */
export function collectMdxElements(
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

/**
 * 为单个 MdxJsxElement 创建对应的 MarkdownRangeRecord 记录。
 *
 * @param element - 解析得到的 MDX JSX 元素
 * @param source - 全量源码
 * @param coverage - 解析覆盖状态
 */
export function createMdxRecord(
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
