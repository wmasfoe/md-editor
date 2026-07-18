import {
  Facet,
  StateEffect,
  StateField,
  type EditorSelection,
  type EditorState,
  type Extension,
  type Range,
} from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";
import type { EditorMode } from "@md-editor/editor-core";
import { getWysiwygDiagnostics } from "../diagnostics.ts";
import { markdownRangeIndexField, type MarkdownRangeIndex } from "../markdown/range-index.ts";
import type { MarkdownRangeRecord, SourceRange } from "../markdown/range-types.ts";
import { editorModeField } from "../mode.ts";
import { buildHeadingLayoutDecorations } from "./inline-heading.ts";
import { buildLinkMediaAtomicRanges, buildLinkMediaLayoutDecorations } from "./link-projection.ts";
import { buildBlockAtomicRanges, buildBlockLayoutDecorations } from "./list-projection.ts";
import {
  buildDefaultAtomAtomicRanges,
  buildDefaultAtomLayoutDecorations,
  isRenderableDefaultAtom,
} from "./default-visualization.ts";
import {
  buildFrontmatterAtomicRanges,
  buildFrontmatterLayoutDecorations,
  getFrontmatterProtectedRanges,
} from "./frontmatter-projection.ts";

export type WysiwygProjectionFeature =
  | "inline-styles"
  | "headings"
  | "blocks"
  | "links"
  | "images"
  | "thematic-breaks"
  | "default-atoms"
  | "frontmatter";

export interface SelectWysiwygAtomEffect {
  readonly recordId: string;
  readonly extend: boolean;
}

export interface WysiwygProjectionSnapshot {
  readonly mode: EditorMode;
  readonly rangeIndexVersion: number;
  readonly activeSyntaxIds: readonly string[];
  readonly selectedAtomIds: readonly string[];
  readonly compositionGuardRanges: readonly SourceRange[];
  readonly protectedRanges: readonly SourceRange[];
  readonly layoutDecorationCount: number;
  readonly atomicRangeCount: number;
  readonly lastSelectionDeltaIds: readonly string[];
}

export interface WysiwygProjectionState {
  readonly mode: EditorMode;
  readonly rangeIndexVersion: number;
  readonly activeSyntaxIds: readonly string[];
  readonly selectedAtomIds: readonly string[];
  readonly compositionGuardRanges: readonly SourceRange[];
  readonly protectedRanges: readonly SourceRange[];
  readonly layoutDecorations: DecorationSet;
  readonly atomicRanges: DecorationSet;
  readonly lastSelectionDeltaIds: readonly string[];
}

const configuredProjectionFeatures = Facet.define<
  readonly WysiwygProjectionFeature[],
  readonly WysiwygProjectionFeature[]
>({
  combine(values) {
    return Object.freeze([...new Set(values.flat())]);
  },
});

export const selectWysiwygAtomEffect = StateEffect.define<SelectWysiwygAtomEffect>();
export const clearWysiwygAtomSelectionEffect = StateEffect.define<null>();
export const startWysiwygCompositionGuardEffect = StateEffect.define<readonly SourceRange[]>();
export const endWysiwygCompositionGuardEffect = StateEffect.define<null>();

export const wysiwygProjectionField = StateField.define<WysiwygProjectionState>({
  create(state) {
    return compileProjection(state, [], []);
  },
  update(previous, transaction) {
    const index = transaction.state.field(markdownRangeIndexField);
    const mode = transaction.state.field(editorModeField);
    const selectedAtomIds = normalizeSelectedAtomIds(
      index,
      applyAtomEffects(previous.selectedAtomIds, transaction.effects),
      transaction.state.selection,
      transaction.state,
      previous.selectedAtomIds,
    );
    const compositionGuardRanges = applyCompositionEffects(
      previous.compositionGuardRanges,
      transaction.effects,
    );
    const mappedCompositionGuardRanges = transaction.docChanged
      ? mapCompositionGuardRanges(compositionGuardRanges, transaction)
      : compositionGuardRanges;
    const effectsChanged =
      selectedAtomIds !== previous.selectedAtomIds ||
      mappedCompositionGuardRanges !== previous.compositionGuardRanges;

    if (mode === "source") {
      if (
        previous.mode === "source" &&
        !transaction.docChanged &&
        index.version === previous.rangeIndexVersion
      ) {
        return previous;
      }
      return compileProjection(transaction.state, [], []);
    }

    if (
      transaction.docChanged ||
      index.version !== previous.rangeIndexVersion ||
      mode !== previous.mode ||
      effectsChanged
    ) {
      return compileProjection(transaction.state, selectedAtomIds, mappedCompositionGuardRanges);
    }

    if (!transaction.selection) {
      return previous;
    }

    const activeSyntaxIds = collectActiveSyntaxIds(index, transaction.state.selection);
    const changedIds = symmetricDifference(previous.activeSyntaxIds, activeSyntaxIds);
    if (changedIds.length === 0) {
      return previous.lastSelectionDeltaIds.length === 0
        ? previous
        : freezeProjectionState({ ...previous, lastSelectionDeltaIds: [] });
    }

    getWysiwygDiagnostics(transaction.state)?.recordSelectionDeltaUpdate();
    const layoutDecorations = updateChangedLayoutDecorations(
      previous.layoutDecorations,
      index,
      changedIds,
      activeSyntaxIds,
      previous.selectedAtomIds,
      previous.compositionGuardRanges,
      transaction.state,
    );
    const atomicRanges = updateChangedAtomicRanges(
      previous.atomicRanges,
      index,
      changedIds,
      activeSyntaxIds,
      previous.selectedAtomIds,
      transaction.state,
    );
    return freezeProjectionState({
      ...previous,
      activeSyntaxIds,
      layoutDecorations,
      atomicRanges,
      lastSelectionDeltaIds: changedIds,
    });
  },
  provide(field) {
    return [
      EditorView.decorations.from(field, (projection) => projection.layoutDecorations),
      EditorView.atomicRanges.of((view) => view.state.field(field).atomicRanges),
    ];
  },
});

export function configureWysiwygProjectionFeatures(
  features: readonly WysiwygProjectionFeature[],
): Extension {
  return configuredProjectionFeatures.of(Object.freeze([...features]));
}

export function hasWysiwygProjectionFeature(
  state: EditorState,
  feature: WysiwygProjectionFeature,
): boolean {
  return state.facet(configuredProjectionFeatures).includes(feature);
}

export function inspectWysiwygProjection(state: EditorState): WysiwygProjectionSnapshot {
  const projection = state.field(wysiwygProjectionField);
  return Object.freeze({
    mode: projection.mode,
    rangeIndexVersion: projection.rangeIndexVersion,
    activeSyntaxIds: projection.activeSyntaxIds,
    selectedAtomIds: projection.selectedAtomIds,
    compositionGuardRanges: projection.compositionGuardRanges,
    protectedRanges: projection.protectedRanges,
    layoutDecorationCount: projection.layoutDecorations.size,
    atomicRangeCount: projection.atomicRanges.size,
    lastSelectionDeltaIds: projection.lastSelectionDeltaIds,
  });
}

function compileProjection(
  state: EditorState,
  selectedAtomIds: readonly string[],
  compositionGuardRanges: readonly SourceRange[],
): WysiwygProjectionState {
  const index = state.field(markdownRangeIndexField);
  if (state.field(editorModeField) === "source") {
    return freezeProjectionState({
      mode: "source",
      rangeIndexVersion: index.version,
      activeSyntaxIds: [],
      selectedAtomIds: [],
      compositionGuardRanges: [],
      protectedRanges: [],
      layoutDecorations: Decoration.none,
      atomicRanges: Decoration.none,
      lastSelectionDeltaIds: [],
    });
  }

  const activeSyntaxIds = collectActiveSyntaxIds(index, state.selection);
  const normalizedAtomIds = sortStrings(selectedAtomIds.filter((id) => index.get(id) !== null));
  const normalizedGuards = freezeRanges(compositionGuardRanges);
  const layoutDecorations = buildLayoutDecorations(
    index,
    activeSyntaxIds,
    normalizedAtomIds,
    normalizedGuards,
    state,
  );
  const atomicRanges = buildAtomicRanges(index, activeSyntaxIds, normalizedAtomIds, state);
  const protectedRanges = buildProtectedRanges(index, state);
  getWysiwygDiagnostics(state)?.recordLayoutDecorationReplace();
  return freezeProjectionState({
    mode: "wysiwyg",
    rangeIndexVersion: index.version,
    activeSyntaxIds,
    selectedAtomIds: normalizedAtomIds,
    compositionGuardRanges: normalizedGuards,
    protectedRanges,
    layoutDecorations,
    atomicRanges,
    lastSelectionDeltaIds: [],
  });
}

function collectActiveSyntaxIds(
  index: MarkdownRangeIndex,
  selection: EditorSelection,
): readonly string[] {
  const activeIds = new Set<string>();
  for (const range of selection.ranges) {
    for (const record of index.overlapping(range.from, range.to)) {
      if (selectionActivatesRecord(record, range.from, range.to)) {
        activeIds.add(record.id);
      }
    }
  }
  return sortStrings(activeIds);
}

function buildLayoutDecorations(
  index: MarkdownRangeIndex,
  activeSyntaxIds: readonly string[],
  selectedAtomIds: readonly string[],
  compositionGuardRanges: readonly SourceRange[],
  state: EditorState,
): DecorationSet {
  const ranges = index.records.flatMap((record) =>
    buildLayoutDecorationsForRecord(
      record,
      activeSyntaxIds,
      selectedAtomIds,
      compositionGuardRanges,
      state,
    ),
  );
  return Decoration.set(ranges, true);
}

function updateChangedLayoutDecorations(
  previous: DecorationSet,
  index: MarkdownRangeIndex,
  changedIds: readonly string[],
  activeSyntaxIds: readonly string[],
  selectedAtomIds: readonly string[],
  compositionGuardRanges: readonly SourceRange[],
  state: EditorState,
): DecorationSet {
  const changed = new Set(changedIds);
  const additions = changedIds.flatMap((id) => {
    const record = index.get(id);
    return record
      ? buildLayoutDecorationsForRecord(
          record,
          activeSyntaxIds,
          selectedAtomIds,
          compositionGuardRanges,
          state,
        )
      : [];
  });
  return previous.update({
    filter: (_from, _to, value) => !changed.has(String(value.spec.wysiwygRecordId ?? "")),
    add: additions,
    sort: true,
  });
}

function buildLayoutDecorationsForRecord(
  record: MarkdownRangeRecord,
  activeSyntaxIds: readonly string[],
  selectedAtomIds: readonly string[],
  compositionGuardRanges: readonly SourceRange[],
  state: EditorState,
): readonly Range<Decoration>[] {
  if (hasWysiwygProjectionFeature(state, "frontmatter") && record.kind === "frontmatter") {
    return buildFrontmatterLayoutDecorations(record, state);
  }
  if (
    hasWysiwygProjectionFeature(state, "default-atoms") &&
    record.renderPolicy === "source-only-atom"
  ) {
    return buildDefaultAtomLayoutDecorations(record, selectedAtomIds.includes(record.id), state);
  }
  if (
    hasWysiwygProjectionFeature(state, "headings") &&
    (record.kind === "heading-atx" || record.kind === "heading-setext")
  ) {
    return buildHeadingLayoutDecorations(
      record,
      activeSyntaxIds.includes(record.id),
      compositionGuardRanges,
    );
  }
  if (
    hasWysiwygProjectionFeature(state, "blocks") &&
    (record.kind === "quote" ||
      record.kind === "list-item-unordered" ||
      record.kind === "list-item-ordered" ||
      record.kind === "task")
  ) {
    return buildBlockLayoutDecorations(record, state);
  }
  if (
    (record.kind === "link" && hasWysiwygProjectionFeature(state, "links")) ||
    (record.kind === "image" && hasWysiwygProjectionFeature(state, "images")) ||
    (record.kind === "thematic-break" && hasWysiwygProjectionFeature(state, "thematic-breaks"))
  ) {
    return buildLinkMediaLayoutDecorations(
      record,
      activeSyntaxIds.includes(record.id),
      selectedAtomIds.includes(record.id),
      state,
    );
  }
  return [];
}

function buildAtomicRanges(
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

function updateChangedAtomicRanges(
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
  if (hasWysiwygProjectionFeature(state, "frontmatter") && record.kind === "frontmatter") {
    return buildFrontmatterAtomicRanges(record, state);
  }
  if (
    hasWysiwygProjectionFeature(state, "default-atoms") &&
    record.renderPolicy === "source-only-atom"
  ) {
    return buildDefaultAtomAtomicRanges(record, state);
  }
  if (
    hasWysiwygProjectionFeature(state, "blocks") &&
    (record.kind === "quote" ||
      record.kind === "list-item-unordered" ||
      record.kind === "list-item-ordered" ||
      record.kind === "task")
  ) {
    return buildBlockAtomicRanges(record, state);
  }
  if (
    (record.kind === "link" && hasWysiwygProjectionFeature(state, "links")) ||
    (record.kind === "image" && hasWysiwygProjectionFeature(state, "images")) ||
    (record.kind === "thematic-break" && hasWysiwygProjectionFeature(state, "thematic-breaks"))
  ) {
    return buildLinkMediaAtomicRanges(record, activeSyntaxIds.includes(record.id));
  }
  return [];
}

function buildProtectedRanges(
  index: MarkdownRangeIndex,
  state: EditorState,
): readonly SourceRange[] {
  return freezeRanges(
    index.records.flatMap((record) => {
      if (
        hasWysiwygProjectionFeature(state, "default-atoms") &&
        isRenderableDefaultAtom(record, state)
      ) {
        return [record.fullRange];
      }
      if (hasWysiwygProjectionFeature(state, "frontmatter") && record.kind === "frontmatter") {
        return getFrontmatterProtectedRanges(record, state);
      }
      return [];
    }),
  );
}

function applyAtomEffects(
  previous: readonly string[],
  effects: readonly StateEffect<unknown>[],
): readonly string[] {
  let next = previous;
  for (const effect of effects) {
    if (effect.is(clearWysiwygAtomSelectionEffect)) {
      next = Object.freeze([]);
    } else if (effect.is(selectWysiwygAtomEffect)) {
      const ids = effect.value.extend ? new Set(next) : new Set<string>();
      ids.add(effect.value.recordId);
      next = sortStrings(ids);
    }
  }
  return next;
}

function normalizeSelectedAtomIds(
  index: MarkdownRangeIndex,
  selectedAtomIds: readonly string[],
  selection: EditorSelection,
  state: EditorState,
  previous: readonly string[],
): readonly string[] {
  const normalized = sortStrings(
    selectedAtomIds.filter((id) => {
      const record = index.get(id);
      return (
        record !== null &&
        (record.kind === "image" ||
          record.kind === "thematic-break" ||
          isRenderableDefaultAtom(record, state)) &&
        selection.ranges.some(
          (range) =>
            !range.empty &&
            range.from === record.fullRange.from &&
            range.to === record.fullRange.to,
        )
      );
    }),
  );
  return equalStrings(normalized, previous) ? previous : normalized;
}

function applyCompositionEffects(
  previous: readonly SourceRange[],
  effects: readonly StateEffect<unknown>[],
): readonly SourceRange[] {
  let next = previous;
  for (const effect of effects) {
    if (effect.is(startWysiwygCompositionGuardEffect)) {
      next = freezeRanges(effect.value);
    } else if (effect.is(endWysiwygCompositionGuardEffect)) {
      next = Object.freeze([]);
    }
  }
  return next;
}

function mapCompositionGuardRanges(
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

function symmetricDifference(
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

function freezeProjectionState(state: WysiwygProjectionState): WysiwygProjectionState {
  return Object.freeze({
    ...state,
    activeSyntaxIds: freezeStrings(state.activeSyntaxIds),
    selectedAtomIds: freezeStrings(state.selectedAtomIds),
    compositionGuardRanges: freezeRanges(state.compositionGuardRanges),
    protectedRanges: freezeRanges(state.protectedRanges),
    lastSelectionDeltaIds: freezeStrings(state.lastSelectionDeltaIds),
  });
}

function freezeRanges(ranges: readonly SourceRange[]): readonly SourceRange[] {
  if (Object.isFrozen(ranges) && ranges.every((range) => Object.isFrozen(range))) {
    return ranges;
  }
  return Object.freeze(ranges.map((range) => Object.freeze({ ...range })));
}

function freezeStrings(values: readonly string[]): readonly string[] {
  return Object.isFrozen(values) ? values : Object.freeze([...values]);
}

function sortStrings(values: Iterable<string>): readonly string[] {
  const sorted: string[] = [];
  for (const value of values) {
    let low = 0;
    let high = sorted.length;
    while (low < high) {
      const middle = low + Math.floor((high - low) / 2);
      if (sorted[middle].localeCompare(value) <= 0) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }
    sorted.splice(low, 0, value);
  }
  return Object.freeze(sorted);
}

function equalStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function selectionActivatesRecord(record: MarkdownRangeRecord, from: number, to: number): boolean {
  if (record.kind === "frontmatter") {
    return false;
  }
  if (record.interactionPolicy !== "reveal-source") {
    return true;
  }
  if (from === to) {
    return from > record.fullRange.from && from < record.fullRange.to;
  }
  return from < record.fullRange.to && to > record.fullRange.from;
}
