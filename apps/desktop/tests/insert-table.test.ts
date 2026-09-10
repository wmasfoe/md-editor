import { describe, expect, it } from "vitest";
import { createTableMarkdown } from "../src/app/controller/useDesktopEditorController";

describe("createTableMarkdown", () => {
  it("generates a standard GFM table with default 3 cols and 4 rows", () => {
    const md = createTableMarkdown(3, 4);
    const lines = md.trim().split("\n");

    expect(lines.length).toBe(5); // 1 header + 1 separator + 3 data rows
    expect(lines[0]).toBe("|     |     |     |");
    expect(lines[1]).toBe("| --- | --- | --- |");
    expect(lines[2]).toBe("|     |     |     |");
    expect(lines[3]).toBe("|     |     |     |");
    expect(lines[4]).toBe("|     |     |     |");
  });

  it("handles 1 column and 1 row", () => {
    const md = createTableMarkdown(1, 1);
    const lines = md.trim().split("\n");

    expect(lines.length).toBe(2); // 1 header + 1 separator
    expect(lines[0]).toBe("|     |");
    expect(lines[1]).toBe("| --- |");
  });

  it("handles 2 columns and 3 rows", () => {
    const md = createTableMarkdown(2, 3);
    const lines = md.trim().split("\n");

    expect(lines.length).toBe(4); // 1 header + 1 separator + 2 data rows
    expect(lines[0]).toBe("|     |     |");
    expect(lines[1]).toBe("| --- | --- |");
    expect(lines[2]).toBe("|     |     |");
    expect(lines[3]).toBe("|     |     |");
  });

  it("clamps invalid or minimum rows and cols to at least 1", () => {
    const md = createTableMarkdown(0, 0);
    const lines = md.trim().split("\n");

    expect(lines.length).toBe(2); // 1 header + 1 separator + 0 data rows (clamped to 1 col, 1 row)
    expect(lines[0]).toBe("|     |");
    expect(lines[1]).toBe("| --- |");
  });
});
