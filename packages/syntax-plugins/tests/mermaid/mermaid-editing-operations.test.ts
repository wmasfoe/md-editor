import { describe, expect, it } from "vitest";
import { applyEdits, MermaidWysiwygEditor } from "@visimer/core";

/** Keep the patched dependency's deletion semantics covered independently of DOM rendering. */
describe("Mermaid cascading deletion", () => {
  for (const ending of ["", "\n"]) {
    it(`preserves surviving nodes and reindexes shared edge styles with ${ending ? "a" : "no"} trailing newline`, () => {
      const source =
        [
          "flowchart TD",
          "  A[Alpha] --> B[Beta] --> C[Gamma]",
          "  A --> C",
          "  classDef hot fill:red",
          "  class A,B hot",
          "  style B fill:blue",
          "  linkStyle 0,1,2 stroke:red",
          "  linkStyle 0 stroke:blue",
        ].join("\n") + ending;
      const editor = new MermaidWysiwygEditor({ code: source });
      editor.dispatch({ type: "deleteNode", id: "B" });
      expect(editor.result.flowchart?.nodes.map((node) => [node.id, node.label])).toEqual([
        ["A", "Alpha"],
        ["C", "Gamma"],
      ]);
      expect(editor.result.flowchart?.edges.map((edge) => [edge.source, edge.target])).toEqual([
        ["A", "C"],
      ]);
      expect(editor.code).toContain("class A hot");
      expect(editor.code).toContain("linkStyle 0 stroke:red");
      expect(editor.code).not.toContain("style B");
      expect(editor.code).not.toContain("stroke:blue");
      const deleted = editor.code;
      editor.undo();
      expect(editor.code).toBe(source);
      editor.redo();
      expect(editor.code).toBe(deleted);
    });
  }

  it("keeps the unselected side of a fan when removing one node", () => {
    const editor = new MermaidWysiwygEditor({
      code: "flowchart TD\n A[Alpha] & B[Beta] --> C[Gamma]",
    });
    editor.dispatch({ type: "deleteNode", id: "B" });
    expect(editor.result.flowchart?.edges.map((edge) => [edge.source, edge.target])).toEqual([
      ["A", "C"],
    ]);
    expect(editor.code).toContain("A[Alpha]");
    expect(editor.code).toContain("C[Gamma]");
    expect(editor.code).not.toContain("Beta");
  });

  it("removes adjacent final sequence messages without dropping their surviving participants", () => {
    const source = "sequenceDiagram\n participant B as Beta\n A->>B: first\n B->>C: second";
    const editor = new MermaidWysiwygEditor({ code: source });
    editor.dispatch({ type: "seq.deleteParticipant", id: "B" });
    expect(editor.result.sequence?.participants.map((person) => person.id)).toEqual(["A", "C"]);
    expect(editor.result.sequence?.events).toEqual([]);
    expect(editor.code).not.toContain("Beta");
    const deleted = editor.code;
    editor.undo();
    expect(editor.code).toBe(source);
    editor.redo();
    expect(editor.code).toBe(deleted);
  });

  it("continues rejecting overlapping replacements", () => {
    expect(() =>
      applyEdits("abcdef", [
        { start: 1, end: 4, text: "x" },
        { start: 3, end: 5, text: "" },
      ]),
    ).toThrow("Overlapping text edits");
  });
});
