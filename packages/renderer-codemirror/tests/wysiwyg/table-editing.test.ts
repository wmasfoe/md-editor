import { markdown } from "@codemirror/lang-markdown";
import { EditorSelection, EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { M1_MARKDOWN_EXTENSIONS } from "../../src/markdown/extensions.ts";
import { markdownRangeIndexField } from "../../src/markdown/range-index.ts";
import { editorModeField } from "../../src/mode.ts";
import {
  configureWysiwygProjectionFeatures,
  wysiwygProjectionField,
} from "../../src/../src/wysiwyg/projection-state.ts";
import {
  commitTableCell,
  deleteTableBodyRow,
  deleteTableColumn,
  exitTableWithParagraph,
  insertTableBodyRow,
  insertTableColumn,
  setTableColumnAlignment,
} from "../../src/../src/wysiwyg/table-editing.ts";
import { wysiwygChangeProtection } from "../../src/../src/wysiwyg/change-protection.ts";

function createView(doc: string): { view: EditorView; getState: () => EditorState } {
  let state = EditorState.create({
    doc,
    selection: EditorSelection.cursor(doc.length),
    extensions: [
      markdown({ extensions: M1_MARKDOWN_EXTENSIONS, addKeymap: false }),
      editorModeField,
      markdownRangeIndexField,
      configureWysiwygProjectionFeatures(["tables"]),
      wysiwygProjectionField,
      wysiwygChangeProtection,
    ],
  });
  const view = {
    get state() {
      return state;
    },
    dispatch(spec: Parameters<EditorState["update"]>[0] | ReturnType<EditorState["update"]>) {
      state = ("state" in spec && spec.state ? spec : state.update(spec as never)).state;
    },
  } as unknown as EditorView;
  return {
    view,
    getState: () => state,
  };
}

describe("table cell / structure editing", () => {
  it("commits a body cell edit into GFM source through protected authorization", () => {
    const doc = "| a | b |\n| - | - |\n| 1 | 2 |";
    const { view, getState } = createView(doc);
    const table = getState().field(markdownRangeIndexField).byKind("table")[0];
    expect(
      commitTableCell(
        view,
        { recordId: table.id, rowKind: "body", rowIndex: 0, colIndex: 1 },
        "edited",
      ),
    ).toBe(true);
    expect(getState().doc.toString()).toBe("| a | b |\n| - | - |\n| 1 | edited |");
  });

  it("escapes pipes written into a cell", () => {
    const doc = "| a | b |\n| - | - |\n| 1 | 2 |";
    const { view, getState } = createView(doc);
    const table = getState().field(markdownRangeIndexField).byKind("table")[0];
    commitTableCell(
      view,
      { recordId: table.id, rowKind: "header", rowIndex: 0, colIndex: 0 },
      "x|y",
    );
    expect(getState().doc.toString().startsWith("| x\\|y | b |")).toBe(true);
  });

  it("inserts and deletes body rows", () => {
    const doc = "| a | b |\n| - | - |\n| 1 | 2 |";
    const { view, getState } = createView(doc);
    let table = getState().field(markdownRangeIndexField).byKind("table")[0];
    expect(insertTableBodyRow(view, table.id, 0)).toBe(true);
    const afterInsert = getState().doc.toString();
    expect(afterInsert.split("\n").length).toBeGreaterThan(3);
    table = getState().field(markdownRangeIndexField).byKind("table")[0];
    expect(table).toBeDefined();
    expect(table.tableBlock?.bodyRowCount).toBe(2);
    expect(deleteTableBodyRow(view, table.id, 1)).toBe(true);
    expect(getState().doc.toString()).toContain("| 1 | 2 |");
    table = getState().field(markdownRangeIndexField).byKind("table")[0];
    expect(table).toBeDefined();
    expect(table.tableBlock?.bodyRowCount).toBe(1);
  });

  it("inserts and deletes columns across header, delimiter, and body", () => {
    const doc = "| a | b |\n| - | - |\n| 1 | 2 |";
    const { view, getState } = createView(doc);
    let table = getState().field(markdownRangeIndexField).byKind("table")[0];
    expect(insertTableColumn(view, table.id, 1)).toBe(true);
    table = getState().field(markdownRangeIndexField).byKind("table")[0];
    expect(table.tableBlock?.columnCount).toBe(3);
    expect(getState().doc.toString()).toMatch(/\| a \|  \| b \|/);
    expect(deleteTableColumn(view, table.id, 1)).toBe(true);
    table = getState().field(markdownRangeIndexField).byKind("table")[0];
    expect(table.tableBlock?.columnCount).toBe(2);
  });

  it("refuses to delete the last remaining column", () => {
    const doc = "| a |\n| - |\n| 1 |";
    const { view, getState } = createView(doc);
    const table = getState().field(markdownRangeIndexField).byKind("table")[0];
    expect(deleteTableColumn(view, table.id, 0)).toBe(false);
    expect(getState().doc.toString()).toBe(doc);
  });

  it("switches a column alignment by rewriting its delimiter marker", () => {
    const doc = "| a | b |\n| - | - |\n| 1 | 2 |";
    const { view, getState } = createView(doc);
    const table = getState().field(markdownRangeIndexField).byKind("table")[0];
    expect(setTableColumnAlignment(view, table.id, 1, "center")).toBe(true);
    const afterCenter = getState().doc.toString();
    expect(afterCenter).toBe("| a | b |\n| - | :---: |\n| 1 | 2 |");
    let fresh = getState().field(markdownRangeIndexField).byKind("table")[0];
    expect(fresh.tableBlock?.alignments[1]).toBe("center");

    // 再切回无对齐：`:-:` → `---`（GFM 允许任意 ≥1 个 `-`），其余单元格内容不受影响。
    expect(setTableColumnAlignment(view, fresh.id, 1, "none")).toBe(true);
    expect(getState().doc.toString()).toBe("| a | b |\n| - | --- |\n| 1 | 2 |");
    fresh = getState().field(markdownRangeIndexField).byKind("table")[0];
    expect(fresh.tableBlock?.alignments[1]).toBe("none");
  });

  it("ignores alignment changes for out-of-range columns", () => {
    const doc = "| a | b |\n| - | - |\n| 1 | 2 |";
    const { view, getState } = createView(doc);
    const table = getState().field(markdownRangeIndexField).byKind("table")[0];
    expect(setTableColumnAlignment(view, table.id, 5, "left")).toBe(false);
    expect(getState().doc.toString()).toBe(doc);
  });

  it("exits the table with a new paragraph after the last row (document end)", () => {
    const doc = "| a | b |\n| - | - |\n| 1 | 2 |";
    const { view, getState } = createView(doc);
    const table = getState().field(markdownRangeIndexField).byKind("table")[0];
    expect(exitTableWithParagraph(view, table.id)).toBe(true);
    expect(getState().doc.toString()).toBe(`${doc}\n\n`);
    expect(getState().selection.main.head).toBe(doc.length + 2);
  });

  it("inserts a fresh paragraph line after the table's blank separator", () => {
    const doc = "| a | b |\n| - | - |\n| 1 | 2 |\n\nnext paragraph";
    const { view, getState } = createView(doc);
    const table = getState().field(markdownRangeIndexField).byKind("table")[0];
    expect(exitTableWithParagraph(view, table.id)).toBe(true);
    // 终止空行保留不动（它保护表格不被 GFM 吞并），新空行 + 分隔空行插在其后。
    expect(getState().doc.toString()).toBe("| a | b |\n| - | - |\n| 1 | 2 |\n\n\n\nnext paragraph");
    expect(getState().selection.main.head).toBe(31);
  });

  it("keeps the blank terminator and continues the paragraph on a fresh line below it", () => {
    const doc = [
      "Before table.",
      "",
      "| Header A | Header B |",
      "| --- | --- |",
      "| 1 | 2 |",
      "| 3 | 4x |",
      "",
      "After table.",
      "",
    ].join("\n");
    const { view, getState } = createView(doc);
    const table = getState().field(markdownRangeIndexField).byKind("table")[0];
    expect(exitTableWithParagraph(view, table.id)).toBe(true);
    const head = getState().selection.main.head;
    // 光标落在新空行上；打字不再吞掉终止空行，表格范围保持稳定。
    const typed = getState().update({
      changes: { from: head, to: head, insert: "Tail" },
      userEvent: "input.type",
    }).state;
    expect(typed.doc.toString()).toBe(
      [
        "Before table.",
        "",
        "| Header A | Header B |",
        "| --- | --- |",
        "| 1 | 2 |",
        "| 3 | 4x |",
        "",
        "Tail",
        "",
        "After table.",
        "",
      ].join("\n"),
    );
  });
});
