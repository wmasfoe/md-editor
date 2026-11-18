import { MermaidWysiwygEditor } from "@visimer/core";
import { expect, it, vi } from "vitest";
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
