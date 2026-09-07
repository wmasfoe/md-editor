import type { SyntaxNode } from "@lezer/common";
import {
  type MarkdownNodePolicy,
  type MarkdownSyntaxKind,
  type MarkdownSyntaxPlugin,
  type SourceRange,
} from "@md-editor/renderer-codemirror";
import { mathMarkdownExtension } from "./math-parser.ts";
import { buildMathLayoutDecorations } from "./math-projection.ts";
import { MATH_NODES, type MathMetadata } from "./math-types.ts";

export { MATH_NODES, type MathMetadata, type MathKind } from "./math-types.ts";
export { mathMarkdownExtension } from "./math-parser.ts";
export {
  buildMathLayoutDecorations,
  MathInlineWidget,
  MathBlockWidget,
} from "./math-projection.ts";
export { loadKatex, getLoadedKatex, renderMathHtml } from "./math-loader.ts";

/**
 * 官方 LaTeX 数学公式扩展插件（Math Syntax Plugin）。
 * 遵循增量降级与架构解耦契约：
 * - 未加载该插件时，编辑器保持标准 CommonMark 纯文本呈现，零报错；
 * - 启用该插件时，动态增强为 KaTeX 极速排版公式，支持 Typora 式原位就地编辑。
 */
export const mathPlugin: MarkdownSyntaxPlugin = Object.freeze({
  id: "markdown.math",
  name: "LaTeX Math",
  markdownExtension: mathMarkdownExtension,
  nodePolicies: Object.freeze({
    [MATH_NODES.InlineMath]: Object.freeze({
      kind: "inline-math" as MarkdownSyntaxKind,
      renderPolicy: "inline-visible-markers",
      editPolicy: "native",
      interactionPolicy: "active-line",
      priority: 30,
      markerNodeNames: Object.freeze([MATH_NODES.MathMark]),
      contentStrategy: "between-markers",
    }) as MarkdownNodePolicy,
    [MATH_NODES.BlockMath]: Object.freeze({
      kind: "block-math" as MarkdownSyntaxKind,
      renderPolicy: "directive-panel",
      editPolicy: "structured",
      interactionPolicy: "structured-block",
      priority: 30,
      markerNodeNames: Object.freeze([MATH_NODES.MathMark]),
      contentStrategy: "between-markers",
    }) as MarkdownNodePolicy,
  }),
  extractMetadata(
    node: SyntaxNode,
    source: string,
    children: readonly SyntaxNode[],
  ): Record<string, unknown> {
    const isInline = node.name === MATH_NODES.InlineMath;
    const markers = children.filter((c) => c.name === MATH_NODES.MathMark);
    const openMarker = markers[0];
    const closeMarker = markers.length > 1 ? markers[markers.length - 1] : null;

    let contentFrom = openMarker ? openMarker.to : node.from;
    const isFenced =
      openMarker &&
      (source.slice(openMarker.from, openMarker.to).startsWith("`") ||
        source.slice(openMarker.from, openMarker.to).startsWith("~"));
    if (isFenced) {
      const nextNewline = source.indexOf("\n", openMarker.to);
      contentFrom = nextNewline === -1 ? openMarker.to : nextNewline + 1;
    }
    const contentTo = closeMarker ? closeMarker.from : node.to;
    let rawExpression = source.slice(contentFrom, contentTo);

    if (!isInline) {
      let quoteDepth = 0;
      let curr: SyntaxNode | null = node.parent;
      while (curr) {
        if (curr.name === "Blockquote") {
          quoteDepth++;
        }
        curr = curr.parent;
      }

      // 计算围栏行首的结构缩进（如在列表项内），遵循 CommonMark 4.5 规范：内容行剥离至多与开围栏行相同的缩进空格数
      const prevNl = source.lastIndexOf("\n", node.from);
      const lineStart = prevNl === -1 ? 0 : prevNl + 1;
      const leadingOnLine = source.slice(lineStart, node.from);
      const leadingWithoutQuotes = leadingOnLine.replace(/^[ \t]*(>[ \t]?)+/, "");
      const fenceIndent = leadingWithoutQuotes.length;

      if (quoteDepth > 0 || fenceIndent > 0) {
        const indentRegex = fenceIndent > 0 ? new RegExp(`^[ \\t]{1,${fenceIndent}}`) : null;
        const lines = rawExpression.split("\n");
        rawExpression = lines
          .map((line) => {
            let cleaned = line;
            for (let d = 0; d < quoteDepth; d++) {
              cleaned = cleaned.replace(/^[ \t]*>[ \t]?/, "");
            }
            if (indentRegex) {
              cleaned = cleaned.replace(indentRegex, "");
            }
            return cleaned;
          })
          .join("\n");
      }
    }

    const expression = rawExpression.trim();

    const math: MathMetadata = Object.freeze({
      mathKind: isInline ? "inline" : "block",
      expression,
      openingMarkerRange: openMarker
        ? Object.freeze({ from: openMarker.from, to: openMarker.to })
        : Object.freeze({ from: node.from, to: node.from }),
      closingMarkerRange: closeMarker
        ? Object.freeze({ from: closeMarker.from, to: closeMarker.to })
        : null,
      contentRange: Object.freeze({ from: contentFrom, to: contentTo }),
    });

    return { math };
  },
  resolveContentRange(
    node: SyntaxNode,
    source: string,
    children: readonly SyntaxNode[],
  ): SourceRange | null {
    const markers = children.filter((c) => c.name === MATH_NODES.MathMark);
    if (markers.length < 2) {
      return null;
    }
    const openMarker = markers[0];
    let contentFrom = openMarker.to;
    const isFenced =
      source.slice(openMarker.from, openMarker.to).startsWith("`") ||
      source.slice(openMarker.from, openMarker.to).startsWith("~");
    if (isFenced) {
      const nextNewline = source.indexOf("\n", openMarker.to);
      contentFrom = nextNewline === -1 ? openMarker.to : nextNewline + 1;
    }
    return Object.freeze({
      from: contentFrom,
      to: markers[markers.length - 1].from,
    });
  },
  buildDecorations: buildMathLayoutDecorations,
});
