import { history, redo, undo, undoDepth } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { EditorSelection, EditorState, Transaction, type SelectionRange } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { provideWysiwygDiagnostics, WysiwygDiagnostics } from "../diagnostics.ts";
import {
  markdownRangeIndexField,
  refreshMarkdownParseCoverageEffect,
} from "../markdown/range-index.ts";
import { M1_MARKDOWN_EXTENSIONS } from "../markdown/extensions.ts";
import { editorModeField, setEditorModeEffect } from "../mode.ts";
import {
  protectedWysiwygChangeRejectedEffect,
  WYSIWYG_SOURCE_MODE_REQUIRED_MESSAGE,
  wysiwygChangeProtection,
} from "./change-protection.ts";
import {
  clearWysiwygAtomSelectionEffect,
  configureWysiwygProjectionFeatures,
  endWysiwygCompositionGuardEffect,
  inspectWysiwygProjection,
  selectWysiwygAtomEffect,
  startWysiwygCompositionGuardEffect,
  wysiwygProjectionField,
  type WysiwygProjectionFeature,
} from "./projection-state.ts";
import { buildVisibleMarkdownMarks } from "./visible-marks.ts";

const DOCUMENT = [
  "# Heading",
  "",
  "Paragraph with **bold** and [label](https://example.com).",
  "",
  "![alt](asset.png)",
  "",
  "<https://example.org>",
  "",
].join("\n");

function createProjectionState(
  selection: EditorSelection | SelectionRange = EditorSelection.cursor(0),
  features: readonly WysiwygProjectionFeature[] = [],
  doc = DOCUMENT,
): { readonly state: EditorState; readonly diagnostics: WysiwygDiagnostics } {
  const diagnostics = new WysiwygDiagnostics();
  const state = EditorState.create({
    doc,
    selection,
    extensions: [
      history(),
      EditorState.allowMultipleSelections.of(true),
      markdown({ extensions: M1_MARKDOWN_EXTENSIONS }),
      provideWysiwygDiagnostics(diagnostics),
      editorModeField,
      markdownRangeIndexField,
      configureWysiwygProjectionFeatures(features),
      wysiwygProjectionField,
      wysiwygChangeProtection,
    ],
  });
  return { state, diagnostics };
}

function expectedSelectionDelta(previous: readonly string[], next: readonly string[]): string[] {
  const previousSet = new Set(previous);
  const nextSet = new Set(next);
  return [
    ...previous.filter((id) => !nextSet.has(id)),
    ...next.filter((id) => !previousSet.has(id)),
  ];
}

describe("WYSIWYG projection StateField", () => {
  it("owns immutable projection summaries and direct empty providers before features activate", () => {
    const { state, diagnostics } = createProjectionState();
    const projection = state.field(wysiwygProjectionField);
    const snapshot = inspectWysiwygProjection(state);

    expect(Object.isFrozen(projection)).toBe(true);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.activeSyntaxIds)).toBe(true);
    expect(snapshot.rangeIndexVersion).toBe(state.field(markdownRangeIndexField).version);
    expect(snapshot.layoutDecorationCount).toBe(0);
    expect(snapshot.atomicRangeCount).toBe(0);
    expect(diagnostics.snapshot().layoutDecorationReplaceCount).toBe(1);
    const fakeView = { state } as EditorView;
    expect(
      state
        .facet(EditorView.decorations)
        .some(
          (provider) =>
            provider === projection.layoutDecorations ||
            (typeof provider === "function" && provider(fakeView) === projection.layoutDecorations),
        ),
    ).toBe(true);
    expect(
      state
        .facet(EditorView.atomicRanges)
        .some((provider) => provider(fakeView) === projection.atomicRanges),
    ).toBe(true);
  });

  it("keeps the range index while source mode empties projection-owned state", () => {
    const { state } = createProjectionState();
    const index = state.field(markdownRangeIndexField);
    const sourceState = state.update({
      effects: setEditorModeEffect.of("source"),
      annotations: Transaction.addToHistory.of(false),
    }).state;
    const projection = inspectWysiwygProjection(sourceState);

    expect(sourceState.field(markdownRangeIndexField)).toBe(index);
    expect(projection).toMatchObject({
      mode: "source",
      activeSyntaxIds: [],
      selectedAtomIds: [],
      compositionGuardRanges: [],
      protectedRanges: [],
      layoutDecorationCount: 0,
      atomicRangeCount: 0,
    });
    expect(undoDepth(sourceState)).toBe(0);

    const movedInSource = sourceState.update({
      selection: EditorSelection.cursor(DOCUMENT.indexOf("label") + 1),
    }).state;
    expect(inspectWysiwygProjection(movedInSource)).toEqual(projection);

    const wysiwygState = movedInSource.update({
      effects: setEditorModeEffect.of("wysiwyg"),
      annotations: Transaction.addToHistory.of(false),
    }).state;
    expect(inspectWysiwygProjection(wysiwygState).mode).toBe("wysiwyg");
    expect(inspectWysiwygProjection(wysiwygState).activeSyntaxIds.length).toBeGreaterThan(0);
    expect(wysiwygState.field(markdownRangeIndexField)).toBe(index);
    expect(undoDepth(wysiwygState)).toBe(0);
  });

  it("updates activity from only the old/new selection span union", () => {
    const boldPosition = DOCUMENT.indexOf("bold") + 1;
    const linkPosition = DOCUMENT.indexOf("label") + 1;
    const { state, diagnostics } = createProjectionState(EditorSelection.cursor(boldPosition));
    const index = state.field(markdownRangeIndexField);
    const before = inspectWysiwygProjection(state);
    const nextState = state.update({ selection: EditorSelection.cursor(linkPosition) }).state;
    const after = inspectWysiwygProjection(nextState);

    expect(nextState.field(markdownRangeIndexField)).toBe(index);
    expect(after.lastSelectionDeltaIds).toEqual(
      expectedSelectionDelta(before.activeSyntaxIds, after.activeSyntaxIds),
    );
    expect(diagnostics.snapshot()).toMatchObject({
      fullIndexBuildCount: 1,
      dirtyBlockRebuildCount: 0,
      selectionDeltaUpdateCount: 1,
      layoutDecorationReplaceCount: 1,
    });
  });

  it("unions active syntax ids across every selection range", () => {
    const boldPosition = DOCUMENT.indexOf("bold") + 1;
    const linkPosition = DOCUMENT.indexOf("label") + 1;
    const selection = EditorSelection.create([
      EditorSelection.cursor(boldPosition),
      EditorSelection.range(linkPosition + 2, linkPosition),
    ]);
    const { state } = createProjectionState(selection);
    const index = state.field(markdownRangeIndexField);
    const expectedIds = new Set([
      ...index.at(boldPosition).map((record) => record.id),
      ...index.overlapping(linkPosition, linkPosition + 2).map((record) => record.id),
    ]);

    expect(new Set(inspectWysiwygProjection(state).activeSyntaxIds)).toEqual(expectedIds);
    expect(state.selection.ranges).toHaveLength(2);
    expect(state.selection.ranges[1].anchor).toBe(linkPosition + 2);
    expect(state.selection.ranges[1].head).toBe(linkPosition);
  });

  it("applies atom and composition guard effects without doc or history changes", () => {
    const imagePosition = DOCUMENT.indexOf("![alt]") + 2;
    const { state } = createProjectionState(EditorSelection.cursor(imagePosition));
    const image = state.field(markdownRangeIndexField).byKind("image")[0];
    if (!image) {
      throw new Error("Expected an image record.");
    }
    const guarded = state.update({
      selection: EditorSelection.range(image.fullRange.from, image.fullRange.to),
      effects: [
        selectWysiwygAtomEffect.of({ recordId: image.id, extend: false }),
        startWysiwygCompositionGuardEffect.of([{ from: imagePosition, to: imagePosition }]),
      ],
      annotations: Transaction.addToHistory.of(false),
    }).state;

    expect(guarded.doc).toBe(state.doc);
    expect(inspectWysiwygProjection(guarded)).toMatchObject({
      selectedAtomIds: [image.id],
      compositionGuardRanges: [{ from: imagePosition, to: imagePosition }],
    });
    expect(undoDepth(guarded)).toBe(0);

    const cleared = guarded.update({
      effects: [
        clearWysiwygAtomSelectionEffect.of(null),
        endWysiwygCompositionGuardEffect.of(null),
      ],
      annotations: Transaction.addToHistory.of(false),
    }).state;
    expect(inspectWysiwygProjection(cleared)).toMatchObject({
      selectedAtomIds: [],
      compositionGuardRanges: [],
    });
    expect(undoDepth(cleared)).toBe(0);
  });

  it("maps the active composition guard through document changes", () => {
    const position = DOCUMENT.indexOf("bold") + 2;
    const { state } = createProjectionState(EditorSelection.cursor(position));
    const guarded = state.update({
      effects: startWysiwygCompositionGuardEffect.of([{ from: position, to: position }]),
      annotations: Transaction.addToHistory.of(false),
    }).state;
    const composed = guarded.update({
      changes: { from: position, insert: "输" },
      userEvent: "input.type.compose",
    }).state;

    expect(inspectWysiwygProjection(composed).compositionGuardRanges).toEqual([
      { from: position, to: position + 1 },
    ]);
    expect(composed.selection.main.head).toBe(position);
  });

  it("protects source-only local edits, permits broad deletion, and disables protection in source mode", () => {
    const { state } = createProjectionState(EditorSelection.cursor(0), ["default-atoms"]);
    const autolink = state.field(markdownRangeIndexField).byKind("autolink")[0];
    if (!autolink) {
      throw new Error("Expected an autolink record.");
    }
    const inside = autolink.fullRange.from + 2;
    const blockedTransaction = state.update({
      changes: { from: inside, insert: "x" },
      selection: EditorSelection.cursor(inside + 1),
    });
    expect(blockedTransaction.docChanged).toBe(false);
    expect(blockedTransaction.state.doc.toString()).toBe(DOCUMENT);
    expect(blockedTransaction.state.selection).toEqual(state.selection);
    expect(
      blockedTransaction.effects.some((effect) => effect.is(protectedWysiwygChangeRejectedEffect)),
    ).toBe(true);
    expect(blockedTransaction.effects.find((effect) => effect.is(EditorView.announce))?.value).toBe(
      WYSIWYG_SOURCE_MODE_REQUIRED_MESSAGE,
    );
    expect(undoDepth(blockedTransaction.state)).toBe(0);

    const exactlySelected = state.update({
      selection: EditorSelection.range(autolink.fullRange.from, autolink.fullRange.to),
    }).state;
    const exactDelete = exactlySelected.update({
      changes: autolink.fullRange,
      selection: EditorSelection.cursor(autolink.fullRange.from),
      userEvent: "delete.selection",
    });
    expect(exactDelete.docChanged).toBe(false);
    expect(exactDelete.state.selection).toEqual(exactlySelected.selection);

    const broadSelection = state.update({
      selection: EditorSelection.range(autolink.fullRange.from - 1, autolink.fullRange.to + 1),
    }).state;
    const broadlyDeleted = broadSelection.update({
      changes: {
        from: broadSelection.selection.main.from,
        to: broadSelection.selection.main.to,
        insert: "replacement",
      },
    }).state;
    expect(broadlyDeleted.doc.toString()).toContain("replacement");
    expect(broadlyDeleted.doc.toString()).not.toContain("https://example.org");
    expect(undoDepth(broadlyDeleted)).toBe(1);

    const sourceState = state.update({ effects: setEditorModeEffect.of("source") }).state;
    const editedInSource = sourceState.update({ changes: { from: inside, insert: "x" } }).state;
    expect(editedInSource.doc.toString()).not.toBe(DOCUMENT);
    expect(undoDepth(editedInSource)).toBe(1);
  });

  it("replays source-mode edits through undo and redo after returning to WYSIWYG", () => {
    const document = "<https://example.org>\n";
    const { state } = createProjectionState(EditorSelection.cursor(0), ["default-atoms"], document);
    const autolink = state.field(markdownRangeIndexField).byKind("autolink")[0];
    if (!autolink) {
      throw new Error("Expected an autolink record.");
    }
    const editAt = autolink.fullRange.from + "<https://".length;
    const sourceState = state.update({
      effects: setEditorModeEffect.of("source"),
      annotations: Transaction.addToHistory.of(false),
    }).state;
    const edited = sourceState.update({ changes: { from: editAt, insert: "x" } }).state;
    const wysiwyg = edited.update({
      effects: setEditorModeEffect.of("wysiwyg"),
      annotations: Transaction.addToHistory.of(false),
    }).state;
    let replayed = wysiwyg;

    expect(wysiwyg.doc.toString()).toBe("<https://xexample.org>\n");
    expect(
      undo({ state: wysiwyg, dispatch: (transaction) => (replayed = transaction.state) }),
    ).toBe(true);
    expect(replayed.doc.toString()).toBe(document);
    expect(
      redo({ state: replayed, dispatch: (transaction) => (replayed = transaction.state) }),
    ).toBe(true);
    expect(replayed.doc.toString()).toBe("<https://xexample.org>\n");
  });

  it("creates a fresh range index and projection state for a fresh document generation state", () => {
    const first = createProjectionState().state;
    const second = createProjectionState().state;

    expect(second.field(markdownRangeIndexField)).not.toBe(first.field(markdownRangeIndexField));
    expect(second.field(wysiwygProjectionField)).not.toBe(first.field(wysiwygProjectionField));
    expect(inspectWysiwygProjection(second)).toEqual(inspectWysiwygProjection(first));
  });

  it("refreshes parser coverage through a non-history projection transaction", () => {
    const { state } = createProjectionState();
    const edited = state.update({
      changes: { from: DOCUMENT.indexOf("bold") + 2, insert: "x" },
      userEvent: "input.type",
    }).state;
    const depthBeforeRefresh = undoDepth(edited);
    const indexBeforeRefresh = edited.field(markdownRangeIndexField);
    const refreshed = edited.update({
      effects: refreshMarkdownParseCoverageEffect.of(null),
      annotations: Transaction.addToHistory.of(false),
    }).state;

    expect(refreshed.field(markdownRangeIndexField)).not.toBe(indexBeforeRefresh);
    expect(inspectWysiwygProjection(refreshed).rangeIndexVersion).toBe(
      indexBeforeRefresh.version + 1,
    );
    expect(undoDepth(refreshed)).toBe(depthBeforeRefresh);
  });

  it("builds paint-only inline Marks from visible ranges only", () => {
    const { state, diagnostics } = createProjectionState(EditorSelection.cursor(0), [
      "inline-styles",
    ]);
    const bold = state.field(markdownRangeIndexField).byKind("bold")[0];
    const link = state.field(markdownRangeIndexField).byKind("link")[0];
    if (!bold || !link) {
      throw new Error("Expected inline records.");
    }
    const view = {
      state,
      visibleRanges: [{ from: bold.fullRange.from, to: bold.fullRange.to }],
    } as unknown as EditorView;
    const decorations = buildVisibleMarkdownMarks(view);
    const covered: Array<{ from: number; to: number }> = [];
    decorations.between(0, state.doc.length, (from, to) => {
      covered.push({ from, to });
    });

    expect(covered).toEqual([bold.markerRanges[0], bold.contentRange, bold.markerRanges[1]]);
    expect(covered.some((range) => range.from >= link.fullRange.from)).toBe(false);
    expect(diagnostics.snapshot().visibleMarkBuildCount).toBe(1);
  });
});
