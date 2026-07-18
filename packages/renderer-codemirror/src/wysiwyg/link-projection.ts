import type { EditorState, Range } from "@codemirror/state";
import { Decoration } from "@codemirror/view";
import { getWysiwygDiagnostics } from "../diagnostics.ts";
import type { MarkdownRangeRecord, SourceRange } from "../markdown/range-types.ts";
import { resolveImagePreview } from "./image-resolver.ts";
import { ImageWidget } from "./widgets/image-widget.ts";
import { ThematicBreakWidget } from "./widgets/thematic-break-widget.ts";

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
    return active ? [] : buildHiddenLinkFragments(record, "hidden");
  }
  if (record.kind === "image" && record.renderPolicy === "image-widget") {
    return [buildImageDecoration(record, state, active, selected)];
  }
  if (record.kind === "thematic-break" && record.renderPolicy === "thematic-break-widget") {
    const replacementTo = trailingLineBreakEnd(record, state);
    return [
      Decoration.replace({
        widget: new ThematicBreakWidget({
          recordId: record.id,
          selected,
          diagnostics: getWysiwygDiagnostics(state),
        }),
        inclusive: false,
        block: true,
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
  if (type === "hidden") {
    fragments.push(
      Decoration.mark({
        class: "cm-md-link-label",
        wysiwygRecordId: record.id,
        wysiwygRole: "link-label",
      }).range(content.from, content.to),
    );
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
