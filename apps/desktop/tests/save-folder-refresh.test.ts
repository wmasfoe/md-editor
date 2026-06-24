import { describe, expect, it } from "vitest";
import { shouldRefreshFolderAfterSave } from "../src/app/controller/save-folder-refresh";

describe("folder refresh after save", () => {
  it("does not rescan the workspace for an ordinary save", () => {
    expect(
      shouldRefreshFolderAfterSave({
        previousPath: "/notes/draft.md",
        savedPath: "/notes/draft.md"
      })
    ).toBe(false);

    expect(
      shouldRefreshFolderAfterSave({
        previousPath: "/notes/child/draft.md",
        savedPath: "/notes/child/draft.md"
      })
    ).toBe(false);
  });

  it("refreshes after assigning or changing the document path", () => {
    expect(
      shouldRefreshFolderAfterSave({
        previousPath: null,
        savedPath: "/notes/draft.md"
      })
    ).toBe(true);
    expect(
      shouldRefreshFolderAfterSave({
        previousPath: "/notes/draft.md",
        savedPath: "/archive/draft.md"
      })
    ).toBe(true);
  });
});
