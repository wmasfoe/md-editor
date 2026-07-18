import type { EditorState, Range } from "@codemirror/state";
import { Decoration } from "@codemirror/view";
import { getWysiwygDiagnostics } from "../diagnostics.ts";
import type { MarkdownRangeRecord } from "../markdown/range-types.ts";
import { hasCurrentSourceFingerprint, isDefaultAtomRecord } from "./default-atom.ts";
import { DefaultAtomWidget, type DefaultAtomWidgetValue } from "./widgets/default-atom-widget.ts";

export function buildDefaultAtomLayoutDecorations(
  record: MarkdownRangeRecord,
  selected: boolean,
  state: EditorState,
): readonly Range<Decoration>[] {
  if (!isRenderableDefaultAtom(record, state)) {
    return [];
  }
  const value = createDefaultAtomWidgetValue(record, selected, state);
  const replacementTo =
    record.kind === "heading-setext" ? trailingLineBreakEnd(record, state) : record.fullRange.to;
  return [
    Decoration.replace({
      widget: new DefaultAtomWidget(value),
      inclusive: false,
      block: value.block,
      wysiwygRecordId: record.id,
      wysiwygRole: "default-atom-widget",
    }).range(record.fullRange.from, replacementTo),
  ];
}

function trailingLineBreakEnd(record: MarkdownRangeRecord, state: EditorState): number {
  return record.fullRange.to < state.doc.length &&
    state.sliceDoc(record.fullRange.to, record.fullRange.to + 1) === "\n"
    ? record.fullRange.to + 1
    : record.fullRange.to;
}

export function buildDefaultAtomAtomicRanges(
  record: MarkdownRangeRecord,
  state: EditorState,
): readonly Range<Decoration>[] {
  if (!isRenderableDefaultAtom(record, state)) {
    return [];
  }
  return [
    Decoration.mark({
      wysiwygRecordId: record.id,
      wysiwygRole: "default-atom-atomic",
    }).range(record.fullRange.from, record.fullRange.to),
  ];
}

export function isRenderableDefaultAtom(record: MarkdownRangeRecord, state: EditorState): boolean {
  if (!isDefaultAtomRecord(record)) {
    return false;
  }
  if (hasCurrentSourceFingerprint(record, state)) {
    return true;
  }
  getWysiwygDiagnostics(state)?.recordSafeFallback("DEFAULT_ATOM_FINGERPRINT_MISMATCH");
  return false;
}

function createDefaultAtomWidgetValue(
  record: MarkdownRangeRecord,
  selected: boolean,
  state: EditorState,
): DefaultAtomWidgetValue {
  const source = state.sliceDoc(record.fullRange.from, record.fullRange.to);
  const content = record.contentRange
    ? state.sliceDoc(record.contentRange.from, record.contentRange.to)
    : source;
  const presentation = defaultAtomPresentation(record, source, content);
  return {
    recordId: record.id,
    kind: record.kind,
    selected,
    diagnostics: getWysiwygDiagnostics(state),
    ...presentation,
  };
}

function defaultAtomPresentation(
  record: MarkdownRangeRecord,
  source: string,
  content: string,
): Omit<DefaultAtomWidgetValue, "recordId" | "kind" | "selected" | "diagnostics"> {
  if (record.kind === "heading-setext") {
    const level = record.nodeName === "SetextHeading1" ? 1 : 2;
    return {
      primaryText: content.trimEnd(),
      secondaryText: null,
      accessibleLabel: `Heading level ${level}: ${content.trimEnd()}`,
      block: true,
      headingLevel: level,
    };
  }
  if (record.kind === "autolink") {
    const label = content.replace(/^<|>$/gu, "");
    return {
      primaryText: label,
      secondaryText: null,
      accessibleLabel: `Automatic link: ${label}`,
      block: false,
      headingLevel: null,
    };
  }
  if (record.kind === "reference-link" || record.kind === "reference-image") {
    const match = /^!?\[([^\]]*)\](?:\[([^\]]*)\])?$/u.exec(source);
    const label = match?.[1] || content;
    const reference = match?.[2] || label;
    const imagePrefix = record.kind === "reference-image" ? "Image " : "";
    return {
      primaryText: label,
      secondaryText: `[${reference}]`,
      accessibleLabel: `${imagePrefix}reference ${label}: ${reference}`,
      block: false,
      headingLevel: null,
    };
  }
  if (record.kind === "reference-definition") {
    const match = /^\[([^\]]+)\]:[ \t]*(.*)$/u.exec(source);
    const label = match?.[1] ?? source;
    const destination = match?.[2] ?? "";
    return {
      primaryText: label,
      secondaryText: destination,
      accessibleLabel: `Reference definition ${label}: ${destination}`,
      block: true,
      headingLevel: null,
    };
  }
  if (record.kind === "footnote") {
    const definition = record.nodeName === "FootnoteDefinition";
    const match = definition
      ? /^\[\^([^\]]+)\]:[ \t]*(.*)$/u.exec(source)
      : /^\[\^([^\]]+)\]$/u.exec(source);
    const label = match?.[1] ?? source;
    const body = definition ? (match?.[2] ?? "") : null;
    return {
      primaryText: label,
      secondaryText: body,
      accessibleLabel: definition
        ? `Footnote definition ${label}: ${body}`
        : `Footnote reference ${label}`,
      block: definition,
      headingLevel: null,
    };
  }
  return {
    primaryText: source,
    secondaryText: null,
    accessibleLabel: source,
    block: false,
    headingLevel: null,
  };
}
