import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as FileSystemModule from "@md-editor/file-system";

const store = vi.hoisted(() => ({
  saved: [] as { doc: Record<string, unknown>; draftMarkdown: string }[],
  session: null as Record<string, unknown> | null,
}));

vi.mock("../src/desktop/session-adapter", () => ({
  createDesktopSessionStorageAdapter: () => ({}),
  createDesktopHistoryStorageAdapter: () => ({}),
}));

vi.mock("@md-editor/file-system", async (importOriginal) => {
  const actual = await importOriginal<typeof FileSystemModule>();
  return {
    ...actual,
    createSessionStore: () => ({
      saveActiveSession: async (params: {
        doc: Record<string, unknown>;
        draftMarkdown: string;
      }) => {
        store.saved.push(params);
      },
      loadActiveSession: async () => store.session,
      clearActiveSession: async () => undefined,
      loadDraft: async () => null,
      discardDraft: async () => undefined,
      purgeExpiredDrafts: async () => 0,
    }),
    createHistoryStore: () => ({
      recordSnapshot: async () => undefined,
      listSnapshots: async () => [],
    }),
  };
});

import { saveHotExitSession, checkPendingDraft } from "../src/app/controller/session-controller";

function snapshot(markdown = "# draft\n\nbody") {
  return {
    markdown,
    savedMarkdown: "# saved\n",
    filePath: "/notes/draft.md",
    isDirty: true,
    mode: "wysiwyg",
  } as never;
}

describe("hot exit cursor persistence", () => {
  beforeEach(() => {
    store.saved.length = 0;
    store.session = null;
  });

  it("persists a known caret offset", async () => {
    await saveHotExitSession(snapshot(), 17);
    expect(store.saved[0]?.doc.cursorOffset).toBe(17);
  });

  it("omits the field entirely when the offset is unknown", async () => {
    // 省略与 0 是不同语义：0 是真实位置，省略代表宿主没能记录。
    await saveHotExitSession(snapshot(), null);
    expect("cursorOffset" in (store.saved[0]?.doc ?? {})).toBe(false);
  });

  it("distinguishes a real offset of zero from an unknown one", async () => {
    await saveHotExitSession(snapshot(), 0);
    expect(store.saved[0]?.doc.cursorOffset).toBe(0);
  });

  it("surfaces an absent stored offset as undefined rather than zero", async () => {
    store.session = {
      session: {
        activeDocument: {
          filePath: "/notes/draft.md",
          isUntitled: false,
          draftId: "d1",
          mode: "wysiwyg",
          lastModifiedAt: 1,
        },
      },
      draftMarkdown: "# draft",
    };
    const info = await checkPendingDraft("/notes/draft.md");
    expect(info?.cursorOffset).toBeUndefined();
  });

  it("surfaces a stored offset of zero as zero", async () => {
    store.session = {
      session: {
        activeDocument: {
          filePath: "/notes/draft.md",
          isUntitled: false,
          draftId: "d1",
          cursorOffset: 0,
          mode: "wysiwyg",
          lastModifiedAt: 1,
        },
      },
      draftMarkdown: "# draft",
    };
    const info = await checkPendingDraft("/notes/draft.md");
    expect(info?.cursorOffset).toBe(0);
  });
});
