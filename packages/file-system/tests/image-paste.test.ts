import { describe, expect, it } from "vitest";
import {
  appendImageMarkdown,
  defaultAssetsDirectoryForDocument,
  dirname,
  imageAltTextFromFileName,
  joinPath,
  nextAssetFileName,
  planImagePasteTarget,
  resolveAssetsDirectoryForDocument,
  documentStem,
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
      mimeType: "image/png",
    });

    expect(result).toMatchObject({
      ok: false,
      error: "SAVE_FIRST",
    });
  });

  it("plans sibling assets path and Markdown relative path", () => {
    const result = planImagePasteTarget({
      documentPath: "/Users/me/docs/post.md",
      mimeType: "image/png",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(`Expected a valid image paste target, received ${result.error}.`);
    }
    expect(result.value.assetsDirectory).toBe("/Users/me/docs/assets");
    expect(result.value.absolutePath).toContain("/Users/me/docs/assets/");
    expect(result.value.markdownPath).toMatch(/^assets\/.+\.png$/);
  });

  it("avoids immediate filename collisions", () => {
    const first = nextAssetFileName("png", []);
    const second = nextAssetFileName("png", [first]);

    expect(second).toBe(first.replace(".png", "-2.png"));
  });

  it("uses a sanitized preferred image name when provided", () => {
    expect(nextAssetFileName(".PNG", [], "Architecture Diagram 01.png")).toBe(
      "architecture-diagram-01.png",
    );
    expect(
      nextAssetFileName("png", ["architecture-diagram-01.png"], "Architecture Diagram 01.png"),
    ).toBe("architecture-diagram-01-2.png");
  });

  it("derives the default assets directory from the document path", () => {
    expect(defaultAssetsDirectoryForDocument("/Users/me/docs/post.md")).toBe(
      "/Users/me/docs/assets",
    );
  });

  it("resolves custom assets directory with ./ and ../ prefixes", () => {
    expect(resolveAssetsDirectoryForDocument("/Users/me/docs/post.md", "./imgs")).toEqual({
      assetsDirectory: "/Users/me/docs/imgs",
      markdownDirectory: "./imgs",
    });

    expect(resolveAssetsDirectoryForDocument("/Users/me/docs/post.md", "../imgs")).toEqual({
      assetsDirectory: "/Users/me/imgs",
      markdownDirectory: "../imgs",
    });
  });

  it("resolves ${filename} variable in custom assets directory", () => {
    expect(documentStem("/Users/me/docs/my-post.md")).toBe("my-post");

    expect(
      resolveAssetsDirectoryForDocument("/Users/me/docs/my-post.md", "${filename}.assets"),
    ).toEqual({
      assetsDirectory: "/Users/me/docs/my-post.assets",
      markdownDirectory: "my-post.assets",
    });

    expect(
      resolveAssetsDirectoryForDocument("/Users/me/docs/my-post.md", "./${filename}.assets"),
    ).toEqual({
      assetsDirectory: "/Users/me/docs/my-post.assets",
      markdownDirectory: "./my-post.assets",
    });

    expect(
      resolveAssetsDirectoryForDocument("/Users/me/docs/my-post.md", "../${filename}-images"),
    ).toEqual({
      assetsDirectory: "/Users/me/my-post-images",
      markdownDirectory: "../my-post-images",
    });
  });

  it("resolves cross-platform Windows paths correctly", () => {
    expect(resolveAssetsDirectoryForDocument("C:\\Users\\me\\docs\\post.md", "./imgs")).toEqual({
      assetsDirectory: "C:/Users/me/docs/imgs",
      markdownDirectory: "./imgs",
    });

    expect(
      resolveAssetsDirectoryForDocument("C:/Users/me/docs/post.md", "../${filename}.assets"),
    ).toEqual({
      assetsDirectory: "C:/Users/me/post.assets",
      markdownDirectory: "../post.assets",
    });
  });

  it("plans custom assets path and Markdown relative path with ./, ../, and ${filename}", () => {
    const result = planImagePasteTarget({
      documentPath: "/Users/me/docs/article.md",
      mimeType: "image/png",
      assetsDirectory: "./${filename}.assets",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected ok");
    expect(result.value.assetsDirectory).toBe("/Users/me/docs/article.assets");
    expect(result.value.markdownPath).toMatch(/^\.\/article\.assets\/.+\.png$/);
  });
});

describe("image Markdown insertion", () => {
  it("appends image Markdown to an empty document", () => {
    expect(appendImageMarkdown("", "assets/image.png")).toBe("![](assets/image.png)\n");
  });

  it("separates pasted image Markdown from existing text", () => {
    expect(appendImageMarkdown("# Post", "assets/image.png", "diagram")).toBe(
      "# Post\n\n![diagram](assets/image.png)\n",
    );
  });

  it("derives readable alt text from a file name", () => {
    expect(imageAltTextFromFileName("Architecture_Diagram-01.png")).toBe("Architecture Diagram 01");
    expect(imageAltTextFromFileName()).toBe("");
  });
});
