import { describe, expect, it } from "vitest";
import {
  appendImageMarkdown,
  dirname,
  joinPath,
  nextAssetFileName,
  planImagePasteTarget
} from "../src";

describe("path helpers", () => {
  it("resolves a directory from a document path", () => {
    expect(dirname("/Users/me/post.md")).toBe("/Users/me");
    expect(dirname("post.md")).toBe(".");
  });

  it("joins path segments with forward slashes", () => {
    expect(joinPath("/Users/me", "docs", "assets")).toBe("/Users/me/docs/assets");
  });
});

describe("image paste target planning", () => {
  it("returns a save-first result for unsaved documents", () => {
    const result = planImagePasteTarget({
      documentPath: null,
      mimeType: "image/png"
    });

    expect(result).toMatchObject({
      ok: false,
      error: "SAVE_FIRST"
    });
  });

  it("plans sibling assets path and Markdown relative path", () => {
    const result = planImagePasteTarget({
      documentPath: "/Users/me/docs/post.md",
      mimeType: "image/png"
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.assetsDirectory).toBe("/Users/me/docs/assets");
      expect(result.value.absolutePath).toContain("/Users/me/docs/assets/");
      expect(result.value.markdownPath).toMatch(/^assets\/.+\.png$/);
    }
  });

  it("avoids immediate filename collisions", () => {
    const first = nextAssetFileName("png", []);
    const second = nextAssetFileName("png", [first]);

    expect(second).toBe(first.replace(".png", "-2.png"));
  });
});

describe("image Markdown insertion", () => {
  it("appends image Markdown to an empty document", () => {
    expect(appendImageMarkdown("", "assets/image.png")).toBe("![](assets/image.png)\n");
  });

  it("separates pasted image Markdown from existing text", () => {
    expect(appendImageMarkdown("# Post", "assets/image.png", "diagram")).toBe(
      "# Post\n\n![diagram](assets/image.png)\n"
    );
  });
});
