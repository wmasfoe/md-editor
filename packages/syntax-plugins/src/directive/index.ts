import type { EditorState, Range } from "@codemirror/state";
import type { Decoration } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import {
  defaultCalloutTitle,
  type MarkdownNodePolicy,
  type MarkdownRangeRecord,
  type MarkdownSyntaxKind,
  type MarkdownSyntaxPlugin,
  type SourceRange,
} from "@md-editor/renderer-codemirror";
import { DIRECTIVE_NODES, directiveMarkdownExtension } from "./directive-parser.ts";
import { buildDirectiveLayoutDecorations } from "./directive-projection.ts";
import type { DirectiveMetadata } from "./directive-types.ts";

/**
 * 官方容器指令扩展插件（Container Directive Plugin）。
 * 支持 :::info, :::tip, :::warning, :::danger 等语法。
 *
 * 遵循增量降级契约：
 * - 未加载该插件时，编辑器保持标准 CommonMark/GFM 解析，未识别的指令文本作为段落安全呈现，零报错；
 * - 传入该插件时，动态增强为就地可编辑的 Admonition 卡片，并配有 16px 矢量 SVG 轮廓图标。
 */
export const containerDirectivePlugin: MarkdownSyntaxPlugin = Object.freeze({
  id: "markdown.directive",
  name: "Container Directive",
  markdownExtension: directiveMarkdownExtension,
  nodePolicies: Object.freeze({
    [DIRECTIVE_NODES.ContainerDirective]: Object.freeze({
      kind: "directive" as MarkdownSyntaxKind,
      renderPolicy: "directive-panel",
      editPolicy: "structured",
      interactionPolicy: "structured-block",
      priority: 30,
      markerNodeNames: Object.freeze([DIRECTIVE_NODES.DirectiveMarker]),
      contentStrategy: "full",
    }) as MarkdownNodePolicy,
  }),
  extractMetadata(
    node: SyntaxNode,
    source: string,
    children: readonly SyntaxNode[],
  ): Record<string, unknown> {
    const typeNode = children.find((c) => c.name === DIRECTIVE_NODES.DirectiveType);
    const titleNode = children.find((c) => c.name === DIRECTIVE_NODES.DirectiveTitle);
    const markers = children.filter((c) => c.name === DIRECTIVE_NODES.DirectiveMarker);
    const openMarker = markers[0];
    const closeMarker = markers.length > 1 ? markers[markers.length - 1] : null;

    const rawType = typeNode ? source.slice(typeNode.from, typeNode.to).trim() : "info";
    const rawTitle = titleNode ? source.slice(titleNode.from, titleNode.to).trim() : "";
    const title = rawTitle.length > 0 ? rawTitle : defaultCalloutTitle(rawType);

    let headerEnd = typeNode ? typeNode.to : node.from;
    if (titleNode) {
      headerEnd = Math.max(headerEnd, titleNode.to);
    }
    const nextNewline = source.indexOf("\n", headerEnd);
    const headerLineEnd = nextNewline === -1 ? source.length : nextNewline;

    const directive: DirectiveMetadata = Object.freeze({
      directiveType: rawType,
      title,
      headerRange: Object.freeze({
        from: node.from,
        to: Math.min(node.to, headerLineEnd),
      }),
      openingMarkerRange: openMarker
        ? Object.freeze({ from: openMarker.from, to: openMarker.to })
        : { from: node.from, to: node.from },
      closingMarkerRange: closeMarker
        ? Object.freeze({ from: closeMarker.from, to: closeMarker.to })
        : null,
    });

    return { directive };
  },
  resolveContentRange(
    node: SyntaxNode,
    source: string,
    children: readonly SyntaxNode[],
  ): SourceRange | null {
    const markers = children.filter((c) => c.name === DIRECTIVE_NODES.DirectiveMarker);
    if (markers.length < 1) {
      return null;
    }
    const openMarker = markers[0];
    const typeNode = children.find((c) => c.name === DIRECTIVE_NODES.DirectiveType);
    const titleNode = children.find((c) => c.name === DIRECTIVE_NODES.DirectiveTitle);
    const headerEnd = Math.max(
      openMarker.to,
      typeNode ? typeNode.to : 0,
      titleNode ? titleNode.to : 0,
    );
    const newlineAfterHeader = source.indexOf("\n", headerEnd);
    const contentFrom =
      newlineAfterHeader === -1 ? node.to : Math.min(node.to, newlineAfterHeader + 1);

    let contentTo = node.to;
    if (markers.length > 1) {
      const closeMarker = markers[markers.length - 1];
      const prevNewline = source.lastIndexOf("\n", closeMarker.from);
      contentTo = prevNewline === -1 ? closeMarker.from : prevNewline;
    }

    if (contentFrom >= contentTo) {
      return null;
    }
    return Object.freeze({ from: contentFrom, to: contentTo });
  },
  buildDecorations(record: MarkdownRangeRecord, state: EditorState): readonly Range<Decoration>[] {
    return buildDirectiveLayoutDecorations(record, state);
  },
});

export { DIRECTIVE_NODES, directiveMarkdownExtension } from "./directive-parser.ts";
export { buildDirectiveLayoutDecorations } from "./directive-projection.ts";
export type { DirectiveMetadata, DirectiveType } from "./directive-types.ts";
