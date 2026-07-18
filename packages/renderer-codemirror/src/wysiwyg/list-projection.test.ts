import { markdown } from "@codemirror/lang-markdown";
import { EditorSelection, EditorState, type SelectionRange } from "@codemirror/state";
import type { DecorationSet, WidgetType } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { provideWysiwygDiagnostics, WysiwygDiagnostics } from "../diagnostics.ts";
import { markdownRangeIndexField } from "../markdown/range-index.ts";
import { M1_MARKDOWN_EXTENSIONS } from "../markdown/extensions.ts";
import { editorModeField, setEditorModeEffect } from "../mode.ts";
import { BlockMarkerWidget, TaskCheckboxWidget } from "./list-projection.ts";
import {
  configureWysiwygProjectionFeatures,
  inspectWysiwygProjection,
  wysiwygProjectionField,
} from "./projection-state.ts";

interface DecorationSummary {
  readonly from: number;
  readonly to: number;
  readonly role: string;
  readonly className: string;
  readonly widget: WidgetType | null;
}

function createState(
  doc: string,
  selection: EditorSelection | SelectionRange = EditorSelection.cursor(0),
): { readonly state: EditorState; readonly diagnostics: WysiwygDiagnostics } {
  const diagnostics = new WysiwygDiagnostics();
  const state = EditorState.create({
    doc,
    selection,
    extensions: [
      EditorState.allowMultipleSelections.of(true),
      markdown({ extensions: M1_MARKDOWN_EXTENSIONS, addKeymap: false }),
      provideWysiwygDiagnostics(diagnostics),
      editorModeField,
      markdownRangeIndexField,
      configureWysiwygProjectionFeatures(["blocks"]),
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
      role: String(value.spec.wysiwygRole ?? ""),
      className: String(value.spec.class ?? ""),
      widget: (value.spec.widget as WidgetType | undefined) ?? null,
    });
  });
  return summaries;
}

describe("quote, list, and task projection", () => {
  it("indexes every nearest blockquote marker, including quoted list continuation lines", () => {
    const doc = ["> outer", "> > inner", "> - item", ">   - [x] task", ""].join("\n");
    const { state } = createState(doc);
    const quotes = state.field(markdownRangeIndexField).byKind("quote");
    const quoteMarkers = quotes.flatMap((record) => record.markerRanges);

    expect(quoteMarkers.map((range) => doc.slice(range.from, range.to))).toEqual([
      ">",
      ">",
      ">",
      ">",
      ">",
    ]);
    expect(new Set(quoteMarkers.map((range) => range.from)).size).toBe(5);
  });

  it("replaces every source marker with stable visuals and derives matching atomic ranges", () => {
    const doc = [
      "> quote",
      "",
      "- dash",
      "* star",
      "+ plus",
      "",
      "12) ordered",
      "",
      "- [X] task",
      "",
    ].join("\n");
    const { state } = createState(doc, EditorSelection.range(0, doc.length));
    const index = state.field(markdownRangeIndexField);
    const projection = state.field(wysiwygProjectionField);
    const layout = collectDecorations(projection.layoutDecorations, state.doc.length);
    const atomic = collectDecorations(projection.atomicRanges, state.doc.length);
    const records = index.records.filter((record) =>
      ["quote", "list-item-unordered", "list-item-ordered", "task"].includes(record.kind),
    );
    const markerCount = records.reduce((count, record) => count + record.markerRanges.length, 0);

    expect(layout.filter((item) => item.role.endsWith("-marker-hidden"))).toHaveLength(markerCount);
    expect(layout.filter((item) => item.role.endsWith("-line"))).toHaveLength(markerCount);
    expect(atomic.filter((item) => item.role.endsWith("-marker-atomic"))).toHaveLength(markerCount);
    expect(inspectWysiwygProjection(state).atomicRangeCount).toBe(markerCount);
    expect(state.doc.toString()).toBe(doc);

    const unorderedWidgets = layout
      .map((item) => item.widget)
      .filter((widget): widget is BlockMarkerWidget => widget instanceof BlockMarkerWidget)
      .filter((widget) => widget.kind === "list-item-unordered");
    expect(unorderedWidgets.map((widget) => widget.label)).toEqual(["•", "•", "•", "•"]);
    expect(
      layout
        .map((item) => item.widget)
        .find(
          (widget): widget is BlockMarkerWidget =>
            widget instanceof BlockMarkerWidget && widget.kind === "list-item-ordered",
        )?.label,
    ).toBe("12)");

    const taskWidget = layout
      .map((item) => item.widget)
      .find((widget): widget is TaskCheckboxWidget => widget instanceof TaskCheckboxWidget);
    expect(taskWidget?.value.checked).toBe(true);
    expect(taskWidget?.eq(new TaskCheckboxWidget(taskWidget.value))).toBe(true);
    expect(taskWidget?.eq(new TaskCheckboxWidget({ ...taskWidget.value, checked: false }))).toBe(
      false,
    );
  });

  it("hides marker separator whitespace without mutating cross-block selection offsets", () => {
    const doc = "Before\n\n> quote\n\n- item\n\nAfter\n";
    const selection = EditorSelection.range(doc.indexOf("Before") + 2, doc.indexOf("After") + 3);
    const { state } = createState(doc, selection);
    const list = state.field(markdownRangeIndexField).byKind("list-item-unordered")[0];
    const layout = collectDecorations(
      state.field(wysiwygProjectionField).layoutDecorations,
      state.doc.length,
    );
    const hiddenListMarker = layout.find(
      (item) => item.role === "list-item-unordered-marker-hidden",
    );

    expect(hiddenListMarker).toMatchObject({
      from: list.markerRanges[0].from,
      to: list.contentRange?.from,
    });
    expect(state.selection.main).toMatchObject({
      anchor: selection.anchor,
      head: selection.head,
    });
    expect(state.doc.toString()).toBe(doc);
  });

  it("preserves quote-internal indentation after the single hidden separator", () => {
    const doc = ">   - item\n";
    const { state } = createState(doc);
    const quote = state.field(markdownRangeIndexField).byKind("quote")[0];
    const layout = collectDecorations(
      state.field(wysiwygProjectionField).layoutDecorations,
      state.doc.length,
    );
    const hiddenQuoteMarker = layout.find((item) => item.role === "quote-marker-hidden");

    expect(hiddenQuoteMarker).toMatchObject({
      from: quote.markerRanges[0].from,
      to: quote.markerRanges[0].to + 1,
    });
    expect(state.sliceDoc(hiddenQuoteMarker!.to, doc.indexOf("-"))).toBe("  ");
  });

  it("clears all block projection and atomic ranges in source mode", () => {
    const { state } = createState("> quote\n\n- [ ] task\n");
    const source = state.update({ effects: setEditorModeEffect.of("source") }).state;

    expect(inspectWysiwygProjection(source)).toMatchObject({
      mode: "source",
      layoutDecorationCount: 0,
      atomicRangeCount: 0,
    });
  });
});
