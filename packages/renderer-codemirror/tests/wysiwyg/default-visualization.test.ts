import { markdown } from "@codemirror/lang-markdown";
import { EditorSelection, EditorState } from "@codemirror/state";
import type { DecorationSet, WidgetType } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { provideWysiwygDiagnostics, WysiwygDiagnostics } from "../../src/diagnostics.ts";
import { M1_MARKDOWN_EXTENSIONS } from "../../src/markdown/extensions.ts";
import { markdownRangeIndexField } from "../../src/markdown/range-index.ts";
import { editorModeField } from "../../src/mode.ts";
import {
  buildDefaultAtomAtomicRanges,
  buildDefaultAtomLayoutDecorations,
} from "../../src/wysiwyg/blocks/default-visualization.ts";
import {
  configureWysiwygProjectionFeatures,
  inspectWysiwygProjection,
  wysiwygProjectionField,
} from "../../src/wysiwyg/state/projection-field.ts";
import { selectWysiwygAtomEffect } from "../../src/wysiwyg/state/types.ts";
import { DefaultAtomWidget } from "../../src/wysiwyg/widgets/default-atom-widget.ts";
import { findLayoutDecorationsForTesting } from "../../src/testing.ts";

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
  it("splits block atoms onto the whole-line contract and keeps inline atoms exclusive", () => {
    const { state } = createState();
    const probes = findLayoutDecorationsForTesting(state, "default-atom-widget");
    const blockProbes = probes.filter(
      (probe) => (probe.spec.widget as DefaultAtomWidget).value.block,
    );
    const inlineProbes = probes.filter(
      (probe) => !(probe.spec.widget as DefaultAtomWidget).value.block,
    );

    // setext 标题 / 引用式定义 / 脚注定义等整行块级原子块：不对称 Inclusivity。
    expect(blockProbes.length).toBeGreaterThan(0);
    for (const probe of blockProbes) {
      expect(probe.spec).toMatchObject({
        block: true,
        inclusiveStart: true,
        inclusiveEnd: false,
      });
      expect(state.doc.lineAt(probe.from).from).toBe(probe.from);
    }

    // 行内原子（autolink / 引用式链接等）必须保持 `inclusive: false` 的行内替换语义。
    for (const probe of inlineProbes) {
      expect(probe.spec).toMatchObject({ block: false, inclusive: false });
      expect(probe.spec.inclusiveStart).toBeUndefined();
      expect(probe.spec.inclusiveEnd).toBeUndefined();
    }
  });

  it("projects each supported source-only record as one visual and atomic range", () => {
    const { state } = createState();
    const index = state.field(markdownRangeIndexField);
    const defaults = index.records.filter((record) => record.renderPolicy === "source-only-atom");
    const projection = state.field(wysiwygProjectionField);
    const projectedWidgets = widgets(projection.layoutDecorations);

    // 裸 URL、尖括号 autolink、引用式链接均已改为普通可编辑文本 ⇒ 9 → 6
    expect(defaults).toHaveLength(6);
    expect(projectedWidgets).toHaveLength(defaults.length);
    expect(inspectWysiwygProjection(state)).toMatchObject({
      protectedRanges: defaults.map((record) => record.fullRange),
      layoutDecorationCount: defaults.length,
      atomicRangeCount: defaults.length,
    });
    // 三种链接类（裸 URL / 尖括号 autolink / 引用式）都已改为普通文本 ⇒ 只剩结构性原子
    expect(projectedWidgets.map((widget) => widget.value.kind)).toEqual([
      "heading-setext",
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
    // 用**未被本次改动影响**的原子 kind（链接类已改为普通文本）
    const atom = state.field(markdownRangeIndexField).byKind("reference-image")[0];
    if (!atom) {
      throw new Error("Expected a reference-image atom.");
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
    const atom = original.state.field(markdownRangeIndexField).byKind("reference-image")[0];
    if (!atom) {
      throw new Error("Expected a reference-image atom.");
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
