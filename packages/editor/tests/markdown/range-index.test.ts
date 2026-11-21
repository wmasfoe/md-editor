import { markdown } from "@codemirror/lang-markdown";
import { syntaxTree, syntaxTreeAvailable } from "@codemirror/language";
import { EditorSelection, EditorState } from "@codemirror/state";
import { findFrontmatterSourceRange } from "@md-editor/markdown-fidelity";
import { describe, expect, it } from "vitest";
import {
  provideWysiwygDiagnostics,
  WysiwygDiagnostics,
  type WysiwygDiagnosticsSnapshot,
} from "../../src/diagnostics.ts";
import { setEditorModeEffect } from "../../src/mode.ts";
import {
  analyzeFrontmatterYaml,
  getFrontmatterYamlDiagnostics,
} from "../../src/markdown/frontmatter-yaml.ts";
import { M1_MARKDOWN_EXTENSIONS } from "../../src/markdown/extensions.ts";
import {
  getM1MarkdownFixture,
  getM2CodeBlockFixture,
  getM3TableFixture,
} from "../../src/markdown/fixtures.ts";
import {
  buildMarkdownRangeIndex,
  markdownRangeIndexField,
  refreshMarkdownParseCoverageEffect,
  type MarkdownRangeIndex,
} from "../../src/markdown/range-index.ts";
import { compareRecords } from "../../src/markdown/extractors/common.ts";

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
    expect(malformed.byKind("reference-link")).toHaveLength(0);
    expect(malformed.byKind("reference-image")).toHaveLength(0);
    expect(malformed.byKind("inline-code")).toHaveLength(0);

    const singleBracket = createIndexHarness("Here is [1] and [hello] in text.").index;
    expect(singleBracket.byKind("link")).toHaveLength(0);
    expect(singleBracket.byKind("reference-link")).toHaveLength(0);

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

describe("M3 table parser range index", () => {
  it("indexes a newly inserted table and shifts following records after insertion", () => {
    const source = `${"Paragraph text.\n\n".repeat(80)}Tail **bold**.\n`;
    const harness = createIndexHarness(source);
    const insertAt = source.indexOf("Tail");
    const insertion = "| A | B |\n| --- | --- |\n| x | y |\n\n";
    const nextState = harness.state.update({
      changes: { from: insertAt, insert: insertion },
    }).state;
    const next = nextState.field(markdownRangeIndexField);
    const oracle = buildMarkdownRangeIndex(nextState.doc.toString(), syntaxTree(nextState));

    expect(next.byKind("table")).toHaveLength(1);
    expect(next.byKind("bold")[0]?.fullRange.from).toBe(insertAt + insertion.length + 5);
    expect(comparable(next)).toEqual(comparable(oracle));
  });

  it("M3T-U01 builds exact header, delimiter, and body row ranges for an aligned table", () => {
    const fixture = getM3TableFixture("M3T-F01");
    const { index } = createIndexHarness(fixture.markdown);
    const record = index.byKind("table")[0];
    const table = record.tableBlock;

    expect(record).toMatchObject({
      kind: "table",
      renderPolicy: "table-widget",
      editPolicy: "structured",
      interactionPolicy: "structured-block",
      parserCoverage: "complete",
    });
    expect(table).toBeDefined();
    expect(fixture.markdown.slice(table?.headerRowRange?.from, table?.headerRowRange?.to)).toBe(
      "| left | center | right |",
    );
    expect(
      fixture.markdown.slice(table?.delimiterRowRange?.from, table?.delimiterRowRange?.to),
    ).toBe("| :--- | :----: | ---: |");
    expect(
      table?.bodyRowRanges.map((range) => fixture.markdown.slice(range.from, range.to)),
    ).toEqual(["| a | b | c |", "| d | e | f |"]);
    expect(table?.alignments).toEqual(["left", "center", "right"]);
    expect(table?.columnCount).toBe(3);
    expect(table?.bodyRowCount).toBe(2);
    expect(table?.hasLeadingPipes).toBe(true);
    expect(table?.sourceLineFingerprints).toHaveLength(4);
  });

  it("M3T-U02 handles a no-leading-pipes table and still parses column alignments", () => {
    const fixture = getM3TableFixture("M3T-F03");
    const { index } = createIndexHarness(fixture.markdown);
    const table = index.byKind("table")[0].tableBlock;

    expect(table?.hasLeadingPipes).toBe(false);
    expect(table?.alignments).toEqual(["left", "center", "right"]);
    expect(table?.bodyRowCount).toBe(1);
  });

  it("M3T-U03 keeps cell content raw by stopping recursion into Table cells", () => {
    const fixture = getM3TableFixture("M3T-F05");
    const { index } = createIndexHarness(fixture.markdown);

    expect(index.byKind("table")).toHaveLength(1);
    // Cells hold **bold**, *italic*, [link](), `code`. None of them must be
    // promoted into standalone range records because the table claims the block.
    expect(index.byKind("bold")).toEqual([]);
    expect(index.byKind("italic")).toEqual([]);
    expect(index.byKind("link")).toEqual([]);
    expect(index.byKind("inline-code")).toEqual([]);
  });

  it("M3T-U04 keeps unrelated records stable when only a table cell text is edited", () => {
    const fixture = getM3TableFixture("M3T-F05");
    // Trailing blank line keeps the GFM table from extending into the bold paragraph.
    const harness = createIndexHarness(`${fixture.markdown}\nTail **bold**.\n`);
    const beforeTable = harness.index.byKind("table")[0];
    const beforeBold = harness.index.byKind("bold")[0];
    expect(beforeBold).toBeDefined();

    const editAt = fixture.markdown.indexOf("italic") + 1;
    const next = harness.state
      .update({ changes: { from: editAt, insert: "X" } })
      .state.field(markdownRangeIndexField);
    const afterTable = next.byKind("table")[0];
    const afterBold = next.byKind("bold")[0];

    expect(afterTable).toBeDefined();
    expect(afterBold).toBeDefined();
    expect(afterTable.id).not.toBe(beforeTable.id);
    expect(afterTable.sourceFingerprint).not.toBe(beforeTable.sourceFingerprint);
    expect(afterBold.id).toBe(beforeBold.id);
  });

  it("M3T-U05 keeps a zero-body table with only header and delimiter rows", () => {
    const fixture = getM3TableFixture("M3T-F06");
    const { index } = createIndexHarness(fixture.markdown);
    const table = index.byKind("table")[0].tableBlock;

    expect(table?.bodyRowCount).toBe(0);
    expect(table?.bodyRowRanges).toEqual([]);
    expect(table?.headerRowRange).not.toBeNull();
    expect(table?.delimiterRowRange).not.toBeNull();
    expect(table?.sourceLineFingerprints).toHaveLength(2);
  });

  it("M3T-U06 maps table records across body row edits without changing column count", () => {
    const fixture = getM3TableFixture("M3T-F01");
    const harness = createIndexHarness(fixture.markdown);
    const before = harness.index.byKind("table")[0];

    const editAt = fixture.markdown.indexOf("a | b") + 1;
    const next = harness.state
      .update({ changes: { from: editAt, insert: "X" } })
      .state.field(markdownRangeIndexField);
    const after = next.byKind("table")[0];

    expect(after.id).not.toBe(before.id);
    expect(after.tableBlock?.columnCount).toBe(before.tableBlock?.columnCount);
    expect(after.tableBlock?.alignments).toEqual(before.tableBlock?.alignments);
    // Body row counts may differ because the edit is inside the first body row,
    // but column count and alignment metadata must stay stable.
    expect(after.tableBlock?.bodyRowCount).toBe(before.tableBlock?.bodyRowCount);
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

describe("增量更新不得阻塞解析（性能契约）", () => {
  /**
   * 回归锁：`updateMarkdownRangeIndex` 在**每次按键**被调用。
   *
   * 历史缺陷：该路径末尾的 `readCoverage()` 内部无条件调用
   * `ensureSyntaxTree(state, doc.length)` —— 同步全文档解析。实测 800 块文档
   * 每次按键 ~52ms，打字严重掉帧。修复后 `readCoverage` 只读已有语法树
   * （CM 复用未变动子树，`syntaxTree()` 已覆盖全文，取用 ~0.001ms），
   * 「需要补解析」的判断统一收敛到 `requiresCompleteParse`。
   *
   * 断言口径：普通打字（不触碰表格/MDX、覆盖度完整）时，
   * 语法树覆盖度**不应**因为一次按键而扩张 —— 若发生扩张，说明又走了全量解析。
   */
  it("普通打字不降级覆盖度，也不让既有记录退化为 partial", () => {
    // ⚠️ 本用例刻意**不做暖机**：历史版本先插一次做暖机，恰好把「首次建索引
    // 覆盖度停在初始视口（约 3000 字符）」的缺陷掩盖掉了（review 指出）。
    // 首次建索引的覆盖度契约由 coverage.test.ts 的「大文档首次建索引」用例锁定。
    const blocks: string[] = [];
    for (let index = 0; index < 300; index += 1) {
      blocks.push(`## 第 ${index} 节`, "", `正文段落 ${index}。`, "");
    }
    const harness = createIndexHarness(blocks.join("\n"));
    expect(harness.state.doc.length).toBeGreaterThan(3000);

    const initial = harness.index;
    expect(initial.coverage).toEqual({ to: harness.state.doc.length, complete: true });
    const initialPartial = initial.records.filter((r) => r.parserCoverage !== "complete");
    expect(initialPartial).toEqual([]);

    // 在文档中部插入一个字符（普通打字路径，不触及表格/MDX）。
    const middle = Math.floor(harness.state.doc.length / 2);
    const next = harness.state.update({
      changes: { from: middle, insert: "a" },
      selection: EditorSelection.cursor(middle + 1),
    }).state;
    const index = next.field(markdownRangeIndexField);

    // 契约：打字既不得把覆盖度降级，也不得让既有记录退化成 partial
    //（后者会把标题/表格/代码块投影整体打回源码显示）。
    expect(index.coverage).toEqual({ to: next.doc.length, complete: true });
    const partial = index.records.filter((r) => r.parserCoverage !== "complete");
    expect(partial.map((r) => `${r.kind}@${r.fullRange.from}`)).toEqual([]);
    expect(index.byKind("heading-atx")).toHaveLength(300);
  });

  it("索引在增量更新后仍与全量重建等价（正确性锁）", () => {
    const source = Array.from({ length: 40 }, (_, i) => `## S${i}\n\nBody ${i}.\n`).join("\n");
    const harness = createIndexHarness(source);
    const insertAt = source.indexOf("Body 20");
    const nextState = harness.state.update({
      changes: { from: insertAt, insert: "| A | B |\n| --- | --- |\n| 1 | 2 |\n\n" },
    }).state;
    const incremental = nextState.field(markdownRangeIndexField);
    const oracle = buildMarkdownRangeIndex(nextState.doc.toString(), syntaxTree(nextState));
    expect(comparable(incremental)).toEqual(comparable(oracle));
  });
});

describe("首次建索引的覆盖度契约（大文档回归）", () => {
  /**
   * 回归锁：`readCoverageAfterParse` 曾在 `ensureSyntaxTree` 之后仍经
   * `syntaxTree(state)` 读覆盖度。
   *
   * CodeMirror 的语法树有两个**不同步**的视图：`syntaxTree(state)` 是
   * `EditorState.update` 期间由 `takeTree()` 截下的**快照**，而 `ensureSyntaxTree`
   * 只推进会 `LanguageState.context` 并返回新树，**不更新**该快照；
   * `syntaxTreeAvailable` 读的则是已推进的 context。
   *
   * `LanguageState` 初始化只解析 `Work.InitViewport`（约 3000 字符），因此
   * 混用两者会让大文档首次建索引得到 `{ to: ~3000, complete: true }`：
   * 其后的记录全被误判为 `parserCoverage: "partial"`，标题/表格/代码块/列表
   * 投影在打开文档时集体退化为源码。
   *
   * 契约：覆盖度必须与**实际用于建索引的那棵树**同源（`coverageOfTree(tree, ...)`）。
   */
  it("大文档首次建索引后 coverage.to 覆盖全文，且全部标题记录为 complete", () => {
    const parts: string[] = [];
    for (let index = 0; index < 200; index += 1) {
      parts.push(`## 标题 ${index}`, "", `这是第 ${index} 节正文，含**粗体**。`, "");
    }
    const doc = parts.join("\n");
    // 前提自检：必须超过 LanguageState 的初始视口解析量，否则覆盖不到该路径。
    expect(doc.length).toBeGreaterThan(3000);

    const harness = createIndexHarness(doc);
    const index = harness.index;

    expect(index.coverage.complete).toBe(true);
    expect(index.coverage.to).toBe(doc.length);
    // 快照 `syntaxTree(state)` 仍可能停在初始视口 —— 这正是不能拿它当覆盖度依据的原因。
    expect(syntaxTree(harness.state).length).toBeLessThan(doc.length);

    const headings = index.byKind("heading-atx");
    expect(headings).toHaveLength(200);
    const partial = headings.filter((record) => record.parserCoverage !== "complete");
    expect(partial.map((record) => record.fullRange.from)).toEqual([]);
  });
});

/** 抽取与增量复用相关的结构字段（不含 parserCoverage，理由见用例内注释）。 */
function indexStructure(index: MarkdownRangeIndex) {
  return index.records.map((record) => ({
    kind: record.kind,
    from: record.fullRange.from,
    to: record.fullRange.to,
    fingerprint: record.sourceFingerprint,
  }));
}

describe("增量复用：有序归并与覆盖度投影", () => {
  /**
   * 回归锁：`updateMarkdownRangeIndex` 曾用 `insertRecord`（线性插入排序）把
   * 数千条复用记录逐条插入新数组 —— O(n²)。CPU profile 显示 `insertRecord` +
   * `compareRecords` 占每次按键 48ms 中的 74%。改为「复用段 + 重建段」线性归并后
   * 降到 ~8.7ms/键。
   *
   * 该优化依赖两条不变量，必须由测试长期看守：
   * 1. 归并后 records 仍严格按 `compareRecords` 排序；
   * 2. 增量结果与全量重建在「结构」上等价（kind / 区间 / 源码指纹）。
   */
  it("records 在多次编辑后仍严格有序", () => {
    const blocks = Array.from({ length: 80 }, (_, i) => `## S${i}\n\nBody **${i}**.\n`);
    let state = EditorState.create({
      doc: blocks.join("\n"),
      extensions: [markdown({ extensions: M1_MARKDOWN_EXTENSIONS }), markdownRangeIndexField],
    });
    let seed = 987654321;
    const nextRandom = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff);

    for (let step = 0; step < 25; step += 1) {
      const pos = nextRandom() % state.doc.length;
      const insert = ["a", "\n", "## 新增\n", "**x**", "| A | B |\n| --- | --- |\n| 1 | 2 |\n"][
        nextRandom() % 5
      ];
      state = state.update({
        changes: { from: pos, insert },
        selection: EditorSelection.cursor(pos + insert.length),
      }).state;

      const records = state.field(markdownRangeIndexField).records;
      for (let index = 1; index < records.length; index += 1) {
        expect(compareRecords(records[index - 1], records[index])).toBeLessThanOrEqual(0);
      }
    }
  });

  it("增量结果与全量重建结构等价（随机编辑序列）", () => {
    const blocks = Array.from(
      { length: 60 },
      (_, i) => `## S${i}\n\nBody **${i}** 与 \`c${i}\`。\n`,
    );
    let state = EditorState.create({
      doc: blocks.join("\n"),
      extensions: [markdown({ extensions: M1_MARKDOWN_EXTENSIONS }), markdownRangeIndexField],
    });
    let seed = 123456789;
    const nextRandom = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff);
    for (let step = 0; step < 30; step += 1) {
      const pos = nextRandom() % state.doc.length;
      const insert = ["a", "\n", "## 新增\n", "**x**", ""][nextRandom() % 5];
      const deleteLength = nextRandom() % 4 === 0 ? Math.min(3, state.doc.length - pos) : 0;
      state = state.update({
        changes: { from: pos, to: pos + deleteLength, insert },
        selection: EditorSelection.cursor(pos + insert.length),
      }).state;

      const incremental = state.field(markdownRangeIndexField);
      const oracle = buildMarkdownRangeIndex(state.doc.toString(), syntaxTree(state));
      // 不比较 `parserCoverage`：增量路径复用旧记录，旧记录若在上一轮就是 partial
      // 会原样保留，而全量重建按当前完整树重新判定。该差异在本优化之前即存在。
      expect(indexStructure(incremental)).toEqual(indexStructure(oracle));
    }
  });
});

describe("覆盖度不变量（解析预算截断防护）", () => {
  /**
   * 回归锁：`projectCoverage` 曾无条件沿用上一轮的 `complete`，声称
   * `{ to: doc.length, complete: true }`。
   *
   * 缺陷路径（审查指出，本机难以复现但逻辑必然）：`LanguageState.apply` 对每次
   * 编辑只给 20ms 预算（`Work.Apply`），超时即 `takeTree()` 在 `parsedPos` 处截断。
   * 此时 `tree.length < doc.length`，`newDirty` 无法扩到截断点之后，截断点之后的
   * 旧记录被原样保留 —— 而那段源码的结构可能已经整体失效（如在文首输入 `<!--`）。
   *
   * 若仍声明 complete，`parse-progress.ts` 的 `parseCoverageAdvanced()` 两个条件
   * 都不成立，后台解析完成后**永不**派发 refresh ⇒ 过期记录永久残留。
   *
   * 因此锁定核心不变量：**`coverage.complete === true` 时，语法树必须真的覆盖全文**。
   */
  it("coverage.complete 为 true 时语法树必须覆盖全文", () => {
    const blocks = Array.from({ length: 60 }, (_, i) => `## S${i}\n\nBody **${i}**.\n`);
    let state = EditorState.create({
      doc: blocks.join("\n"),
      extensions: [markdown({ extensions: M1_MARKDOWN_EXTENSIONS }), markdownRangeIndexField],
    });

    // 收集所有「声称 complete 但树未覆盖全文」的违例，最后统一断言（避免条件 expect）。
    const violations: string[] = [];
    const assertInvariant = (label: string) => {
      const index = state.field(markdownRangeIndexField);
      if (index.coverage.complete && !syntaxTreeAvailable(state, state.doc.length)) {
        violations.push(label);
      }
    };

    assertInvariant("initial");
    // 多种会让后文失效的编辑：未闭合注释、未闭合围栏、普通插入、结构性删除。
    const edits = [
      { from: 0, insert: "<!--" },
      { from: 0, insert: "```\n" },
      { from: 100, insert: "a" },
      { from: 200, to: 210, insert: "" },
      { from: 0, insert: "## 新标题\n" },
    ];
    for (const [index, edit] of edits.entries()) {
      state = state.update({
        changes: edit,
        selection: EditorSelection.cursor(edit.from + (edit.insert?.length ?? 0)),
      }).state;
      assertInvariant(`edit ${index}`);
    }
    expect(violations).toEqual([]);
  });

  it("records 的 blockRange.from 非递减（二分扩展依赖的不变量）", () => {
    // `expandOldDirtyRange` 用 `blockRange.from` 单调向后扫描并 break。
    // 但 `compareRecords` 排序依据是 `fullRange.from` —— 二者不等价。
    // 该扫描能成立完全依赖「同一顶层块内 records 的 blockRange 相同」这一结构事实。
    // 这里用覆盖 top-level / 嵌套 / frontmatter / MDX 的文档锁定它。
    const marks = [
      "---",
      "title: demo",
      "---",
      "",
      "## 标题一",
      "",
      "段落含**粗体**与 `代码` 以及[链接](x.md)。",
      "",
      "> 引用块",
      "",
      "- 列表 1",
      "- 列表 2",
      "",
      "| A | B |",
      "| --- | --- |",
      "| 1 | 2 |",
      "",
      "```js",
      "const a = 1;",
      "```",
      "",
      "## 标题二",
      "",
      "结尾段落。",
      "",
    ].join("\n");
    const harness = createIndexHarness(marks);
    const { records } = harness.index;
    expect(records.length).toBeGreaterThan(10);
    for (let index = 1; index < records.length; index += 1) {
      expect({
        index,
        previousKind: records[index - 1].kind,
        kind: records[index].kind,
        decreasing: records[index].blockRange.from < records[index - 1].blockRange.from,
      }).toEqual({
        index,
        previousKind: records[index - 1].kind,
        kind: records[index].kind,
        decreasing: false,
      });
    }
  });

  it("增量更新后 blockRange.from 仍非递减（排序不变量在归并后保持）", () => {
    const blocks = Array.from({ length: 40 }, (_, i) => `## S${i}\n\nBody **${i}**.\n`);
    let state = EditorState.create({
      doc: blocks.join("\n"),
      extensions: [markdown({ extensions: M1_MARKDOWN_EXTENSIONS }), markdownRangeIndexField],
    });
    let seed = 55555;
    const nextRandom = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff);
    for (let step = 0; step < 12; step += 1) {
      const pos = nextRandom() % state.doc.length;
      const insert = ["a", "\n", "**x**", "## T\n", ""][nextRandom() % 5];
      state = state.update({
        changes: { from: pos, insert },
        selection: EditorSelection.cursor(pos + insert.length),
      }).state;
      const { records } = state.field(markdownRangeIndexField);
      for (let index = 1; index < records.length; index += 1) {
        expect(records[index].blockRange.from).toBeGreaterThanOrEqual(
          records[index - 1].blockRange.from,
        );
      }
    }
  });
});

/**
 * 覆盖度与记录状态的一致性不变量（廉价防护锁）。
 *
 * ## 为什么需要它
 *
 * `parserCoverage` 是投影的硬开关：`projections/*.ts` 里普遍写
 * `if (record.parserCoverage !== "complete") return []` —— 表格、代码块、HTML、
 * MDX、列表、标题、frontmatter、链接都会因此退回**源码显示**。
 *
 * 记录只有在「建它的那棵树没解析到它末尾」（`fullRange.to > coverage.to`）时才会
 * 被标成 `partial`。于是存在一种自相矛盾且**不会自愈**的状态：
 *
 * > 索引声称 `coverage.complete === true`（整篇都读完了），
 * > 却仍留着 `partial` 记录（那些块永远显示源码）。
 *
 * 一旦这种状态出现，`parse-progress` 的两个刷新条件
 * （`tree.length > coverage.to` 与 `!coverage.complete`）都不成立，
 * 后台解析补齐后也不会触发全量重建，那些块就永久停在源码形态，
 * 直到用户正好编辑到那里。
 *
 * ## 现状
 *
 * 修复「覆盖度双视图混用」之后，实测在 142KB / 708KB / 1.8MB 三档文档 +
 * 各类结构破坏编辑下都**未能**产生 partial 记录，因此这不是当前已知可复现缺陷，
 * 而是防御性约束。加这条锁的成本很低，价值在于：若将来某次改动让该状态变得可达，
 * 这里会立刻失败，而不是等用户发现「表格变成源码」。
 *
 * ## 防止本用例自身空转
 *
 * `check` 在 `coverage.complete === false` 时会跳过断言。若某天解析视口策略变化
 * 导致每次检查时 coverage 都不完整，用例会静默通过——什么都没测到。
 * 因此额外锁定两条：首建索引必须是 `complete`，且循环结束后「实际断言过的次数」
 * 必须大于零。
 *
 * 相关阅读：`src/markdown/coverage.ts` 的文件头（双视图陷阱）。
 */
describe("不变量：coverage.complete 时不得残留 partial 记录", () => {
  it("首次建索引与各类编辑后均无矛盾状态", () => {
    // 尺寸刻意跨过 LanguageState 的初始视口（约 3000 字符），并留出一档更大的文档
    // 以提高「解析预算耗尽」的概率；不做暖机，首建即检查。
    for (const blockCount of [300, 1200]) {
      const parts: string[] = [];
      for (let index = 0; index < blockCount; index += 1) {
        parts.push(
          `## 标题 ${index}`,
          "",
          `正文 ${index}，含**粗体**与 \`代码\`。`,
          "",
          "| A | B |",
          "| --- | --- |",
          `| ${index} | x |`,
          "",
        );
      }
      // 基线只建一次，每类编辑都从**同一个**基线出发：
      // 否则插入「未闭合围栏」之后的编辑都发生在「整篇变成代码块」的文档上，
      // 各类型的覆盖会互相污染（review 指出）。
      const baseline = EditorState.create({
        doc: parts.join("\n"),
        extensions: [markdown({ extensions: M1_MARKDOWN_EXTENSIONS }), markdownRangeIndexField],
      });

      const violations: string[] = [];
      let checked = 0;
      const check = (label: string, state: EditorState) => {
        const index = state.field(markdownRangeIndexField);
        if (!index.coverage.complete) {
          return;
        }
        checked += 1;
        const partial = index.records.filter((record) => record.parserCoverage !== "complete");
        if (partial.length > 0) {
          violations.push(
            `${label}: ${partial.length}/${index.records.length} 条 partial` +
              `（${partial
                .slice(0, 3)
                .map((record) => `${record.kind}@${record.fullRange.from}`)
                .join(", ")}）`,
          );
        }
      };

      // 首建必须是完整覆盖，否则下面的 check 会全部跳过、用例空转。
      expect(baseline.field(markdownRangeIndexField).coverage.complete).toBe(true);
      check(`${blockCount} 块 · 首次建索引`, baseline);

      // `from` 用当前 state 惰性求值：数组在循环前构造，若写成 `state.doc.length`
      // 会被求值成**当时的**长度，插入后就不再是真正的尾部（review 指出）。
      const edits: readonly {
        readonly label: string;
        readonly from: (current: EditorState) => number;
        readonly insert: string;
      }[] = [
        { label: "中部打字", from: (current) => Math.floor(current.doc.length / 2), insert: "a" },
        { label: "插入标题", from: () => 0, insert: "## 新标题\n" },
        { label: "插入未闭合围栏", from: () => 0, insert: "```\n" },
        { label: "插入未闭合注释", from: () => 0, insert: "<!--" },
        { label: "尾部打字", from: (current) => current.doc.length, insert: "z" },
      ];
      for (const edit of edits) {
        const from = edit.from(baseline);
        const next = baseline.update({
          changes: { from, insert: edit.insert },
          selection: EditorSelection.cursor(from + edit.insert.length),
        }).state;
        check(`${blockCount} 块 · ${edit.label}`, next);
      }

      // 防空转：至少要有一条检查真的执行过断言。
      expect(checked).toBeGreaterThan(0);
      expect(violations).toEqual([]);
    }
  });
});
