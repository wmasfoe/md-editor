import { markdown } from "@codemirror/lang-markdown";
import { EditorSelection, EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { provideWysiwygDiagnostics, WysiwygDiagnostics } from "../../src/diagnostics.ts";
import { M1_MARKDOWN_EXTENSIONS } from "../../src/markdown/extensions.ts";
import { getM3TableFixture } from "../../src/markdown/fixtures.ts";
import {
  markdownRangeIndexField,
  type MarkdownRangeIndex,
} from "../../src/markdown/range-index.ts";
import { editorModeField } from "../../src/mode.ts";
import {
  configureWysiwygProjectionFeatures,
  inspectWysiwygProjection,
  wysiwygProjectionField,
} from "../../src/wysiwyg/projection-state.ts";
import { serializeTableRow, escapeTableCellText } from "../../src/wysiwyg/table-editing.ts";
import { splitTableRowCells } from "../../src/wysiwyg/table-projection.ts";

interface ProjectionHarness {
  readonly state: EditorState;
  readonly index: MarkdownRangeIndex;
  readonly diagnostics: WysiwygDiagnostics;
}

function createTableHarness(
  doc: string,
  features: readonly ("tables" | "blocks" | "frontmatter")[] = ["tables", "blocks"],
): ProjectionHarness {
  const diagnostics = new WysiwygDiagnostics();
  const state = EditorState.create({
    doc,
    selection: EditorSelection.cursor(doc.length),
    extensions: [
      markdown({ extensions: M1_MARKDOWN_EXTENSIONS }),
      provideWysiwygDiagnostics(diagnostics),
      editorModeField,
      markdownRangeIndexField,
      configureWysiwygProjectionFeatures([...features, "default-atoms", "headings"]),
      wysiwygProjectionField,
    ],
  });
  return { state, index: state.field(markdownRangeIndexField), diagnostics };
}

describe("M3 table projection", () => {
  it("always replaces a table with a single grid widget decoration", () => {
    const fixture = getM3TableFixture("M3T-F01");
    const { state, index } = createTableHarness(fixture.markdown);
    const projection = inspectWysiwygProjection(state);

    const table = index.byKind("table")[0];
    expect(table).toBeDefined();
    expect(projection.layoutDecorationCount).toBeGreaterThan(0);
    expect(projection.atomicRangeCount).toBeGreaterThan(0);
    expect(projection.protectedRanges).toContainEqual({ ...table.fullRange, kind: "table" });
  });

  it("keeps the full table protected even when the cursor is inside the table range", () => {
    const fixture = getM3TableFixture("M3T-F01");
    const { state, index } = createTableHarness(fixture.markdown);
    const table = index.byKind("table")[0];
    const inside = state.update({
      selection: EditorSelection.cursor(table.fullRange.from + 1),
    }).state;
    const projection = inspectWysiwygProjection(inside);

    expect(projection.activeSyntaxIds).not.toContain(table.id);
    expect(projection.protectedRanges).toContainEqual({ ...table.fullRange, kind: "table" });
    expect(projection.layoutDecorationCount).toBeGreaterThan(0);
  });

  it("does not project tables when the tables feature is disabled", () => {
    const fixture = getM3TableFixture("M3T-F01");
    const { state, index } = createTableHarness(fixture.markdown, ["blocks"]);
    const projection = inspectWysiwygProjection(state);

    const table = index.byKind("table")[0];
    expect(table).toBeDefined();
    expect(projection.atomicRangeCount).toBe(0);
  });

  it("projects a table whose body row is missing the closing pipe", () => {
    const source = "| a | b |\n| - | - |\n| 1 |";
    const { state, index } = createTableHarness(source);
    const projection = inspectWysiwygProjection(state);

    const table = index.byKind("table")[0];
    expect(table).toBeDefined();
    expect(projection.protectedRanges).toContainEqual({ ...table.fullRange, kind: "table" });
    expect(projection.layoutDecorationCount).toBeGreaterThan(0);
  });

  it("refuses to add range index records for non-table syntax", () => {
    const incomplete = "Just a header\n| --- |\nno body";
    const { index } = createTableHarness(incomplete);
    expect(index.byKind("table")).toEqual([]);
  });

  it("keeps unrelated records stable when only a body row text is edited", () => {
    const fixture = getM3TableFixture("M3T-F01");
    const { state } = createTableHarness(fixture.markdown);
    const beforeTable = state.field(markdownRangeIndexField).byKind("table")[0];

    const editAt = fixture.markdown.indexOf("a | b") + 1;
    const next = state.update({ changes: { from: editAt, insert: "X" } }).state;
    const afterTable = next.field(markdownRangeIndexField).byKind("table")[0];

    expect(afterTable).toBeDefined();
    expect(afterTable.id).not.toBe(beforeTable.id);
    expect(afterTable.tableBlock?.columnCount).toBe(beforeTable.tableBlock?.columnCount);
    expect(afterTable.tableBlock?.alignments).toEqual(beforeTable.tableBlock?.alignments);
  });
});

describe("M3 table row cell splitting", () => {
  it("splits a leading-pipes row into trimmed cells", () => {
    expect(splitTableRowCells("| a | b | c |", true)).toEqual(["a", "b", "c"]);
  });

  it("keeps escaped pipes inside a cell", () => {
    expect(splitTableRowCells("| a\\|b | c |", true)).toEqual(["a\\|b", "c"]);
  });

  it("handles a row without leading pipes", () => {
    expect(splitTableRowCells("a | b", false)).toEqual(["a", "b"]);
  });

  it("trims surrounding whitespace from cells", () => {
    expect(splitTableRowCells("|  a  |  b  |", true)).toEqual(["a", "b"]);
  });
});

describe("M3 table editing serialization", () => {
  it("serializes leading-pipe rows and escapes cell pipes", () => {
    expect(serializeTableRow(["a", "b|c", "d"], true)).toBe("| a | b\\|c | d |");
    expect(escapeTableCellText("x|y\nz")).toBe("x\\|y z");
  });

  it("serializes rows without leading pipes", () => {
    expect(serializeTableRow(["a", "b"], false)).toBe("a | b");
  });
});
