/**
 * @file alert.ts
 * @description GitHub Flavored Markdown (GFM) 警示块（Alert/Callout）语法提取器。
 * 支持提取 `> [!NOTE]`、`> [!WARNING]`、`> [!TIP]`、`> [!IMPORTANT]`、`> [!CAUTION]`
 * 及其自定义标题、标记范围与头部行范围。
 */

import type { SyntaxNode } from "@lezer/common";
import { defaultCalloutTitle } from "../../wysiwyg/callout-widget.ts";
import type { MarkdownAlertMetadata, MarkdownAlertType, SourceRange } from "../range-types.ts";

/**
 * GFM 规范 Alert 首行正规匹配表达式。
 * 格式：`> [!TYPE] Title`
 */
export const GFM_ALERT_REGEX =
  /^\s*>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\](?:\s+([^\r\n]*))?/i;

/**
 * 从引用块语法节点（Blockquote）中解析 GFM Alert/Callout 元数据。
 *
 * @param node - Lezer Blockquote 语法节点
 * @param source - 完整 Markdown 源文本
 * @returns 若匹配 Alert 语法则返回结构化元数据，否则返回 undefined
 */
export function resolveAlertMetadata(
  node: SyntaxNode,
  source: string,
): MarkdownAlertMetadata | undefined {
  const firstLineEnd = source.indexOf("\n", node.from);
  let lineEnd = firstLineEnd === -1 ? node.to : Math.min(firstLineEnd, node.to);
  if (lineEnd > node.from && source.charCodeAt(lineEnd - 1) === 13) {
    lineEnd -= 1;
  }
  const lineText = source.slice(node.from, lineEnd);

  const match = GFM_ALERT_REGEX.exec(lineText);
  if (!match) {
    return undefined;
  }

  const rawType = match[1].toLowerCase() as MarkdownAlertType;
  const rawTitle = match[2]?.trim() ?? "";
  const title = rawTitle.length > 0 ? rawTitle : defaultCalloutTitle(rawType);

  const markerIndex = lineText.indexOf("[!");
  const markerEndIndex = lineText.indexOf("]", markerIndex);
  if (markerIndex === -1 || markerEndIndex === -1) {
    return undefined;
  }

  const markerRange: SourceRange = {
    from: node.from + markerIndex,
    to: node.from + markerEndIndex + 1,
  };

  const headerLineRange: SourceRange = {
    from: node.from,
    to: lineEnd,
  };

  return {
    alertType: rawType,
    title,
    markerRange,
    headerLineRange,
  };
}
