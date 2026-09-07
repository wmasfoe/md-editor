import type { SyntaxNode } from "@lezer/common";
import {
  type MarkdownNodePolicy,
  type MarkdownSyntaxKind,
  type MarkdownSyntaxPlugin,
} from "@md-editor/renderer-codemirror";
import { highlightMarkdownExtension } from "./highlight-parser.ts";
import { HIGHLIGHT_NODES } from "./highlight-types.ts";

export { HIGHLIGHT_NODES, type HighlightMetadata } from "./highlight-types.ts";
export { highlightMarkdownExtension } from "./highlight-parser.ts";

/**
 * 官方高亮扩展插件（Highlight Syntax Plugin）。
 * 遵循增量降级与架构解耦契约：
 * - 未加载该插件时，编辑器保持标准 CommonMark 纯文本呈现，零报错；
 * - 启用该插件时，动态增强为 ==高亮== 所见即所得渲染，与 toggleHighlight 及 Mod-Shift-h 快捷键天然闭环。
 */
export const highlightPlugin: MarkdownSyntaxPlugin = Object.freeze({
  id: "markdown.highlight",
  name: "文本高亮",
  markdownExtension: highlightMarkdownExtension,
  nodePolicies: Object.freeze({
    [HIGHLIGHT_NODES.Highlight]: Object.freeze({
      kind: "highlight" as MarkdownSyntaxKind,
      renderPolicy: "inline-visible-markers",
      editPolicy: "native",
      interactionPolicy: "text",
      priority: 42,
      markerNodeNames: Object.freeze([HIGHLIGHT_NODES.HighlightMark]),
      contentStrategy: "between-markers",
    }) as MarkdownNodePolicy,
  }),
  extractMetadata(
    node: SyntaxNode,
    source: string,
    children: readonly SyntaxNode[],
  ): Record<string, unknown> | undefined {
    const marks = children.filter((c) => c.name === HIGHLIGHT_NODES.HighlightMark);
    const openMarker = marks[0];
    const closeMarker = marks.length > 1 ? marks[marks.length - 1] : null;

    const contentFrom = openMarker ? openMarker.to : node.from;
    const contentTo = closeMarker ? closeMarker.from : node.to;
    const text = source.slice(contentFrom, contentTo);

    return {
      text,
      openingMarkerRange: openMarker ? { from: openMarker.from, to: openMarker.to } : null,
      closingMarkerRange: closeMarker ? { from: closeMarker.from, to: closeMarker.to } : null,
      contentRange: { from: contentFrom, to: contentTo },
    };
  },
});
