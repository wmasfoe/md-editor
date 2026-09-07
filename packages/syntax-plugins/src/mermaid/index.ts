import type { SyntaxNode } from "@lezer/common";
import {
  type MarkdownNodePolicy,
  type MarkdownSyntaxKind,
  type MarkdownSyntaxPlugin,
  type SourceRange,
} from "@md-editor/renderer-codemirror";
import { mermaidMarkdownExtension } from "./mermaid-parser.ts";
import { buildMermaidLayoutDecorations } from "./mermaid-projection.ts";
import { MERMAID_NODES, type MermaidMetadata } from "./mermaid-types.ts";

export { MERMAID_NODES, type MermaidMetadata } from "./mermaid-types.ts";
export { mermaidMarkdownExtension } from "./mermaid-parser.ts";
export { buildMermaidLayoutDecorations, MermaidBlockWidget } from "./mermaid-projection.ts";
export { loadMermaid, getLoadedMermaid, renderMermaidSvg } from "./mermaid-loader.ts";

/**
 * 官方 Mermaid 图表扩展插件（Mermaid Syntax Plugin）。
 * 遵循增量降级与架构解耦契约：
 * - 未加载该插件时，```mermaid 作为标准 CommonMark 代码块安全呈现，零报错；
 * - 启用该插件时，动态增强为 Mermaid 矢量图表，支持 Typora 式原位就地编辑。
 */
export const mermaidPlugin: MarkdownSyntaxPlugin = Object.freeze({
  id: "markdown.mermaid",
  name: "Mermaid Diagram",
  markdownExtension: mermaidMarkdownExtension,
  nodePolicies: Object.freeze({
    [MERMAID_NODES.MermaidBlock]: Object.freeze({
      kind: "mermaid-block" as MarkdownSyntaxKind,
      renderPolicy: "directive-panel",
      editPolicy: "structured",
      interactionPolicy: "structured-block",
      priority: 30,
      markerNodeNames: Object.freeze([MERMAID_NODES.MermaidMarker]),
      contentStrategy: "full",
    }) as MarkdownNodePolicy,
  }),
  extractMetadata(
    node: SyntaxNode,
    source: string,
    children: readonly SyntaxNode[],
  ): Record<string, unknown> {
    const markers = children.filter((c) => c.name === MERMAID_NODES.MermaidMarker);
    const openMarker = markers[0];
    const closeMarker = markers.length > 1 ? markers[markers.length - 1] : null;

    const openTo = openMarker ? openMarker.to : node.from;
    const nextNewline = source.indexOf("\n", openTo);
    const codeStart = nextNewline === -1 ? openTo : nextNewline + 1;
    const codeEnd = closeMarker ? closeMarker.from : node.to;
    let rawCode = source.slice(codeStart, codeEnd);
    let quoteDepth = 0;
    let curr: SyntaxNode | null = node.parent;
    while (curr) {
      if (curr.name === "Blockquote") {
        quoteDepth++;
      }
      curr = curr.parent;
    }

    if (quoteDepth > 0) {
      const lines = rawCode.split("\n");
      rawCode = lines
        .map((line) => {
          let cleaned = line;
          for (let d = 0; d < quoteDepth; d++) {
            cleaned = cleaned.replace(/^[ \t]*>[ \t]?/, "");
          }
          return cleaned;
        })
        .join("\n");
    }

    const code = rawCode.trim();

    const mermaid: MermaidMetadata = Object.freeze({
      code,
      openingMarkerRange: openMarker
        ? Object.freeze({ from: openMarker.from, to: openMarker.to })
        : Object.freeze({ from: node.from, to: node.from }),
      closingMarkerRange: closeMarker
        ? Object.freeze({ from: closeMarker.from, to: closeMarker.to })
        : null,
      contentRange: Object.freeze({ from: codeStart, to: codeEnd }),
    });

    return { mermaid };
  },
  resolveContentRange(
    node: SyntaxNode,
    source: string,
    children: readonly SyntaxNode[],
  ): SourceRange | null {
    const markers = children.filter((c) => c.name === MERMAID_NODES.MermaidMarker);
    if (markers.length < 1) {
      return null;
    }
    const openMarker = markers[0];
    const nextNewline = source.indexOf("\n", openMarker.to);
    const contentFrom = nextNewline === -1 ? openMarker.to : nextNewline + 1;
    const closeMarker = markers.length > 1 ? markers[markers.length - 1] : null;
    const contentTo = closeMarker ? closeMarker.from : node.to;

    return Object.freeze({
      from: contentFrom,
      to: contentTo,
    });
  },
  buildDecorations: buildMermaidLayoutDecorations,
});
