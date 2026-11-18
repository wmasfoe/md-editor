import { describe, expect, it } from "vitest";
import {
  createDocumentState,
  restoreDraftToDocument,
  revertDocumentToSnapshot,
} from "../../src/index.ts";

describe("core session & history revert contracts", () => {
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

const cursorDraft = "# Draft\n\nparagraph two";

function createCursorDoc() {
  return createDocumentState({
    markdown: "# Original",
    savedMarkdown: "# Original",
    filePath: "/notes/cursor.md",
  });
}

describe("restoreDraftToDocument cursor offset contract", () => {
  it("returns the persisted cursor offset so the host can restore the caret", () => {
    const res = restoreDraftToDocument(createCursorDoc(), cursorDraft, { cursorOffset: 5 });
    expect(res.status).toBe("applied");
    expect(res.cursorOffset).toBe(5);
  });

  it("clamps an offset past the draft length to the document end", () => {
    // 草稿可能在退出后被外部编辑变短；越界必须夹取，不能把光标放到文档外。
    const res = restoreDraftToDocument(createCursorDoc(), cursorDraft, { cursorOffset: 9999 });
    expect(res.cursorOffset).toBe(cursorDraft.length);
  });

  it("clamps a negative offset to zero", () => {
    const res = restoreDraftToDocument(createCursorDoc(), cursorDraft, { cursorOffset: -12 });
    expect(res.cursorOffset).toBe(0);
  });

  it("falls back to the document end when no offset was persisted", () => {
    // 旧版本草稿没有 cursorOffset 字段：回退到末尾比回到开头更接近用户预期。
    const res = restoreDraftToDocument(createCursorDoc(), cursorDraft);
    expect(res.cursorOffset).toBe(cursorDraft.length);
  });

  it("treats non-finite offsets as absent instead of producing NaN", () => {
    const res = restoreDraftToDocument(createCursorDoc(), cursorDraft, {
      cursorOffset: Number.NaN,
    });
    expect(res.cursorOffset).toBe(cursorDraft.length);
    expect(Number.isFinite(res.cursorOffset)).toBe(true);
  });
});
