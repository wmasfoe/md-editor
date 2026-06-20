import { describe, expect, it } from "vitest";
import { findFirstMarkdownPath } from "../src/app/files/file-tree-mutations";

describe("findFirstMarkdownPath", () => {
  it("returns the first Markdown file in tree order, including nested folders", () => {
    expect(
      findFirstMarkdownPath({
        name: "docs",
        path: "/docs",
        kind: "directory",
        children: [
          { name: "cover.png", path: "/docs/cover.png", kind: "asset" },
          {
            name: "guide",
            path: "/docs/guide",
            kind: "directory",
            children: [{ name: "intro.mdx", path: "/docs/guide/intro.mdx", kind: "markdown" }]
          },
          { name: "readme.md", path: "/docs/readme.md", kind: "markdown" }
        ]
      })
    ).toBe("/docs/guide/intro.mdx");
  });

  it("returns null for a folder without Markdown documents", () => {
    expect(
      findFirstMarkdownPath({
        name: "assets",
        path: "/assets",
        kind: "directory",
        children: [{ name: "cover.png", path: "/assets/cover.png", kind: "asset" }]
      })
    ).toBeNull();
  });
});
