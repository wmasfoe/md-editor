/**
 * @file code-block.ts
 * @description Markdown 代码块（围栏式 FencedCode 与缩进式 IndentedCode）元数据提取器。
 * 负责提取语言标记、围栏闭合状态、缩进区域、行指纹及事务增量映射。
 */

import type { SyntaxNode } from "@lezer/common";
import type { ChangeDesc } from "@codemirror/state";
import { findCodeBlockLanguage } from "../code-languages.ts";
import {
  fingerprintSource,
  freezeSourceRange,
  type MarkdownCodeBlockFenceStyle,
  type MarkdownCodeBlockLineFingerprint,
  type MarkdownCodeBlockMetadata,
  type MarkdownCodeBlockStatus,
  type SourceRange,
} from "../range-types.ts";
import {
  envelopeRange,
  fingerprintSourceLines,
  isHorizontalSpace,
  lineRangeForSource,
  mapOptionalRange,
  mapRange,
  nodeRange,
} from "./common.ts";

/**
 * 统筹构建代码块元数据（自动分流围栏代码块与缩进代码块）。
 *
 * @param node - Lezer 语法节点 (FencedCode | CodeBlock)
 * @param children - 子节点列表
 * @param source - 完整源文档字符串
 * @param parserCoverage - 当前解析覆盖状态
 */
export function createCodeBlockMetadata(
  node: SyntaxNode,
  children: readonly SyntaxNode[],
  source: string,
  parserCoverage: "complete" | "partial",
): MarkdownCodeBlockMetadata {
  return node.name === "FencedCode"
    ? createFencedCodeBlockMetadata(node, children, source, parserCoverage)
    : createIndentedCodeBlockMetadata(node, children, source, parserCoverage);
}

/**
 * 构建围栏式代码块（``` 或 ~~~）的详细元数据。
 */
export function createFencedCodeBlockMetadata(
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

/**
 * 构建缩进式代码块（4空格或制表符缩进）的详细元数据。
 */
export function createIndentedCodeBlockMetadata(
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

/**
 * 从 CodeInfo 字符串中分离首个语言标识 token 和后续的元信息后缀（如属性或参数）。
 */
export function deriveLanguageInfoRanges(
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

/**
 * 收集缩进代码块每行的缩进前缀范围（4空格或制表符）。
 */
export function collectIndentedSyntaxRanges(
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

/**
 * 结合语法树覆盖度判断代码块的终态。
 */
export function resolveCodeBlockStatus(
  parserCoverage: "complete" | "partial",
  stableStatus: Exclude<MarkdownCodeBlockStatus, "partial">,
): MarkdownCodeBlockStatus {
  return parserCoverage === "partial" ? "partial" : stableStatus;
}

/**
 * 校验围栏标记的语法正确性与配对情况。
 */
export function validateFencedCodeBlockMarks(
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

/**
 * 获取围栏风格（反引号或波浪号）。
 */
export function fenceStyleFor(mark: string): MarkdownCodeBlockFenceStyle {
  if (mark.startsWith("`")) {
    return "backtick";
  }
  if (mark.startsWith("~")) {
    return "tilde";
  }
  return "none";
}

/**
 * 深度冻结代码块元数据对象。
 */
export function freezeCodeBlockMetadata(
  metadata: MarkdownCodeBlockMetadata,
): MarkdownCodeBlockMetadata {
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

/**
 * 在文档编辑事务中映射代码块元数据范围；若发生指纹不匹配或结构破坏则返回 null。
 */
export function mapCodeBlockMetadata(
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
