import { describe, expect, it, vi } from "vitest";
import { createDocumentState, executeDocumentSave, type SaveOutcome } from "../src/index.ts";

const committed: SaveOutcome = {
  status: "succeeded",
  commit: "committed",
  filePath: "/doc.md",
  warnings: [],
};

describe("document save use case", () => {
  it("submits the normalized checkpoint synchronously and preserves edits made during saving", async () => {
    const document = createDocumentState({
      markdown: "first\r\n",
      savedMarkdown: "",
      filePath: "/doc.md",
    });
    let finish!: (outcome: SaveOutcome) => void;
    const save = vi.fn(
      () =>
        new Promise<SaveOutcome>((resolve) => {
          finish = resolve;
        }),
    );
    const pending = executeDocumentSave(document, save);
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ markdownLf: "first\n", sequence: 1 }),
    );
    document.applyEditorChange("later\n", { kind: "renderer", clientId: "test", sequence: 1 });
    finish(committed);
    await pending;
    expect(document.getSnapshot()).toMatchObject({
      markdown: "later\n",
      savedMarkdown: "first\n",
      isDirty: true,
    });
  });

  it.each(["sync", "async"])("settles a %s adapter exception conservatively", async (kind) => {
    const document = createDocumentState({
      markdown: "text",
      savedMarkdown: "",
      filePath: "/doc.md",
    });
    const settle = vi.spyOn(document, "settleSave");
    const execution = await executeDocumentSave(document, () => {
      if (kind === "sync") throw new Error("transport-lost");
      return Promise.reject(new Error("transport-lost"));
    });
    expect(settle).toHaveBeenCalledOnce();
    expect(execution.outcome).toMatchObject({
      status: "indeterminate",
      commit: "unknown",
      errorCode: "transport-lost",
    });
    expect(document.getSnapshot().persistenceStatus.kind).toBe("verification-required");
  });

  it("does not apply an old save to a replacement document", async () => {
    const document = createDocumentState({ markdown: "old", filePath: "/doc.md" });
    let finish!: (outcome: SaveOutcome) => void;
    const pending = executeDocumentSave(
      document,
      () =>
        new Promise<SaveOutcome>((resolve) => {
          finish = resolve;
        }),
    );
    document.replaceDocument(
      { markdown: "new", filePath: "/new.md" },
      { kind: "command", commandId: "file.open" },
    );
    finish(committed);
    expect((await pending).settlement.status).toBe("stale-generation");
    expect(document.getSnapshot()).toMatchObject({ markdown: "new", filePath: "/new.md" });
  });

  it("does not guess the destination when a save-as adapter throws", async () => {
    const document = createDocumentState({ markdown: "text", filePath: "/old.md" });
    const execution = await executeDocumentSave(
      document,
      () => {
        throw new Error("transport-lost");
      },
      true,
    );
    expect(execution.checkpoint.destination).toEqual({
      kind: "prompt",
      suggestedPath: "/old.md",
    });
    expect(execution.outcome.status).toBe("indeterminate");
    expect(execution.outcome).not.toHaveProperty("candidatePath");
  });
});
