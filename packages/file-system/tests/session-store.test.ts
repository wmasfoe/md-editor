import { describe, expect, it } from "vitest";
import {
  createMemorySessionStorageAdapter,
  createSessionStore,
  generateDraftId,
  type SessionDocumentEntry,
} from "../src/session/index.ts";

describe("SessionStore (Hot Exit 会话与草稿管理)", () => {
  it("generateDraftId 针对相同路径生成稳定 ID，针对不同路径生成不同 ID", () => {
    const id1 = generateDraftId("/Users/test/note.md");
    const id2 = generateDraftId("/Users/test/note.md");
    const id3 = generateDraftId("/Users/test/other.md");
    const idUntitled = generateDraftId(null);

    expect(id1).toBe(id2);
    expect(id1).not.toBe(id3);
    expect(idUntitled.startsWith("untitled-")).toBe(true);
  });

  it("能原子保存与恢复活动会话及草稿内容", () => {
    const adapter = createMemorySessionStorageAdapter();
    const store = createSessionStore(adapter);

    const doc: SessionDocumentEntry = {
      filePath: "/workspace/doc.md",
      isUntitled: false,
      draftId: generateDraftId("/workspace/doc.md"),
      cursorOffset: 42,
      scrollOffset: 120,
      mode: "wysiwyg",
      lastModifiedAt: Date.now(),
    };
    const draftMarkdown = "# Draft Content\n\nHot exit working!";

    return store
      .saveActiveSession({ doc, draftMarkdown })
      .then(() => store.loadActiveSession())
      .then((res) => {
        expect(res).not.toBeNull();
        expect(res?.session.activeDocument?.filePath).toBe("/workspace/doc.md");
        expect(res?.session.activeDocument?.cursorOffset).toBe(42);
        expect(res?.session.activeDocument?.mode).toBe("wysiwyg");
        expect(res?.draftMarkdown).toBe(draftMarkdown);
      });
  });

  it("清除会话后返回 null", async () => {
    const adapter = createMemorySessionStorageAdapter();
    const store = createSessionStore(adapter);

    const doc: SessionDocumentEntry = {
      filePath: null,
      isUntitled: true,
      draftId: generateDraftId(null),
      cursorOffset: 0,
      lastModifiedAt: Date.now(),
    };

    await store.saveActiveSession({ doc, draftMarkdown: "untitled text" });
    await store.clearActiveSession();

    const res = await store.loadActiveSession();
    expect(res).toBeNull();
  });

  it("discardDraft 能删除草稿并重置对应会话", async () => {
    const adapter = createMemorySessionStorageAdapter();
    const store = createSessionStore(adapter);

    const draftId = generateDraftId("/doc.md");
    const doc: SessionDocumentEntry = {
      filePath: "/doc.md",
      isUntitled: false,
      draftId,
      cursorOffset: 5,
      lastModifiedAt: Date.now(),
    };

    await store.saveActiveSession({ doc, draftMarkdown: "some draft" });
    expect(await store.loadDraft(draftId)).toBe("some draft");

    await store.discardDraft(draftId);
    expect(await store.loadDraft(draftId)).toBeNull();
    expect(await store.loadActiveSession()).toBeNull();
  });
});
