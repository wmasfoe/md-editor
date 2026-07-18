import { markdown } from "@codemirror/lang-markdown";
import { EditorSelection, EditorState } from "@codemirror/state";
import type { DecorationSet, WidgetType } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { provideWysiwygDiagnostics, WysiwygDiagnostics } from "../diagnostics.ts";
import { M1_MARKDOWN_EXTENSIONS } from "../markdown/extensions.ts";
import { markdownRangeIndexField } from "../markdown/range-index.ts";
import { editorModeField } from "../mode.ts";
import {
  buildDefaultAtomAtomicRanges,
  buildDefaultAtomLayoutDecorations,
} from "./default-visualization.ts";
import {
  configureWysiwygProjectionFeatures,
  inspectWysiwygProjection,
  selectWysiwygAtomEffect,
  wysiwygProjectionField,
} from "./projection-state.ts";
import { DefaultAtomWidget } from "./widgets/default-atom-widget.ts";

const DEFAULT_SOURCE = [
  "Setext title",
  "============",
  "",
  "<https://explicit.example> and https://bare.example/path.",
  "",
  "[label][ref] and ![alt][image-ref]",
  "",
  "[ref]: /target",
  "[image-ref]: image.png",
  "",
  "[^note]",
  "",
  "[^note]: Footnote body",
  "",
  "```md",
  "https://raw.example [^raw]",
  "```",
  "",
].join("\n");

function createState(source = DEFAULT_SOURCE) {
  const diagnostics = new WysiwygDiagnostics();
  const state = EditorState.create({
    doc: source,
    extensions: [
      markdown({ extensions: M1_MARKDOWN_EXTENSIONS }),
      provideWysiwygDiagnostics(diagnostics),
      editorModeField,
      markdownRangeIndexField,
      configureWysiwygProjectionFeatures(["headings", "default-atoms"]),
      wysiwygProjectionField,
    ],
  });
  return { state, diagnostics };
}

function widgets(decorations: DecorationSet): readonly DefaultAtomWidget[] {
  const values: DefaultAtomWidget[] = [];
  decorations.between(0, Number.MAX_SAFE_INTEGER, (_from, _to, decoration) => {
    const widget = decoration.spec.widget as WidgetType | undefined;
    if (widget instanceof DefaultAtomWidget) {
      values.push(widget);
    }
  });
  return values;
}

describe("default WYSIWYG visualization", () => {
  it("projects each supported source-only record as one visual and atomic range", () => {
    const { state } = createState();
    const index = state.field(markdownRangeIndexField);
    const defaults = index.records.filter((record) => record.renderPolicy === "source-only-atom");
    const projection = state.field(wysiwygProjectionField);
    const projectedWidgets = widgets(projection.layoutDecorations);

    expect(defaults).toHaveLength(9);
    expect(projectedWidgets).toHaveLength(defaults.length);
    expect(inspectWysiwygProjection(state)).toMatchObject({
      protectedRanges: defaults.map((record) => record.fullRange),
      layoutDecorationCount: defaults.length,
      atomicRangeCount: defaults.length,
    });
    expect(projectedWidgets.map((widget) => widget.value.kind)).toEqual([
      "heading-setext",
      "autolink",
      "autolink",
      "reference-link",
      "reference-image",
      "reference-definition",
      "reference-definition",
      "footnote",
      "footnote",
    ]);
    expect(projectedWidgets[0]?.value).toMatchObject({
      primaryText: "Setext title",
      block: true,
      headingLevel: 1,
    });
    expect(projectedWidgets.at(-1)?.value).toMatchObject({
      primaryText: "note",
      secondaryText: "Footnote body",
      block: true,
    });
  });

  it("updates selected styling without changing the document", () => {
    const { state } = createState();
    const atom = state.field(markdownRangeIndexField).byKind("reference-link")[0];
    if (!atom) {
      throw new Error("Expected a reference-link atom.");
    }
    const selected = state.update({
      selection: EditorSelection.range(atom.fullRange.from, atom.fullRange.to),
      effects: selectWysiwygAtomEffect.of({ recordId: atom.id, extend: false }),
    }).state;
    const selectedWidget = widgets(selected.field(wysiwygProjectionField).layoutDecorations).find(
      (widget) => widget.value.recordId === atom.id,
    );

    expect(selected.doc).toBe(state.doc);
    expect(inspectWysiwygProjection(selected).selectedAtomIds).toEqual([atom.id]);
    expect(selectedWidget?.value.selected).toBe(true);
  });

  it("drops only a stale-fingerprint projection and records safe fallback", () => {
    const original = createState();
    const atom = original.state.field(markdownRangeIndexField).byKind("autolink")[0];
    if (!atom) {
      throw new Error("Expected an autolink atom.");
    }
    const changedSource = `${DEFAULT_SOURCE.slice(0, atom.fullRange.from + 2)}x${DEFAULT_SOURCE.slice(
      atom.fullRange.from + 3,
    )}`;
    const changed = createState(changedSource);

    expect(buildDefaultAtomLayoutDecorations(atom, false, changed.state)).toEqual([]);
    expect(buildDefaultAtomAtomicRanges(atom, changed.state)).toEqual([]);
    expect(changed.diagnostics.snapshot().safeFallbackDiagnosticCounts).toMatchObject({
      DEFAULT_ATOM_FINGERPRINT_MISMATCH: 2,
    });
  });
});
