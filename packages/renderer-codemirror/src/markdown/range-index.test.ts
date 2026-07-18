import { markdown } from "@codemirror/lang-markdown";
import { syntaxTree } from "@codemirror/language";
import { EditorSelection, EditorState } from "@codemirror/state";
import { findFrontmatterSourceRange } from "@md-editor/markdown-fidelity";
import { describe, expect, it } from "vitest";
import {
  provideWysiwygDiagnostics,
  WysiwygDiagnostics,
  type WysiwygDiagnosticsSnapshot,
} from "../diagnostics.ts";
import { setEditorModeEffect } from "../mode.ts";
import { analyzeFrontmatterYaml, getFrontmatterYamlDiagnostics } from "./frontmatter-yaml.ts";
import { M1_MARKDOWN_EXTENSIONS } from "./extensions.ts";
import { getM1MarkdownFixture } from "./fixtures.ts";
import {
  buildMarkdownRangeIndex,
  markdownRangeIndexField,
  refreshMarkdownParseCoverageEffect,
  type MarkdownRangeIndex,
} from "./range-index.ts";

interface IndexHarness {
  readonly state: EditorState;
  readonly index: MarkdownRangeIndex;
  readonly diagnostics: WysiwygDiagnostics;
}

function createIndexHarness(doc: string): IndexHarness {
  const diagnostics = new WysiwygDiagnostics();
  const state = EditorState.create({
    doc,
    extensions: [
      markdown({ extensions: M1_MARKDOWN_EXTENSIONS }),
      provideWysiwygDiagnostics(diagnostics),
      markdownRangeIndexField,
    ],
  });
  return { state, index: state.field(markdownRangeIndexField), diagnostics };
}

function snapshot(diagnostics: WysiwygDiagnostics): WysiwygDiagnosticsSnapshot {
  return diagnostics.snapshot();
}

function comparable(index: MarkdownRangeIndex) {
  return index.records.map((record) => ({
    kind: record.kind,
    nodeName: record.nodeName,
    fullRange: record.fullRange,
    contentRange: record.contentRange,
    markerRanges: record.markerRanges,
    renderPolicy: record.renderPolicy,
    editPolicy: record.editPolicy,
    sourceFingerprint: record.sourceFingerprint,
  }));
}

describe("Markdown parser range index", () => {
  it("builds exact nested inline, link, image, heading, list, and atom segments", () => {
    const fixture = getM1MarkdownFixture("combined-m1-document");
    const { index } = createIndexHarness(fixture.markdown);

    const bold = index.byKind("bold")[0];
    expect(fixture.markdown.slice(bold.fullRange.from, bold.fullRange.to)).toBe("**bold**");
    expect(fixture.markdown.slice(bold.contentRange?.from, bold.contentRange?.to)).toBe("bold");
    expect(bold.markerRanges.map((range) => fixture.markdown.slice(range.from, range.to))).toEqual([
      "**",
      "**",
    ]);

    const link = index.byKind("link")[0];
    expect(fixture.markdown.slice(link.contentRange?.from, link.contentRange?.to)).toBe("label");
    expect(link.segments.find((segment) => segment.role === "destination")).toBeDefined();
    expect(link.segments.find((segment) => segment.role === "title")).toBeDefined();

    const image = index.byKind("image")[0];
    expect(fixture.markdown.slice(image.contentRange?.from, image.contentRange?.to)).toBe("alt");
    expect(index.byKind("heading-atx")).toHaveLength(1);
    expect(index.byKind("heading-setext")).toHaveLength(1);
    expect(index.byKind("list-item-ordered")).toHaveLength(1);
    expect(index.byKind("list-item-unordered").length).toBeGreaterThanOrEqual(3);
    expect(index.byKind("task")).toHaveLength(2);
    expect(index.byKind("thematic-break")).toHaveLength(1);
  });

  it("gives Frontmatter priority over Markdown HR, Setext, and list interpretations", () => {
    const fixture = getM1MarkdownFixture("combined-m1-document");
    const { index } = createIndexHarness(fixture.markdown);
    const frontmatter = index.byKind("frontmatter");
    expect(frontmatter).toHaveLength(1);
    expect(frontmatter[0]).toMatchObject({
      nodeName: "Frontmatter",
      renderPolicy: "frontmatter-panel",
      priority: 100,
    });
    expect(
      index
        .byKind("thematic-break")
        .some((record) => record.fullRange.from < frontmatter[0].fullRange.to),
    ).toBe(false);

    const setext = createIndexHarness("Heading\n---\n").index;
    expect(setext.byKind("frontmatter")).toHaveLength(0);
    expect(setext.byKind("heading-setext")).toHaveLength(1);
  });

  it("degrades malformed and partial syntax without inventing valid policies", () => {
    const malformed = createIndexHarness(
      getM1MarkdownFixture("malformed-inline-and-block").markdown,
    ).index;
    expect(malformed.byKind("bold")).toHaveLength(0);
    expect(malformed.byKind("link")).toHaveLength(0);
    expect(malformed.byKind("reference-link")).toHaveLength(1);
    expect(malformed.byKind("reference-image")).toHaveLength(1);
    expect(malformed.byKind("inline-code")).toHaveLength(0);

    const partial = createIndexHarness(
      getM1MarkdownFixture("partial-typing-states").markdown,
    ).index;
    expect(partial.byKind("image")).toHaveLength(0);
    expect(partial.byKind("strikethrough")).toHaveLength(0);
  });

  it("supports point and overlap interval lookup", () => {
    const doc = "before **bold** after\n";
    const { index } = createIndexHarness(doc);
    const bold = index.byKind("bold")[0];
    expect(index.at(bold.contentRange?.from ?? -1).map((record) => record.kind)).toContain("bold");
    expect(index.overlapping(bold.fullRange.from, bold.fullRange.to)).toContain(bold);
    expect(index.overlapping(0, 3)).not.toContain(bold);
  });

  it("maps unaffected records and rebuilds only changed block records", () => {
    const doc = "# Heading\n\nParagraph **bold**.\n\nTail *italic*.\n";
    const harness = createIndexHarness(doc);
    const boldBefore = harness.index.byKind("bold")[0];
    const italicBefore = harness.index.byKind("italic")[0];
    const insertAt = doc.indexOf("bold") + 2;
    const transaction = harness.state.update({ changes: { from: insertAt, insert: "X" } });
    const next = transaction.state.field(markdownRangeIndexField);

    expect(next.byKind("bold")[0].id).not.toBe(boldBefore.id);
    expect(next.byKind("italic")[0].id).toBe(italicBefore.id);
    expect(snapshot(harness.diagnostics)).toMatchObject({
      fullIndexBuildCount: 1,
      dirtyBlockRebuildCount: 1,
    });
    expect(snapshot(harness.diagnostics).mappedRangeCount).toBeGreaterThan(0);

    const oracle = buildMarkdownRangeIndex(
      transaction.state.doc.toString(),
      syntaxTree(transaction.state),
    );
    expect(comparable(next)).toEqual(comparable(oracle));
  });

  it("reuses the same index for selection-only and mode-only transactions", () => {
    const harness = createIndexHarness("# Heading\n\nParagraph **bold**.\n");
    const selectionState = harness.state.update({
      selection: EditorSelection.cursor(3),
    }).state;
    expect(selectionState.field(markdownRangeIndexField)).toBe(harness.index);

    const modeState = selectionState.update({ effects: setEditorModeEffect.of("source") }).state;
    expect(modeState.field(markdownRangeIndexField)).toBe(harness.index);
    expect(snapshot(harness.diagnostics)).toMatchObject({
      fullIndexBuildCount: 1,
      dirtyBlockRebuildCount: 0,
      mappedRangeCount: 0,
    });
  });

  it("refreshes parser coverage only through the explicit no-history effect", () => {
    const harness = createIndexHarness("Paragraph **bold**.\n");
    const next = harness.state.update({
      effects: refreshMarkdownParseCoverageEffect.of(null),
    }).state;
    expect(next.field(markdownRangeIndexField)).not.toBe(harness.index);
    expect(snapshot(harness.diagnostics)).toMatchObject({
      fullIndexBuildCount: 2,
      parseCoverageRefreshCount: 1,
    });
  });
});

describe("renderer-owned Frontmatter YAML diagnostics", () => {
  it("keeps YAML validation out of markdown-fidelity and offsets renderer diagnostics", () => {
    const valid = findFrontmatterSourceRange("---\ntitle: Valid\n---\n");
    const invalidSource = "---\ntitle: [invalid\n---\n";
    const invalid = findFrontmatterSourceRange(invalidSource);
    const unterminated = findFrontmatterSourceRange("---\ntitle: Missing\n");
    if (!valid || !invalid || !unterminated) {
      throw new Error("Expected Frontmatter ranges.");
    }
    expect(getFrontmatterYamlDiagnostics(valid)).toEqual([]);
    const invalidDiagnostics = getFrontmatterYamlDiagnostics(invalid);
    expect(invalidDiagnostics.length).toBeGreaterThan(0);
    expect(invalidDiagnostics[0]?.from).toBeGreaterThanOrEqual(invalid.contentRange.from);
    expect(getFrontmatterYamlDiagnostics(unterminated)).toEqual([
      {
        code: "frontmatter-unterminated",
        from: 0,
        to: unterminated.fullRange.to,
        severity: "error",
      },
    ]);
  });

  it("returns immutable, exact YAML token ranges and clamps duplicate parse errors", () => {
    const source = [
      "---",
      "# note",
      'title: "Quoted"',
      "defaults: &defaults enabled",
      "copy: *defaults",
      "---",
      "",
    ].join("\n");
    const frontmatter = findFrontmatterSourceRange(source);
    const invalidSource = "---\ntitle: [invalid\n---\n";
    const invalid = findFrontmatterSourceRange(invalidSource);
    if (!frontmatter || !invalid) {
      throw new Error("Expected Frontmatter ranges.");
    }
    const analysis = analyzeFrontmatterYaml(frontmatter);
    expect(Object.isFrozen(analysis)).toBe(true);
    expect(Object.isFrozen(analysis.tokens)).toBe(true);
    expect(new Set(analysis.tokens.map((token) => token.kind))).toEqual(
      new Set(["comment", "key", "string", "anchor", "alias", "scalar"]),
    );
    for (const token of analysis.tokens) {
      expect(token.from).toBeGreaterThanOrEqual(frontmatter.contentRange.from);
      expect(token.to).toBeLessThanOrEqual(frontmatter.contentRange.to);
      expect(source.slice(token.from, token.to)).not.toBe("");
    }

    const diagnostics = analyzeFrontmatterYaml(invalid).diagnostics;
    expect(new Set(diagnostics.map((item) => `${item.from}:${item.to}`)).size).toBe(
      diagnostics.length,
    );
    expect(diagnostics.every((item) => item.from >= invalid.contentRange.from)).toBe(true);
    expect(diagnostics.every((item) => item.to <= invalid.contentRange.to)).toBe(true);
    expect(
      diagnostics.every((item) => invalidSource.slice(item.from, item.to).trim().length > 0),
    ).toBe(true);
  });
});
