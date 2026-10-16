/** Atomic/protected range construction and mapping. */
import { type EditorState, type Range } from "@codemirror/state";
import { Decoration, type DecorationSet } from "@codemirror/view";
import { type MarkdownRangeIndex } from "../../markdown/range-index.ts";
import type { MarkdownRangeRecord, SourceRange } from "../../markdown/range-types.ts";
import {
  buildDefaultAtomAtomicRanges,
  isRenderableDefaultAtom,
} from "../blocks/default-visualization.ts";
import {
  buildCodeBlockAtomicRanges,
  getCodeBlockProtectedRanges,
} from "../projections/code-block-projection.ts";
import {
  buildFrontmatterAtomicRanges,
  getFrontmatterProtectedRanges,
} from "../projections/frontmatter-projection.ts";
import {
  buildHtmlAtomicRanges,
  getHtmlProtectedRanges,
  isProjectableHtml,
} from "../projections/html-projection.ts";
import { buildLinkMediaAtomicRanges } from "../projections/link-projection.ts";
import { buildBlockAtomicRanges, getBlockProtectedRanges } from "../projections/list-projection.ts";
import {
  buildMdxAtomicRanges,
  getMdxProtectedRanges,
  isProjectableMdx,
} from "../projections/mdx-projection.ts";
import {
  buildTableAtomicRanges,
  getTableProtectedRanges,
  isProjectableTable,
} from "../projections/table-projection.ts";
import { type ProtectedSourceRange, configuredProjectionFeatures } from "./types.ts";

export function buildAtomicRanges(
  index: MarkdownRangeIndex,
  activeSyntaxIds: readonly string[],
  selectedAtomIds: readonly string[],
  state: EditorState,
): DecorationSet {
  const ranges = index.records.flatMap((record) =>
    buildAtomicRangesForRecord(record, activeSyntaxIds, selectedAtomIds, state),
  );
  return Decoration.set(ranges, true);
}

export function updateChangedAtomicRanges(
  previous: DecorationSet,
  index: MarkdownRangeIndex,
  changedIds: readonly string[],
  activeSyntaxIds: readonly string[],
  selectedAtomIds: readonly string[],
  state: EditorState,
): DecorationSet {
  const changed = new Set(changedIds);
  const additions = changedIds.flatMap((id) => {
    const record = index.get(id);
    if (!record) {
      return [];
    }
    return buildAtomicRangesForRecord(record, activeSyntaxIds, selectedAtomIds, state);
  });
  return previous.update({
    filter: (_from, _to, value) => !changed.has(String(value.spec.wysiwygRecordId ?? "")),
    add: additions,
    sort: true,
  });
}

function buildAtomicRangesForRecord(
  record: MarkdownRangeRecord,
  activeSyntaxIds: readonly string[],
  _selectedAtomIds: readonly string[],
  state: EditorState,
): readonly Range<Decoration>[] {
  if (
    state.facet(configuredProjectionFeatures).includes("frontmatter") &&
    record.kind === "frontmatter"
  ) {
    return buildFrontmatterAtomicRanges(record, state);
  }
  if (
    state.facet(configuredProjectionFeatures).includes("default-atoms") &&
    record.renderPolicy === "source-only-atom"
  ) {
    return buildDefaultAtomAtomicRanges(record, state);
  }
  if (
    state.facet(configuredProjectionFeatures).includes("blocks") &&
    (record.kind === "list-item-unordered" ||
      record.kind === "list-item-ordered" ||
      record.kind === "task")
  ) {
    return buildBlockAtomicRanges(record, state);
  }
  if (
    state.facet(configuredProjectionFeatures).includes("blocks") &&
    record.kind === "deferred-code"
  ) {
    return buildCodeBlockAtomicRanges(record, state);
  }
  if (state.facet(configuredProjectionFeatures).includes("tables") && isProjectableTable(record)) {
    return buildTableAtomicRanges(record, activeSyntaxIds.includes(record.id));
  }
  if (state.facet(configuredProjectionFeatures).includes("html") && isProjectableHtml(record)) {
    return buildHtmlAtomicRanges(record, _selectedAtomIds.includes(record.id));
  }
  if (state.facet(configuredProjectionFeatures).includes("mdx") && isProjectableMdx(record)) {
    return buildMdxAtomicRanges(record);
  }
  if (
    (record.kind === "link" && state.facet(configuredProjectionFeatures).includes("links")) ||
    (record.kind === "image" && state.facet(configuredProjectionFeatures).includes("images")) ||
    (record.kind === "thematic-break" &&
      state.facet(configuredProjectionFeatures).includes("thematic-breaks"))
  ) {
    return buildLinkMediaAtomicRanges(record, activeSyntaxIds.includes(record.id));
  }
  return [];
}

export function buildProtectedRanges(
  index: MarkdownRangeIndex,
  activeSyntaxIds: readonly string[],
  state: EditorState,
): readonly ProtectedSourceRange[] {
  return freezeRanges(
    index.records.flatMap((record) => {
      const ranges: ProtectedSourceRange[] = [];
      if (
        state.facet(configuredProjectionFeatures).includes("default-atoms") &&
        isRenderableDefaultAtom(record, state)
      ) {
        ranges.push({ ...record.fullRange, kind: "default-atom" });
      }
      if (
        state.facet(configuredProjectionFeatures).includes("frontmatter") &&
        record.kind === "frontmatter"
      ) {
        ranges.push(
          ...getFrontmatterProtectedRanges(record, state).map((range) => ({
            ...range,
            kind: "frontmatter" as const,
          })),
        );
      }
      if (state.facet(configuredProjectionFeatures).includes("blocks")) {
        ranges.push(
          ...getBlockProtectedRanges(record, state).map((range) => ({
            ...range,
            kind: "block-marker" as const,
          })),
        );
        ranges.push(
          ...getCodeBlockProtectedRanges(record).map((range) => ({
            ...range,
            kind: "code" as const,
          })),
        );
      }
      if (
        state.facet(configuredProjectionFeatures).includes("tables") &&
        isProjectableTable(record)
      ) {
        ranges.push(
          ...getTableProtectedRanges(record, activeSyntaxIds.includes(record.id)).map((range) => ({
            ...range,
            kind: "table" as const,
          })),
        );
      }
      if (state.facet(configuredProjectionFeatures).includes("html") && isProjectableHtml(record)) {
        ranges.push(
          ...getHtmlProtectedRanges(record).map((range) => ({
            ...range,
            kind: "html" as const,
          })),
        );
      }
      if (state.facet(configuredProjectionFeatures).includes("mdx") && isProjectableMdx(record)) {
        ranges.push(
          ...getMdxProtectedRanges(record).map((range) => ({
            ...range,
            kind: "mdx" as const,
          })),
        );
      }
      return ranges;
    }),
  );
}

export function mapCompositionGuardRanges(
  ranges: readonly SourceRange[],
  transaction: { readonly changes: { mapPos(position: number, association?: number): number } },
): readonly SourceRange[] {
  if (ranges.length === 0) {
    return ranges;
  }
  return freezeRanges(
    ranges.map((range) => ({
      from: transaction.changes.mapPos(range.from, -1),
      to: transaction.changes.mapPos(range.to, 1),
    })),
  );
}

/** G004 P0-1 快速路径用:protected 范围整体映射到新文档(字段保留,仅 from/to 重定位) */
export function mapProtectedRanges(
  ranges: readonly ProtectedSourceRange[],
  changes: { mapPos(position: number, association?: number): number },
): readonly ProtectedSourceRange[] {
  if (ranges.length === 0) {
    return ranges;
  }
  return freezeRanges(
    ranges.map((range) => ({
      ...range,
      from: changes.mapPos(range.from, -1),
      to: changes.mapPos(range.to, 1),
    })),
  );
}

export function symmetricDifference(
  previous: readonly string[],
  next: readonly string[],
): readonly string[] {
  const previousSet = new Set(previous);
  const nextSet = new Set(next);
  return Object.freeze([
    ...previous.filter((id) => !nextSet.has(id)),
    ...next.filter((id) => !previousSet.has(id)),
  ]);
}

export function freezeRanges<T extends SourceRange>(ranges: readonly T[]): readonly T[] {
  if (Object.isFrozen(ranges) && ranges.every((range) => Object.isFrozen(range))) {
    return ranges;
  }
  return Object.freeze(ranges.map((range) => Object.freeze({ ...range })));
}

export function rangesEqual(left: readonly SourceRange[], right: readonly SourceRange[]): boolean {
  return (
    left.length === right.length &&
    left.every((range, index) => range.from === right[index]?.from && range.to === right[index]?.to)
  );
}
