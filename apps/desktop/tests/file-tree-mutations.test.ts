import { describe, expect, it } from "vitest";
import { findFirstMarkdownPath } from "../src/app/files/file-tree-mutations";

describe("findFirstMarkdownPath", () => {
  it("returns the first Markdown file in breadth-first tree order", () => {
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
    ).toBe("/docs/readme.md");
  });

  it("continues level by level when the current folder level has no Markdown file", () => {
    expect(
      findFirstMarkdownPath({
        name: "docs",
        path: "/docs",
        kind: "directory",
        children: [
          {
            name: "a",
            path: "/docs/a",
            kind: "directory",
            children: [
              {
                name: "deep",
                path: "/docs/a/deep",
                kind: "directory",
                children: [{ name: "deep.md", path: "/docs/a/deep/deep.md", kind: "markdown" }]
              }
            ]
          },
          {
            name: "b",
            path: "/docs/b",
            kind: "directory",
            children: [{ name: "intro.mdx", path: "/docs/b/intro.mdx", kind: "markdown" }]
          }
        ]
      })
    ).toBe("/docs/b/intro.mdx");
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
