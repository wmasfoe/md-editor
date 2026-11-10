import type { EditorState, Range } from "@codemirror/state";
import { Decoration } from "@codemirror/view";
import {
  defaultCalloutTitle,
  syntaxPluginHostPortsFacet,
  type MarkdownRangeRecord,
} from "@md-editor/plugin-sdk/syntax";
import type { DirectiveMetadata } from "./directive-types.ts";

/**
 * 构建容器指令（Container Directive）的 WYSIWYG 布局装饰。
 */
export function buildDirectiveLayoutDecorations(
  record: MarkdownRangeRecord,
  state: EditorState,
): readonly Range<Decoration>[] {
  const meta = (record.directive ?? record.metadata?.directive) as DirectiveMetadata | undefined;
  if (!meta) {
    return [];
  }

  // 宿主端口：Callout widget 的 DOM 结构属于渲染规则，由渲染器提供（插件不 import 宿主）。
  const { createCalloutHeaderWidget = () => null, createCalloutFooterWidget = () => null } =
    state.facet(syntaxPluginHostPortsFacet);

  const type = meta.directiveType ?? "info";
  const title = meta.title ?? defaultCalloutTitle(type);
  const headerRange = meta.headerRange ?? record.fullRange;
  const closingMarkerRange = meta.closingMarkerRange ?? null;

  const doc = state.doc;
  const startLine = doc.lineAt(record.fullRange.from);
  const endLine = doc.lineAt(record.fullRange.to);

  // 判定光标是否位于起始首行或闭合末行
  const selection = state.selection.main;
  const isHeaderActive = selection.from <= headerRange.to && selection.to >= record.fullRange.from;
  const isFooterActive =
    closingMarkerRange !== null &&
    selection.from <= record.fullRange.to &&
    selection.to >= closingMarkerRange.from;

  const decorations: Range<Decoration>[] = [];

  // 为容器内部的每一行挂载 Line Decoration（用于卡片左边框和浅色背景）
  for (let lineNo = startLine.number; lineNo <= endLine.number; lineNo++) {
    const curLine = doc.line(lineNo);
    const isFirst = lineNo === startLine.number;
    const isLast = lineNo === endLine.number;

    const classNames = [
      "cm-md-directive-line",
      `cm-md-directive--${type.toLowerCase()}`,
      isFirst ? "cm-md-directive-line--first" : "",
      isLast ? "cm-md-directive-line--last" : "",
    ]
      .filter(Boolean)
      .join(" ");

    decorations.push(
      Decoration.line({
        class: classNames,
        attributes: { "data-directive-type": type },
        wysiwygRecordId: record.id,
        wysiwygRole: "directive-line",
      }).range(curLine.from),
    );
  }

  // 首行装饰处理：当光标不在首行时，将 `:::type title` 替换为优雅的 Admonition 头部卡片
  if (!isHeaderActive) {
    const headerWidget = createCalloutHeaderWidget({ type, title, recordId: record.id });
    if (headerWidget) {
      decorations.push(
        Decoration.replace({
          widget: headerWidget,
          inclusive: false,
          wysiwygRecordId: record.id,
          wysiwygRole: "directive-header-widget",
        }).range(record.fullRange.from, headerRange.to),
      );
    }
  } else {
    // 光标在首行时显示原始字符供编辑，并对标记施加微光淡化样式
    const openMarker = meta.openingMarkerRange;
    if (openMarker) {
      decorations.push(
        Decoration.mark({
          class: "cm-md-marker cm-md-marker--directive",
          wysiwygRecordId: record.id,
          wysiwygRole: "directive-marker-visible",
        }).range(openMarker.from, openMarker.to),
      );
    }
  }

  // 尾行闭合标记处理：当有独立的闭合 ::: 且光标不在末行时，隐藏闭合字符
  if (closingMarkerRange) {
    if (!isFooterActive) {
      const footerWidget = createCalloutFooterWidget();
      if (footerWidget) {
        decorations.push(
          Decoration.replace({
            widget: footerWidget,
            inclusive: false,
            wysiwygRecordId: record.id,
            wysiwygRole: "directive-footer-hidden",
          }).range(closingMarkerRange.from, closingMarkerRange.to),
        );
      }
    } else {
      decorations.push(
        Decoration.mark({
          class: "cm-md-marker cm-md-marker--directive",
          wysiwygRecordId: record.id,
          wysiwygRole: "directive-marker-visible",
        }).range(closingMarkerRange.from, closingMarkerRange.to),
      );
    }
  }

  return decorations;
}
