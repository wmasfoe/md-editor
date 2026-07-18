import { markdown } from "@codemirror/lang-markdown";
import { EditorSelection, EditorState, Transaction, type SelectionRange } from "@codemirror/state";
import { type DecorationSet, type WidgetType } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { provideWysiwygDiagnostics, WysiwygDiagnostics } from "../diagnostics.ts";
import { markdownRangeIndexField } from "../markdown/range-index.ts";
import { M1_MARKDOWN_EXTENSIONS } from "../markdown/extensions.ts";
import { editorModeField, setEditorModeEffect } from "../mode.ts";
import { provideImagePreviewResolver } from "./image-resolver.ts";
import {
  configureWysiwygProjectionFeatures,
  inspectWysiwygProjection,
  selectWysiwygAtomEffect,
  wysiwygProjectionField,
} from "./projection-state.ts";
import { ImageWidget } from "./widgets/image-widget.ts";
import { ThematicBreakWidget } from "./widgets/thematic-break-widget.ts";

interface DecorationSummary {
  readonly from: number;
  readonly to: number;
  readonly role: string;
  readonly widget: WidgetType | null;
}

function createState(
  doc: string,
  selection: EditorSelection | SelectionRange = EditorSelection.cursor(0),
  resolveImagePreview: (input: {
    readonly source: string;
    readonly alt: string;
    readonly title: string | null;
  }) => string = ({ source }) => source,
): { readonly state: EditorState; readonly diagnostics: WysiwygDiagnostics } {
  const diagnostics = new WysiwygDiagnostics();
  const state = EditorState.create({
    doc,
    selection,
    extensions: [
      EditorState.allowMultipleSelections.of(true),
      markdown({ extensions: M1_MARKDOWN_EXTENSIONS, addKeymap: false }),
      provideWysiwygDiagnostics(diagnostics),
      provideImagePreviewResolver(resolveImagePreview),
      editorModeField,
      markdownRangeIndexField,
      configureWysiwygProjectionFeatures(["links", "images", "thematic-breaks"]),
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
      widget: (value.spec.widget as WidgetType | undefined) ?? null,
    });
  });
  return summaries;
}

function widgetOf<T extends WidgetType>(
  state: EditorState,
  constructor: abstract new (...args: never[]) => T,
): T | null {
  return (
    collectDecorations(state.field(wysiwygProjectionField).layoutDecorations, state.doc.length)
      .map((item) => item.widget)
      .find((widget): widget is T => widget instanceof constructor) ?? null
  );
}

describe("link, image, and thematic-break projection", () => {
  it("shows only an inactive link label and reveals exact source from any interior selection", () => {
    const doc = 'Before [la\\]bel](<assets/a.png> "Title") after';
    const { state } = createState(doc, EditorSelection.cursor(doc.length));
    const link = state.field(markdownRangeIndexField).byKind("link")[0];
    const inactive = collectDecorations(
      state.field(wysiwygProjectionField).layoutDecorations,
      state.doc.length,
    ).filter((item) => item.role.startsWith("link-"));

    expect(inactive).toEqual([
      expect.objectContaining({
        from: link.fullRange.from,
        to: link.contentRange?.from,
        role: "link-prefix-hidden",
      }),
      expect.objectContaining({
        from: link.contentRange?.from,
        to: link.contentRange?.to,
        role: "link-label",
      }),
      expect.objectContaining({
        from: link.contentRange?.to,
        to: link.fullRange.to,
        role: "link-suffix-hidden",
      }),
    ]);
    expect(inspectWysiwygProjection(state).atomicRangeCount).toBe(2);

    const active = state.update({
      selection: EditorSelection.cursor(link.contentRange!.from),
    }).state;
    expect(
      collectDecorations(
        active.field(wysiwygProjectionField).layoutDecorations,
        active.doc.length,
      ).filter((item) => item.role.startsWith("link-")),
    ).toEqual([]);
    expect(active.doc.toString()).toBe(doc);
  });

  it("keeps a cursor at a reveal-source boundary outside and unions mixed-direction activity", () => {
    const doc = "[one](a) [two](b) [three](c)";
    const initial = createState(doc, EditorSelection.cursor(doc.length)).state;
    const links = initial.field(markdownRangeIndexField).byKind("link");
    const boundary = initial.update({
      selection: EditorSelection.cursor(links[0].fullRange.from),
    }).state;
    expect(inspectWysiwygProjection(boundary).activeSyntaxIds.includes(links[0].id)).toBe(false);

    const selection = EditorSelection.create([
      EditorSelection.cursor(links[0].contentRange!.from),
      EditorSelection.range(links[1].contentRange!.to, links[1].contentRange!.from),
    ]);
    const active = boundary.update({ selection }).state;
    expect(inspectWysiwygProjection(active).activeSyntaxIds).toEqual(
      expect.arrayContaining([links[0].id, links[1].id]),
    );
    expect(inspectWysiwygProjection(active).activeSyntaxIds).not.toContain(links[2].id);
  });

  it("passes normalized metadata to an injected resolver without changing image source", () => {
    const doc = 'Before ![alt text](<../img/a.png> "Caption") after';
    const calls: unknown[] = [];
    const { state } = createState(doc, EditorSelection.cursor(doc.length), (input) => {
      calls.push(input);
      return `asset://${input.source}`;
    });
    const image = state.field(markdownRangeIndexField).byKind("image")[0];
    const widget = widgetOf(state, ImageWidget);

    expect(calls).toEqual([{ source: "../img/a.png", alt: "alt text", title: "Caption" }]);
    expect(widget?.value).toMatchObject({
      markdownSource: "../img/a.png",
      previewSource: "asset://../img/a.png",
      alt: "alt text",
      title: "Caption",
      active: false,
      selected: false,
    });
    expect(widget?.eq(new ImageWidget(widget.value))).toBe(true);
    expect(widget?.eq(new ImageWidget({ ...widget.value, previewSource: "asset://changed" }))).toBe(
      false,
    );
    expect(state.doc.toString()).toBe(doc);
    expect(inspectWysiwygProjection(state).atomicRangeCount).toBe(1);

    const active = state.update({
      selection: EditorSelection.range(image.fullRange.from, image.fullRange.to),
    }).state;
    expect(widgetOf(active, ImageWidget)?.value).toMatchObject({
      markdownSource: "../img/a.png",
      previewSource: "asset://../img/a.png",
      active: true,
      selected: false,
    });
    const activePreview =
      collectDecorations(
        active.field(wysiwygProjectionField).layoutDecorations,
        active.doc.length,
      ).find((item) => item.role === "image-active-preview") ?? null;
    expect(activePreview).toMatchObject({
      from: active.doc.lineAt(image.fullRange.to).to,
      to: active.doc.lineAt(image.fullRange.to).to,
    });
    expect(inspectWysiwygProjection(active).atomicRangeCount).toBe(0);
    expect(active.doc.toString()).toBe(doc);
  });

  it("keeps an active image preview live while valid source text changes", () => {
    const doc = "![preview](before.png)";
    const calls: string[] = [];
    const initial = createState(
      doc,
      EditorSelection.cursor(doc.indexOf("before")),
      ({ source }) => {
        calls.push(source);
        return `asset://${source}`;
      },
    ).state;
    const destination = initial
      .field(markdownRangeIndexField)
      .byKind("image")[0]
      .segments.find((segment) => segment.role === "destination")!;
    const edited = initial.update({
      changes: { from: destination.from, to: destination.to, insert: "after.png" },
      selection: EditorSelection.cursor(destination.from + "after.png".length),
    }).state;

    expect(widgetOf(initial, ImageWidget)?.value).toMatchObject({
      previewSource: "asset://before.png",
      active: true,
    });
    expect(widgetOf(edited, ImageWidget)?.value).toMatchObject({
      markdownSource: "after.png",
      previewSource: "asset://after.png",
      active: true,
    });
    expect(calls).toEqual(["before.png", "after.png"]);
    expect(edited.doc.toString()).toBe("![preview](after.png)");
  });

  it("uses a source-preserving failed widget when resolution throws", () => {
    const doc = "![fallback](missing.png)";
    const { state, diagnostics } = createState(doc, EditorSelection.cursor(doc.length), () => {
      throw new Error("resolver failed");
    });
    const widget = widgetOf(state, ImageWidget);

    expect(widget?.value).toMatchObject({
      markdownSource: "missing.png",
      previewSource: null,
      alt: "fallback",
    });
    expect(diagnostics.snapshot().safeFallbackDiagnosticCodes).toContain(
      "IMAGE_PREVIEW_RESOLVE_FAILED",
    );
    expect(state.doc.toString()).toBe(doc);
  });

  it("keeps thematic breaks visual and atomic while styling explicit atom selection", () => {
    const doc = "Before\n\n---\n\nAfter\n";
    const initial = createState(doc, EditorSelection.cursor(0)).state;
    const thematicBreak = initial.field(markdownRangeIndexField).byKind("thematic-break")[0];
    const initialWidget = widgetOf(initial, ThematicBreakWidget);

    expect(initialWidget?.value.selected).toBe(false);
    expect(inspectWysiwygProjection(initial).atomicRangeCount).toBe(1);
    const selected = initial.update({
      selection: EditorSelection.range(thematicBreak.fullRange.from, thematicBreak.fullRange.to),
      effects: selectWysiwygAtomEffect.of({ recordId: thematicBreak.id, extend: false }),
      annotations: Transaction.addToHistory.of(false),
    }).state;
    const selectedWidget = widgetOf(selected, ThematicBreakWidget);
    expect(selectedWidget?.value.selected).toBe(true);
    expect(inspectWysiwygProjection(selected).selectedAtomIds).toEqual([thematicBreak.id]);
    expect(
      selectedWidget?.eq(new ThematicBreakWidget({ ...selectedWidget.value, selected: false })),
    ).toBe(false);

    const broad = selected.update({
      selection: EditorSelection.range(0, doc.length),
    }).state;
    expect(widgetOf(broad, ThematicBreakWidget)?.value.selected).toBe(false);
    expect(inspectWysiwygProjection(broad).selectedAtomIds).toEqual([]);
    expect(broad.selection.main).toMatchObject({ anchor: 0, head: doc.length });

    const source = broad.update({ effects: setEditorModeEffect.of("source") }).state;
    expect(inspectWysiwygProjection(source)).toMatchObject({
      layoutDecorationCount: 0,
      atomicRangeCount: 0,
    });
    expect(source.doc.toString()).toBe(doc);
  });
});
