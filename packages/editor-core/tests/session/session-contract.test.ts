import { describe, expect, it } from "vitest";
import {
  createDocumentState,
  restoreDraftToDocument,
  revertDocumentToSnapshot,
} from "../../src/index.ts";

describe("editor-core session & history revert contracts", () => {
  it("restoreDraftToDocument 成功应用草稿并保持 isDirty 为 true", () => {
    const doc = createDocumentState({
      markdown: "# Original Saved Content",
      savedMarkdown: "# Original Saved Content",
      filePath: "/notes/todo.md",
    });

    expect(doc.getSnapshot().isDirty).toBe(false);

    const draftText = "# Original Saved Content\n\n- Added unsaved draft item";
    const res = restoreDraftToDocument(doc, draftText);

    expect(res.status).toBe("applied");
    const snapshot = doc.getSnapshot();
    expect(snapshot.markdown).toBe(draftText);
    expect(snapshot.savedMarkdown).toBe("# Original Saved Content");
    expect(snapshot.isDirty).toBe(true);
    expect(snapshot.replaceIntent).toBe("same");
  });

  it("revertDocumentToSnapshot 成功回滚到历史版本并保留 replaceIntent 为 same", () => {
    const doc = createDocumentState({
      markdown: "# Current Work in Progress",
      savedMarkdown: "# Current Saved Text",
      filePath: "/notes/blog.md",
    });

    const historicalSnapshot = "# Day 1 Historical Draft";
    const res = revertDocumentToSnapshot(doc, historicalSnapshot);

    expect(res.status).toBe("applied");
    const snapshot = doc.getSnapshot();
    expect(snapshot.markdown).toBe(historicalSnapshot);
    expect(snapshot.replaceIntent).toBe("same");
    expect(snapshot.filePath).toBe("/notes/blog.md");
  });
});
