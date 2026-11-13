import { createDocumentState } from "@md-editor/core";
import { describe, expect, it, vi } from "vitest";
import type { ExternalEditRequest } from "../src/renderer/types.ts";
import { prepareImageInsertion } from "../src/image-insertion.ts";

function setup(markdown = "Hello world", from = 6, to = 11) {
  const document = createDocumentState({ markdown, savedMarkdown: markdown });
  const apply = vi.fn((_request: ExternalEditRequest) => ({ status: "noop" as const }));
  const renderer = { getSelectionSnapshot: () => ({ from, to }), flushPendingEdits: () => false };
  const prepare = (layout?: "inline" | "block") =>
    prepareImageInsertion(document, renderer, apply, { layout });
  return { document, apply, prepare };
}

describe("editor-owned image insertion", () => {
  it("replaces the captured selection and places the caret in the same transaction", () => {
    const { prepare, apply } = setup();
    prepare()({ src: "assets/a.png", alt: "photo" });
    expect(apply).toHaveBeenCalledWith(
      expect.objectContaining({
        markdown: "Hello ![photo](assets/a.png)",
        selection: { anchor: 28 },
      }),
    );
  });

  it("escapes Markdown and supports explicit block spacing", () => {
    const { prepare, apply } = setup("ab", 1, 1);
    prepare("block")({ src: "assets/a (1).png", alt: "[x]" });
    expect(apply.mock.calls[0]?.[0]).toMatchObject({
      markdown: "a\n\n![\\[x\\]](assets/a%20%281%29.png)\n\nb",
    });
  });

  it.each(["edit", "replace"])("rejects a stale insertion after a document %s", (kind) => {
    const { document, prepare, apply } = setup();
    const insert = prepare();
    if (kind === "edit")
      document.applyEditorChange("new", { kind: "renderer", clientId: "test", sequence: 1 });
    else document.replaceDocument({ markdown: "new" }, { kind: "command", commandId: "file.new" });
    expect(insert({ src: "a.png", alt: "" }).status).toBe("stale");
    expect(apply).not.toHaveBeenCalled();
  });

  it("never applies the same prepared insertion twice", () => {
    const { prepare, apply } = setup();
    const insert = prepare();
    insert({ src: "a.png", alt: "" });
    expect(insert({ src: "b.png", alt: "" }).status).toBe("cancelled");
    expect(apply).toHaveBeenCalledOnce();
  });

  it("rejects relative image paths prepared for a different document path", () => {
    const { document, prepare, apply } = setup();
    const insert = prepare();
    const snapshot = document.getSnapshot();
    document.setDocumentPath({
      filePath: "/other.md",
      expectedGeneration: snapshot.documentGeneration,
      expectedStateRevision: snapshot.stateRevision,
      origin: { kind: "command", commandId: "file.saveAs" },
    });
    expect(insert({ src: "assets/a.png", alt: "" }).status).toBe("stale");
    expect(apply).not.toHaveBeenCalled();
  });
});
