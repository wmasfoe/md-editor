import { describe, expect, it } from "vitest";
import { createDefaultCollapsedDirectoryPaths } from "../src/app/files/file-tree-view-state";

describe("file tree default collapsed state", () => {
  it("collapses unopened child folders by default", () => {
    const collapsedPaths = createDefaultCollapsedDirectoryPaths({
      name: "docs",
      path: "/docs",
      kind: "directory",
      children: [
        { name: "readme.md", path: "/docs/readme.md", kind: "markdown" },
        {
          name: "drafts",
          path: "/docs/drafts",
          kind: "directory",
          children: [{ name: "post.md", path: "/docs/drafts/post.md", kind: "markdown" }]
        },
        {
          name: "assets",
          path: "/docs/assets",
          kind: "directory",
          children: [{ name: "cover.png", path: "/docs/assets/cover.png", kind: "asset" }]
        }
      ]
    }, "/docs/readme.md");

    expect([...collapsedPaths].sort()).toEqual(["/docs/assets", "/docs/drafts"]);
  });

  it("keeps only the active file ancestors expanded", () => {
    const collapsedPaths = createDefaultCollapsedDirectoryPaths({
      name: "docs",
      path: "/docs",
      kind: "directory",
      children: [
        {
          name: "guide",
          path: "/docs/guide",
          kind: "directory",
          children: [
            { name: "intro.md", path: "/docs/guide/intro.md", kind: "markdown" },
            {
              name: "drafts",
              path: "/docs/guide/drafts",
              kind: "directory",
              children: [{ name: "notes.md", path: "/docs/guide/drafts/notes.md", kind: "markdown" }]
            }
          ]
        },
        {
          name: "archive",
          path: "/docs/archive",
          kind: "directory",
          children: [{ name: "old.md", path: "/docs/archive/old.md", kind: "markdown" }]
        }
      ]
    }, "/docs/guide/intro.md");

    expect([...collapsedPaths].sort()).toEqual(["/docs/archive", "/docs/guide/drafts"]);
  });

  it("collapses child folders when the opened folder has no Markdown files", () => {
    const collapsedPaths = createDefaultCollapsedDirectoryPaths({
      name: "assets",
      path: "/assets",
      kind: "directory",
      children: [
        {
          name: "images",
          path: "/assets/images",
          kind: "directory",
          children: [{ name: "cover.png", path: "/assets/images/cover.png", kind: "asset" }]
        },
        {
          name: "exports",
          path: "/assets/exports",
          kind: "directory",
          children: []
        }
      ]
    }, null);

    expect([...collapsedPaths].sort()).toEqual(["/assets/exports", "/assets/images"]);
  });
});
