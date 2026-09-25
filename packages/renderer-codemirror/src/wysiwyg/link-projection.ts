/**
 * @file link-projection.ts
 * @description 链接、图像及分割线（ThematicBreak）的视觉投影与原子选区构建器。
 * 包含链接分段隐藏、图像挂件（ImageWidget）渲染、以及水平分割线（ThematicBreakWidget）装饰。
 */

import type { EditorState, Range } from "@codemirror/state";
import { Decoration } from "@codemirror/view";
import { getWysiwygDiagnostics } from "../diagnostics.ts";
import type { MarkdownRangeRecord, SourceRange } from "../markdown/range-types.ts";
import { buildLinkLabelDecoration, linkDestinationFromRecord } from "./link-interaction.ts";
import { resolveImagePreview } from "./image-resolver.ts";
import { ImageWidget } from "./widgets/image-widget.ts";
import { ThematicBreakWidget } from "./widgets/thematic-break-widget.ts";

/**
 * 为链接、图像及水平分割线构建视觉投影装饰集（Layout Decorations）。
 *
 * @param record - 范围索引记录
 * @param active - 当前光标是否落入该记录范围（是否激活源码显示）
 * @param selected - 是否处于原子选中态
 * @param state - 编辑器状态对象
 */
export function buildLinkMediaLayoutDecorations(
  record: MarkdownRangeRecord,
  active: boolean,
  selected: boolean,
  state: EditorState,
): readonly Range<Decoration>[] {
  if (record.parserCoverage !== "complete") {
    return [];
  }
  if (record.kind === "link" && record.renderPolicy === "link-segmented") {
    return active ? [] : buildHiddenLinkFragments(record, "hidden", state.doc);
  }
  // 裸 URL / 尖括号 autolink：文本本身即是 URL ⇒ **不隐藏任何片段**（保持可编辑），
  // 但挂上 `<a href>` 与 `.cm-md-link` 标记，从而复用既有链接交互（单击 reveal、Cmd/Ctrl+单击打开）。
  if (record.kind === "autolink") {
    const url = linkDestinationFromRecord(record, state.doc);
    const decoration = url === null ? null : buildLinkLabelDecoration(record, url);
    return decoration ? [decoration] : [];
  }
  if (record.kind === "image" && record.renderPolicy === "image-widget") {
    return [buildImageDecoration(record, state, active, selected)];
  }
  if (record.kind === "thematic-break" && record.renderPolicy === "thematic-break-widget") {
    const replacementTo = trailingLineBreakEnd(record, state);
    // CM6 块级替换：设置 inclusiveStart: true 避免起点生成幽灵空行（消除上方多出一行及光标上浮错位）；
    // 同时设置 inclusiveEnd: false 避免吞并紧随其后的换行（保持下方空行数量完全精确）。
    return [
      Decoration.replace({
        widget: new ThematicBreakWidget({
          recordId: record.id,
          selected,
          diagnostics: getWysiwygDiagnostics(state),
        }),
        block: true,
        inclusiveStart: true,
        inclusiveEnd: false,
        wysiwygRecordId: record.id,
        wysiwygRole: "thematic-break-widget",
      }).range(record.fullRange.from, replacementTo),
    ];
  }
  return [];
}

export function buildLinkMediaAtomicRanges(
  record: MarkdownRangeRecord,
  active: boolean,
): readonly Range<Decoration>[] {
  if (record.parserCoverage !== "complete") {
    return [];
  }
  if (record.kind === "link" && record.renderPolicy === "link-segmented") {
    return active ? [] : buildHiddenLinkFragments(record, "atomic");
  }
  if (record.kind === "image" && record.renderPolicy === "image-widget" && !active) {
    return [atomicRange(record.id, "image-atomic", record.fullRange)];
  }
  if (record.kind === "thematic-break" && record.renderPolicy === "thematic-break-widget") {
    return [atomicRange(record.id, "thematic-break-atomic", record.fullRange)];
  }
  return [];
}

function trailingLineBreakEnd(record: MarkdownRangeRecord, state: EditorState): number {
  return record.fullRange.to < state.doc.length &&
    state.sliceDoc(record.fullRange.to, record.fullRange.to + 1) === "\n"
    ? record.fullRange.to + 1
    : record.fullRange.to;
}

function buildHiddenLinkFragments(
  record: MarkdownRangeRecord,
  type: "hidden" | "atomic",
  doc?: { sliceString(from: number, to: number): string },
): readonly Range<Decoration>[] {
  const content = record.contentRange;
  if (!content) {
    return [];
  }
  const fragments = [
    fragmentDecoration(record.id, `link-prefix-${type}`, type, {
      from: record.fullRange.from,
      to: content.from,
    }),
    fragmentDecoration(record.id, `link-suffix-${type}`, type, {
      from: content.to,
      to: record.fullRange.to,
    }),
  ].filter((range) => range.from < range.to);
  if (type === "hidden" && doc) {
    const url = linkDestinationFromRecord(record, doc);
    const label = buildLinkLabelDecoration(record, url);
    if (label) {
      fragments.push(label);
    }
  }
  return fragments;
}

function fragmentDecoration(
  recordId: string,
  role: string,
  type: "hidden" | "atomic",
  range: SourceRange,
): Range<Decoration> {
  const decoration =
    type === "hidden"
      ? Decoration.replace({ inclusive: false, wysiwygRecordId: recordId, wysiwygRole: role })
      : Decoration.mark({ wysiwygRecordId: recordId, wysiwygRole: role });
  return decoration.range(range.from, range.to);
}

function buildImageDecoration(
  record: MarkdownRangeRecord,
  state: EditorState,
  active: boolean,
  selected: boolean,
): Range<Decoration> {
  const input = imageResolveInput(record, state);
  let previewSource: string | null = null;
  try {
    previewSource = resolveImagePreview(state, input).trim() || null;
    if (!previewSource) {
      getWysiwygDiagnostics(state)?.recordSafeFallback("IMAGE_PREVIEW_RESOLVE_EMPTY");
    }
  } catch {
    getWysiwygDiagnostics(state)?.recordSafeFallback("IMAGE_PREVIEW_RESOLVE_FAILED");
  }
  const widget = new ImageWidget({
    recordId: record.id,
    markdownSource: input.source,
    previewSource,
    alt: input.alt,
    title: input.title,
    active,
    selected,
    diagnostics: getWysiwygDiagnostics(state),
  });
  if (active) {
    return Decoration.widget({
      widget,
      block: true,
      side: 1,
      wysiwygRecordId: record.id,
      wysiwygRole: "image-active-preview",
    }).range(state.doc.lineAt(record.fullRange.to).to);
  }
  return Decoration.replace({
    widget,
    inclusive: false,
    wysiwygRecordId: record.id,
    wysiwygRole: "image-widget",
  }).range(record.fullRange.from, record.fullRange.to);
}

function imageResolveInput(
  record: MarkdownRangeRecord,
  state: EditorState,
): { readonly source: string; readonly alt: string; readonly title: string | null } {
  const destination = record.segments.find((segment) => segment.role === "destination");
  const title = record.segments.find((segment) => segment.role === "title");
  return {
    source: destination
      ? stripAngleDestination(state.sliceDoc(destination.from, destination.to))
      : "",
    alt: record.contentRange
      ? state.sliceDoc(record.contentRange.from, record.contentRange.to)
      : "",
    title: title ? stripTitleDelimiter(state.sliceDoc(title.from, title.to)) : null,
  };
}

function stripAngleDestination(source: string): string {
  return source.startsWith("<") && source.endsWith(">") ? source.slice(1, -1) : source;
}

function stripTitleDelimiter(title: string): string {
  const first = title[0];
  const last = title.at(-1);
  return (first === '"' && last === '"') ||
    (first === "'" && last === "'") ||
    (first === "(" && last === ")")
    ? title.slice(1, -1)
    : title;
}

function atomicRange(recordId: string, role: string, range: SourceRange): Range<Decoration> {
  return Decoration.mark({ wysiwygRecordId: recordId, wysiwygRole: role }).range(
    range.from,
    range.to,
  );
}
