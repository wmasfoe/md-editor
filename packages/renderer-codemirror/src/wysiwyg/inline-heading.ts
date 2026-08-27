import type { Range } from "@codemirror/state";
import { Decoration } from "@codemirror/view";
import type { MarkdownRangeRecord, SourceRange } from "../markdown/range-types.ts";

export function buildInlineStyleDecorations(
  record: MarkdownRangeRecord,
): readonly Range<Decoration>[] {
  if (
    record.parserCoverage !== "complete" ||
    record.renderPolicy !== "inline-visible-markers" ||
    !record.contentRange
  ) {
    return [];
  }

  const decorations: Range<Decoration>[] = [
    Decoration.mark({
      class: `cm-md-inline cm-md-${record.kind}`,
      attributes: { "data-markdown-kind": record.kind },
      wysiwygRecordId: record.id,
      wysiwygRole: "inline-content",
    }).range(record.contentRange.from, record.contentRange.to),
  ];
  for (const marker of record.markerRanges) {
    decorations.push(
      Decoration.mark({
        class: `cm-md-marker cm-md-marker--${record.kind}`,
        attributes: { "data-markdown-marker": record.kind },
        wysiwygRecordId: record.id,
        wysiwygRole: "inline-marker",
      }).range(marker.from, marker.to),
    );
  }
  return decorations;
}

export function buildHeadingLayoutDecorations(
  record: MarkdownRangeRecord,
  active: boolean,
  compositionGuardRanges: readonly SourceRange[],
): readonly Range<Decoration>[] {
  if (
    record.parserCoverage !== "complete" ||
    (record.kind !== "heading-atx" && record.kind !== "heading-setext")
  ) {
    return [];
  }

  const level = headingLevel(record);
  const kindClass = record.kind === "heading-atx" ? "atx" : "setext";
  const decorations: Range<Decoration>[] = [
    Decoration.line({
      class: [
        "cm-md-heading",
        `cm-md-heading--${kindClass}`,
        `cm-md-heading--level-${level}`,
        record.kind === "heading-setext" ? "cm-md-heading--source-only" : "",
      ]
        .filter(Boolean)
        .join(" "),
      attributes: {
        "data-markdown-kind": record.kind,
        "data-heading-level": String(level),
      },
      wysiwygRecordId: record.id,
      wysiwygRole: "heading-line",
    }).range(record.lineRange.from),
  ];

  if (record.kind === "heading-setext") {
    for (const marker of record.markerRanges) {
      decorations.push(visibleHeadingMarker(record, marker, "setext-marker"));
    }
    return decorations;
  }

  const [prefix, ...trailingMarkers] = record.markerRanges;
  if (prefix) {
    const hiddenPrefix = {
      from: prefix.from,
      to: Math.max(prefix.to, record.contentRange?.from ?? prefix.to),
    };
    if (!active && !touchesAny(hiddenPrefix, compositionGuardRanges)) {
      decorations.push(
        Decoration.replace({
          wysiwygRecordId: record.id,
          wysiwygRole: "heading-prefix-hidden",
        }).range(hiddenPrefix.from, hiddenPrefix.to),
      );
    } else {
      decorations.push(visibleHeadingMarker(record, prefix, "heading-prefix-visible"));
    }
  }
  for (const marker of trailingMarkers) {
    decorations.push(visibleHeadingMarker(record, marker, "heading-trailing-marker"));
  }
  return decorations;
}

function visibleHeadingMarker(
  record: MarkdownRangeRecord,
  marker: SourceRange,
  role: string,
): Range<Decoration> {
  return Decoration.mark({
    class: `cm-md-marker cm-md-marker--${record.kind}`,
    attributes: { "data-markdown-marker": record.kind },
    wysiwygRecordId: record.id,
    wysiwygRole: role,
  }).range(marker.from, marker.to);
}

function headingLevel(record: MarkdownRangeRecord): number {
  const match = /(?:ATXHeading|SetextHeading)([1-6])/u.exec(record.nodeName);
  return match ? Number.parseInt(match[1], 10) : 1;
}

function touchesAny(range: SourceRange, candidates: readonly SourceRange[]): boolean {
  return candidates.some((candidate) =>
    candidate.from === candidate.to
      ? candidate.from >= range.from && candidate.from <= range.to
      : candidate.from < range.to && candidate.to > range.from,
  );
}
