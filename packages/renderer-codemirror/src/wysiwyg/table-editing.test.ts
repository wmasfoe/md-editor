import { markdown } from "@codemirror/lang-markdown";
import { EditorSelection, EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { M1_MARKDOWN_EXTENSIONS } from "../markdown/extensions.ts";
import { markdownRangeIndexField } from "../markdown/range-index.ts";
import { editorModeField } from "../mode.ts";
import { configureWysiwygProjectionFeatures, wysiwygProjectionField } from "./projection-state.ts";
import {
  commitTableCell,
  deleteTableBodyRow,
  deleteTableColumn,
  insertTableBodyRow,
  insertTableColumn,
} from "./table-editing.ts";
import { wysiwygChangeProtection } from "./change-protection.ts";

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
});
