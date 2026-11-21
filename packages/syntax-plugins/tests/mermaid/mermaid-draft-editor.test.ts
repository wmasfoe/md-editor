import { MermaidWysiwygEditor } from "@visimer/core";
import { describe, expect, it, vi } from "vitest";
import { createMermaidDraftEditor } from "../../src/mermaid/mermaid-draft-editor.ts";

it("keeps rejected operations outside the draft's history and preserves redo", async () => {
  const source = "flowchart TD\n  A[Original]\n";
  const onError = vi.fn();
  const onBusy = vi.fn();
  const editor = createMermaidDraftEditor(MermaidWysiwygEditor, {
    source,
    onError,
    onBusy,
    isClosed: () => false,
    validateOperation: () => null,
    validate: async (code) => (code.includes("[Invalid]") ? "Invalid source" : null),
  });
  const onChange = vi.fn();
  editor.on("change", onChange);

  editor.dispatch({ type: "renameNode", id: "A", label: "Approved" });
  await vi.waitFor(() => expect(onBusy).toHaveBeenLastCalledWith(false));
  expect(editor.code).toContain("[Approved]");

  editor.dispatch({ type: "renameNode", id: "A", label: "Invalid" });
  await vi.waitFor(() => expect(onBusy).toHaveBeenLastCalledWith(false));
  expect(onError).toHaveBeenCalledWith("Invalid source");
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(editor.undo()).toBe(true);
  expect(editor.code).toBe(source);
  expect(editor.canUndo).toBe(false);

  editor.dispatch({ type: "renameNode", id: "A", label: "Invalid" });
  await vi.waitFor(() => expect(onBusy).toHaveBeenLastCalledWith(false));
  expect(editor.redo()).toBe(true);
  expect(editor.code).toContain("[Approved]");
});

const SEQUENCE_WITH_BLOCK =
  "sequenceDiagram\n  autonumber\n  participant A\n  participant B\n  A->>B: hi\n  alt old condition\n    B-->>A: yes\n  else other\n    B-->>A: no\n  end\n";

describe("sequence block conditions", () => {
  it("rewrites one branch through the validated draft and stays undoable", async () => {
    const onError = vi.fn();
    const onBusy = vi.fn();
    const editor = createMermaidDraftEditor(MermaidWysiwygEditor, {
      source: SEQUENCE_WITH_BLOCK,
      onError,
      onBusy,
      isClosed: () => false,
      validateOperation: () => null,
      validate: async () => null,
    });

    editor.setBlockCondition(5, "new condition");
    await vi.waitFor(() => expect(onBusy).toHaveBeenLastCalledWith(false));
    expect(onError).not.toHaveBeenCalled();
    expect(editor.code).toContain("  alt new condition\n");
    // 其它行（autonumber、参与者、else 分支）原样保留。
    expect(editor.code).toContain("  autonumber\n");
    expect(editor.code).toContain("  else other\n");

    expect(editor.undo()).toBe(true);
    expect(editor.code).toBe(SEQUENCE_WITH_BLOCK);
  });

  it("keeps the source and reports the error when validation rejects the draft", async () => {
    const onError = vi.fn();
    const editor = createMermaidDraftEditor(MermaidWysiwygEditor, {
      source: SEQUENCE_WITH_BLOCK,
      onError,
      onBusy: vi.fn(),
      isClosed: () => false,
      validateOperation: () => null,
      validate: async (code) => (code.includes("rejected") ? "Invalid condition" : null),
    });

    editor.setBlockCondition(5, "rejected");
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith("Invalid condition"));
    expect(editor.code).toBe(SEQUENCE_WITH_BLOCK);
    expect(editor.canUndo).toBe(false);
  });

  it("ignores line indices that are not a block branch", async () => {
    const editor = createMermaidDraftEditor(MermaidWysiwygEditor, {
      source: SEQUENCE_WITH_BLOCK,
      onError: vi.fn(),
      onBusy: vi.fn(),
      isClosed: () => false,
      validateOperation: () => null,
      validate: async () => null,
    });

    expect(editor.setBlockCondition(4, "message line")).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(editor.code).toBe(SEQUENCE_WITH_BLOCK);
  });

  it("refuses lexer-unsafe conditions and stale keywords, and reports whether it wrote", async () => {
    const editor = createMermaidDraftEditor(MermaidWysiwygEditor, {
      source: SEQUENCE_WITH_BLOCK,
      onError: vi.fn(),
      onBusy: vi.fn(),
      isClosed: () => false,
      validateOperation: () => null,
      validate: async () => null,
    });

    // `#` would be silently truncated as a comment; `;` would split a new statement.
    expect(editor.setBlockCondition(5, "retry #3")).toBe(false);
    expect(editor.setBlockCondition(5, "ok; A->>B: hi")).toBe(false);
    // The line is still `alt`; a snapshot claiming `else` must not write elsewhere.
    expect(editor.setBlockCondition(5, "stale", "else")).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(editor.code).toBe(SEQUENCE_WITH_BLOCK);
    expect(editor.canUndo).toBe(false);

    expect(editor.setBlockCondition(5, "fresh", "alt")).toBe(true);
    await vi.waitFor(() => expect(editor.code).toContain("  alt fresh\n"));
  });
});
