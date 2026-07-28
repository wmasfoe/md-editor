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
import { getM1MarkdownFixture, getM2CodeBlockFixture } from "./fixtures.ts";
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

describe("M2 code-block parser range index", () => {
  it("M2C-U01 builds exact closed fenced ranges for opening, body, and closing syntax", () => {
    const fixture = getM2CodeBlockFixture("M2C-F01");
    const { index } = createIndexHarness(fixture.markdown);
    const record = index.byKind("deferred-code")[0];
    const codeBlock = record.codeBlock;

    expect(codeBlock).toMatchObject({
      blockKind: "fenced",
      fenceStyle: "backtick",
      blockStatus: "closed",
    });
    expect(
      fixture.markdown.slice(codeBlock?.openingFenceRange?.from, codeBlock?.openingFenceRange?.to),
    ).toBe("```");
    expect(codeBlock?.rawInfoRange).toBeNull();
    expect(codeBlock?.languageTokenRange).toBeNull();
    expect(
      codeBlock?.bodySegments.map((range) => fixture.markdown.slice(range.from, range.to)),
    ).toEqual(["plain body"]);
    expect(
      fixture.markdown.slice(codeBlock?.closingFenceRange?.from, codeBlock?.closingFenceRange?.to),
    ).toBe("```");
    expect(codeBlock?.sourceLineFingerprints).toHaveLength(3);
  });

  it("M2C-U03 preserves raw info, leading token, and untouched suffix ranges", () => {
    const fixture = getM2CodeBlockFixture("M2C-F05");
    const { index } = createIndexHarness(fixture.markdown);
    const codeBlock = index.byKind("deferred-code")[0].codeBlock;

    expect(fixture.markdown.slice(codeBlock?.rawInfoRange?.from, codeBlock?.rawInfoRange?.to)).toBe(
      "ts meta=1 keep",
    );
    expect(
      fixture.markdown.slice(
        codeBlock?.languageTokenRange?.from,
        codeBlock?.languageTokenRange?.to,
      ),
    ).toBe("ts");
    expect(
      fixture.markdown.slice(codeBlock?.infoSuffixRange?.from, codeBlock?.infoSuffixRange?.to),
    ).toBe(" meta=1 keep");
    expect(codeBlock?.languageInfo).toEqual({
      raw: "ts meta=1 keep",
      token: "ts",
      resolvedName: "TypeScript",
    });

    const leadingSpaceFixture = getM2CodeBlockFixture("M2C-F05B");
    const leadingSpaceBlock = createIndexHarness(leadingSpaceFixture.markdown).index.byKind(
      "deferred-code",
    )[0].codeBlock;
    // Lezer keeps spaces after the opening fence outside CodeInfo; token/suffix
    // ranges must therefore be exact parser ranges, not line-regex guesses.
    expect(
      leadingSpaceFixture.markdown.slice(
        leadingSpaceBlock?.rawInfoRange?.from,
        leadingSpaceBlock?.rawInfoRange?.to,
      ),
    ).toBe("ts meta=1");
    expect(
      leadingSpaceFixture.markdown.slice(
        leadingSpaceBlock?.languageTokenRange?.from,
        leadingSpaceBlock?.languageTokenRange?.to,
      ),
    ).toBe("ts");
    expect(
      leadingSpaceFixture.markdown.slice(
        leadingSpaceBlock?.infoSuffixRange?.from,
        leadingSpaceBlock?.infoSuffixRange?.to,
      ),
    ).toBe(" meta=1");
  });

  it("M2C-U01 handles tilde and long fences without treating body fence text as closing syntax", () => {
    const tilde = getM2CodeBlockFixture("M2C-F02");
    const tildeBlock = createIndexHarness(tilde.markdown).index.byKind("deferred-code")[0]
      .codeBlock;
    expect(tildeBlock).toMatchObject({ fenceStyle: "tilde", blockStatus: "closed" });
    expect(
      tilde.markdown.slice(tildeBlock?.openingFenceRange?.from, tildeBlock?.openingFenceRange?.to),
    ).toBe("~~~~");

    const longFence = getM2CodeBlockFixture("M2C-F06");
    const longFenceBlock = createIndexHarness(longFence.markdown).index.byKind("deferred-code")[0]
      .codeBlock;
    expect(
      longFenceBlock?.bodySegments.map((range) => longFence.markdown.slice(range.from, range.to)),
    ).toEqual(["``` remains body"]);
    expect(
      longFence.markdown.slice(
        longFenceBlock?.closingFenceRange?.from,
        longFenceBlock?.closingFenceRange?.to,
      ),
    ).toBe("````");
  });

  it("M2C-U01 distinguishes empty fenced bodies from one blank body line", () => {
    const blank = getM2CodeBlockFixture("M2C-F09");
    const blankBlock = createIndexHarness(blank.markdown).index.byKind("deferred-code")[0]
      .codeBlock;
    expect(
      blankBlock?.bodySegments.map((range) => blank.markdown.slice(range.from, range.to)),
    ).toEqual(["\n"]);
    expect(blankBlock?.bodyEnvelopeRange).toEqual(blankBlock?.bodySegments[0]);

    const empty = getM2CodeBlockFixture("M2C-F09B");
    const emptyBlock = createIndexHarness(empty.markdown).index.byKind("deferred-code")[0]
      .codeBlock;
    expect(emptyBlock?.bodySegments).toEqual([]);
    expect(emptyBlock?.bodyEnvelopeRange).toBeNull();
  });

  it("M2C-U02 builds segmented indented body ranges and structural prefix ranges", () => {
    const fixture = getM2CodeBlockFixture("M2C-F07");
    const { index } = createIndexHarness(fixture.markdown);
    const codeBlock = index.byKind("deferred-code")[0].codeBlock;

    expect(codeBlock).toMatchObject({
      blockKind: "indented",
      fenceStyle: "none",
      blockStatus: "closed",
    });
    expect(
      codeBlock?.bodySegments.map((range) => fixture.markdown.slice(range.from, range.to)),
    ).toEqual(["first\n", "  second"]);
    expect(
      codeBlock?.syntaxIndentRanges.map((range) => fixture.markdown.slice(range.from, range.to)),
    ).toEqual(["    ", "    "]);
    expect(codeBlock?.openingFenceRange).toBeNull();
    expect(codeBlock?.rawInfoRange).toBeNull();
  });

  it("M2C-U02 preserves indented blank lines and nested source prefixes", () => {
    const blank = getM2CodeBlockFixture("M2C-F08");
    const blankBlock = createIndexHarness(blank.markdown).index.byKind("deferred-code")[0]
      .codeBlock;
    expect(
      blankBlock?.bodySegments.map((range) => blank.markdown.slice(range.from, range.to)),
    ).toEqual(["first\n\n", "  second\n", "third"]);
    expect(
      blankBlock?.syntaxIndentRanges.map((range) => blank.markdown.slice(range.from, range.to)),
    ).toEqual(["    ", "    ", "    "]);

    const nested = getM2CodeBlockFixture("M2C-F14");
    const nestedBlock = createIndexHarness(nested.markdown).index.byKind("deferred-code")[0]
      .codeBlock;
    expect(
      nestedBlock?.bodySegments.map((range) => nested.markdown.slice(range.from, range.to)),
    ).toEqual(["  nested\n", "  code"]);
    expect(
      nestedBlock?.syntaxIndentRanges.map((range) => nested.markdown.slice(range.from, range.to)),
    ).toEqual(["      ", "      "]);
  });

  it("M2C-U04 and M2C-U05 classify unclosed and partial fenced fail-open states", () => {
    const unclosed = getM2CodeBlockFixture("M2C-F11");
    const unclosedBlock = createIndexHarness(unclosed.markdown).index.byKind("deferred-code")[0]
      .codeBlock;
    expect(unclosedBlock).toMatchObject({
      blockKind: "fenced",
      blockStatus: "unclosed",
      closingFenceRange: null,
    });

    const oppositeFence = getM2CodeBlockFixture("M2C-F12");
    const oppositeFenceBlock = createIndexHarness(oppositeFence.markdown).index.byKind(
      "deferred-code",
    )[0].codeBlock;
    expect(oppositeFenceBlock?.blockStatus).toBe("unclosed");
    expect(
      oppositeFenceBlock?.bodySegments.map((range) =>
        oppositeFence.markdown.slice(range.from, range.to),
      ),
    ).toEqual(["body\n```\n"]);

    const state = createIndexHarness(getM2CodeBlockFixture("M2C-F01").markdown).state;
    const partial = buildMarkdownRangeIndex(state.doc.toString(), syntaxTree(state), {
      coverage: { to: 4, complete: false },
    }).byKind("deferred-code")[0];
    expect(partial.parserCoverage).toBe("partial");
    expect(partial.codeBlock?.blockStatus).toBe("partial");
  });

  it("M2C-U06 fingerprints source block lines and invalidates edited code-block records", () => {
    const fixture = getM2CodeBlockFixture("M2C-F16");
    const harness = createIndexHarness(fixture.markdown);
    const before = harness.index.byKind("deferred-code")[0];
    expect(
      before.codeBlock?.sourceLineFingerprints.map((line) =>
        fixture.markdown.slice(line.from, line.to),
      ),
    ).toEqual(["```ts", 'const café = "☕️";', "```"]);
    expect(before.codeBlock?.sourceFingerprint).toBe(before.sourceFingerprint);

    const editAt = fixture.markdown.indexOf("café") + "café".length;
    const next = harness.state
      .update({ changes: { from: editAt, insert: "Value" } })
      .state.field(markdownRangeIndexField);
    const after = next.byKind("deferred-code")[0];
    expect(after.id).not.toBe(before.id);
    expect(after.sourceFingerprint).not.toBe(before.sourceFingerprint);
  });

  it("M2C-U07 preserves adjacent unaffected code-block records through local edits", () => {
    const fixture = getM2CodeBlockFixture("M2C-F13");
    const harness = createIndexHarness(fixture.markdown);
    const before = harness.index.byKind("deferred-code");
    expect(before).toHaveLength(2);

    const editAt = fixture.markdown.indexOf("one") + 1;
    const nextState = harness.state.update({ changes: { from: editAt, insert: "X" } }).state;
    const next = nextState.field(markdownRangeIndexField);
    const after = next.byKind("deferred-code");
    expect(after).toHaveLength(2);
    expect(after[0].id).not.toBe(before[0].id);
    expect(after[1].id).toBe(before[1].id);
    expect(
      after[1].codeBlock?.bodySegments.map((range) =>
        nextState.doc.sliceString(range.from, range.to),
      ),
    ).toEqual(
      before[1].codeBlock?.bodySegments.map((range) =>
        fixture.markdown.slice(range.from, range.to),
      ),
    );
    expect(after[1].codeBlock?.bodySegments[0].from).toBe(
      (before[1].codeBlock?.bodySegments[0].from ?? 0) + 1,
    );
  });

  it("M2C-U07 invalidates indented records when only structural indentation changes", () => {
    const fixture = getM2CodeBlockFixture("M2C-F07");
    const harness = createIndexHarness(`${fixture.markdown}\nTail **bold**.\n`);
    const beforeCodeBlock = harness.index.byKind("deferred-code")[0];
    const beforeBold = harness.index.byKind("bold")[0];

    const next = harness.state
      .update({ changes: { from: 0, insert: " " } })
      .state.field(markdownRangeIndexField);
    const afterCodeBlock = next.byKind("deferred-code")[0];
    const afterBold = next.byKind("bold")[0];

    expect(afterCodeBlock.codeBlock?.sourceFingerprint).not.toBe(
      beforeCodeBlock.codeBlock?.sourceFingerprint,
    );
    expect(afterBold.id).toBe(beforeBold.id);
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
