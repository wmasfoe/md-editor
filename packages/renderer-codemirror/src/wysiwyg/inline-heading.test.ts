import { cursorCharForwardLogical } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import {
  EditorSelection,
  EditorState,
  Transaction,
  type SelectionRange,
  type StateCommand,
} from "@codemirror/state";
import type { DecorationSet, EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { provideWysiwygDiagnostics, WysiwygDiagnostics } from "../diagnostics.ts";
import { markdownRangeIndexField } from "../markdown/range-index.ts";
import { M1_MARKDOWN_EXTENSIONS } from "../markdown/extensions.ts";
import { editorModeField, setEditorModeEffect } from "../mode.ts";
import {
  configureWysiwygProjectionFeatures,
  inspectWysiwygProjection,
  startWysiwygCompositionGuardEffect,
  wysiwygProjectionField,
  type WysiwygProjectionFeature,
} from "./projection-state.ts";
import { buildVisibleMarkdownMarks } from "./visible-marks.ts";

interface DecorationSummary {
  readonly from: number;
  readonly to: number;
  readonly className: string;
  readonly recordId: string;
  readonly role: string;
  readonly markdownKind: string;
}

function createState(
  doc: string,
  selection: EditorSelection | SelectionRange = EditorSelection.cursor(0),
  features: readonly WysiwygProjectionFeature[] = ["inline-styles", "headings"],
): { readonly state: EditorState; readonly diagnostics: WysiwygDiagnostics } {
  const diagnostics = new WysiwygDiagnostics();
  const state = EditorState.create({
    doc,
    selection,
    extensions: [
      EditorState.allowMultipleSelections.of(true),
      markdown({ extensions: M1_MARKDOWN_EXTENSIONS }),
      provideWysiwygDiagnostics(diagnostics),
      editorModeField,
      markdownRangeIndexField,
      configureWysiwygProjectionFeatures(features),
      wysiwygProjectionField,
    ],
  });
  return { state, diagnostics };
}

function collectDecorations(
  decorations: DecorationSet,
  documentLength: number,
): DecorationSummary[] {
  const summaries: DecorationSummary[] = [];
  decorations.between(0, documentLength, (from, to, value) => {
    summaries.push({
      from,
      to,
      className: String(value.spec.class ?? ""),
      recordId: String(value.spec.wysiwygRecordId ?? ""),
      role: String(value.spec.wysiwygRole ?? ""),
      markdownKind: String(value.spec.attributes?.["data-markdown-kind"] ?? ""),
    });
  });
  return summaries;
}

function visibleDecorations(state: EditorState, from = 0, to = state.doc.length) {
  return buildVisibleMarkdownMarks({
    state,
    visibleRanges: [{ from, to }],
  } as unknown as EditorView);
}

function runStateCommand(state: EditorState, command: StateCommand): EditorState {
  let nextState: EditorState | null = null;
  const handled = command({
    state,
    dispatch(transaction) {
      nextState = transaction.state;
    },
  });
  expect(handled).toBe(true);
  if (!nextState) {
    throw new Error("Expected the state command to dispatch.");
  }
  return nextState;
}

describe("inline Markdown projection", () => {
  it("styles parser-backed content and visible markers for nested valid syntax only", () => {
    const doc = [
      "**bold** *italic* ~~strike~~ `code`",
      "**outer *inner***",
      String.raw`\*escaped\* and **unterminated`,
    ].join("\n");
    const { state } = createState(doc);
    const index = state.field(markdownRangeIndexField);
    const decorations = collectDecorations(visibleDecorations(state), state.doc.length);
    const content = decorations.filter((decoration) => decoration.role === "inline-content");
    const markers = decorations.filter((decoration) => decoration.role === "inline-marker");

    expect(content.map((decoration) => decoration.markdownKind)).toEqual([
      "bold",
      "italic",
      "strikethrough",
      "inline-code",
      "bold",
      "italic",
    ]);
    expect(markers).toHaveLength(
      index.records
        .filter((record) => record.renderPolicy === "inline-visible-markers")
        .reduce((count, record) => count + record.markerRanges.length, 0),
    );
    expect(
      index.byKind("italic").some((record) => doc.slice(record.fullRange.from).startsWith("\\*")),
    ).toBe(false);
    expect(index.byKind("bold").some((record) => record.fullRange.to === doc.length)).toBe(false);
  });

  it("builds marks only for records intersecting the visible range and empties them in source mode", () => {
    const doc = "**first**\n\n*second*\n";
    const { state } = createState(doc);
    const first = state.field(markdownRangeIndexField).byKind("bold")[0];
    const second = state.field(markdownRangeIndexField).byKind("italic")[0];
    const visible = collectDecorations(
      visibleDecorations(state, first.fullRange.from, first.fullRange.to),
      state.doc.length,
    );
    expect(new Set(visible.map((decoration) => decoration.recordId))).toEqual(new Set([first.id]));
    expect(visible.some((decoration) => decoration.recordId === second.id)).toBe(false);

    const sourceState = state.update({
      effects: setEditorModeEffect.of("source"),
      annotations: Transaction.addToHistory.of(false),
    }).state;
    expect(visibleDecorations(sourceState).size).toBe(0);
  });

  it("keeps every inline delimiter reachable by logical character movement", () => {
    const doc = "**x**";
    let { state } = createState(doc, EditorSelection.cursor(0));
    const visited = [state.selection.main.head];
    for (let index = 0; index < doc.length; index += 1) {
      state = runStateCommand(state, cursorCharForwardLogical);
      visited.push(state.selection.main.head);
    }
    expect(visited).toEqual([0, 1, 2, 3, 4, 5]);
    expect(state.doc.toString()).toBe(doc);
    expect(inspectWysiwygProjection(state).atomicRangeCount).toBe(0);
  });
});

describe("heading projection", () => {
  it("styles ATX H1-H6, hides only inactive prefixes, and visualizes Setext as source-only", () => {
    const doc = [
      "# H1",
      "## H2",
      "### H3",
      "#### H4",
      "##### H5",
      "###### H6",
      "",
      "Setext one",
      "==========",
      "",
      "Setext two",
      "----------",
      "",
    ].join("\n");
    const { state } = createState(doc, EditorSelection.cursor(doc.length));
    const index = state.field(markdownRangeIndexField);
    const decorations = collectDecorations(
      state.field(wysiwygProjectionField).layoutDecorations,
      state.doc.length,
    );
    const atx = index.byKind("heading-atx");
    const setext = index.byKind("heading-setext");

    expect(atx).toHaveLength(6);
    expect(setext).toHaveLength(2);
    for (const [offset, record] of atx.entries()) {
      expect(
        decorations.find(
          (decoration) => decoration.recordId === record.id && decoration.role === "heading-line",
        )?.className,
      ).toContain(`cm-md-heading--level-${offset + 1}`);
      const hidden = decorations.find(
        (decoration) =>
          decoration.recordId === record.id && decoration.role === "heading-prefix-hidden",
      );
      expect(hidden).toMatchObject({
        from: record.markerRanges[0].from,
        to: record.contentRange?.from,
      });
    }
    for (const record of setext) {
      expect(
        decorations.find(
          (decoration) => decoration.recordId === record.id && decoration.role === "heading-line",
        )?.className,
      ).toContain("cm-md-heading--source-only");
      expect(
        decorations.some(
          (decoration) =>
            decoration.recordId === record.id && decoration.role === "heading-prefix-hidden",
        ),
      ).toBe(false);
      expect(
        decorations.some(
          (decoration) => decoration.recordId === record.id && decoration.role === "setext-marker",
        ),
      ).toBe(true);
    }
    expect(inspectWysiwygProjection(state).atomicRangeCount).toBe(0);
    expect(state.doc.toString()).toBe(doc);
  });

  it("reveals every touched ATX prefix across mixed-direction selections", () => {
    const doc = "# One\n\n## Two\n\n### Three\n";
    const one = doc.indexOf("One") + 1;
    const two = doc.indexOf("Two") + 1;
    const selection = EditorSelection.create([
      EditorSelection.cursor(one),
      EditorSelection.range(two + 1, two),
    ]);
    const { state } = createState(doc, selection);
    const headings = state.field(markdownRangeIndexField).byKind("heading-atx");
    const decorations = collectDecorations(
      state.field(wysiwygProjectionField).layoutDecorations,
      state.doc.length,
    );

    expect(
      headings
        .slice(0, 2)
        .every((heading) =>
          decorations.some(
            (decoration) =>
              decoration.recordId === heading.id && decoration.role === "heading-prefix-visible",
          ),
        ),
    ).toBe(true);
    expect(
      decorations.some(
        (decoration) =>
          decoration.recordId === headings[2].id && decoration.role === "heading-prefix-hidden",
      ),
    ).toBe(true);
    expect(state.selection.ranges[1]).toMatchObject({ anchor: two + 1, head: two });
  });

  it("updates only old/new heading records and reveals a guarded prefix during composition", () => {
    const doc = "# One\n\n## Two\n";
    const outside = doc.length;
    const one = doc.indexOf("One") + 1;
    const { state, diagnostics } = createState(doc, EditorSelection.cursor(outside));
    const firstHeading = state.field(markdownRangeIndexField).byKind("heading-atx")[0];
    const active = state.update({ selection: EditorSelection.cursor(one) }).state;
    const activeDecorations = collectDecorations(
      active.field(wysiwygProjectionField).layoutDecorations,
      active.doc.length,
    );
    expect(
      activeDecorations.some(
        (decoration) =>
          decoration.recordId === firstHeading.id && decoration.role === "heading-prefix-visible",
      ),
    ).toBe(true);
    expect(diagnostics.snapshot()).toMatchObject({
      selectionDeltaUpdateCount: 1,
      layoutDecorationReplaceCount: 1,
    });

    const guarded = state.update({
      effects: startWysiwygCompositionGuardEffect.of([firstHeading.markerRanges[0]]),
      annotations: Transaction.addToHistory.of(false),
    }).state;
    const guardedDecorations = collectDecorations(
      guarded.field(wysiwygProjectionField).layoutDecorations,
      guarded.doc.length,
    );
    expect(
      guardedDecorations.some(
        (decoration) =>
          decoration.recordId === firstHeading.id && decoration.role === "heading-prefix-visible",
      ),
    ).toBe(true);
  });

  it("leaves parser-rejected headings raw and clears heading projection in source mode", () => {
    const doc = "# Valid\n\n##invalid\n";
    const { state } = createState(doc, EditorSelection.cursor(doc.length));
    const index = state.field(markdownRangeIndexField);
    expect(index.byKind("heading-atx")).toHaveLength(1);
    expect(
      collectDecorations(state.field(wysiwygProjectionField).layoutDecorations, state.doc.length),
    ).toHaveLength(2);

    const sourceState = state.update({
      effects: setEditorModeEffect.of("source"),
      annotations: Transaction.addToHistory.of(false),
    }).state;
    expect(inspectWysiwygProjection(sourceState).layoutDecorationCount).toBe(0);
    expect(sourceState.doc.toString()).toBe(doc);
    expect(sourceState.selection).toEqual(state.selection);
  });
});
