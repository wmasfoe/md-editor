import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  getDirectoryPath,
  isSameOrChildPath,
  findFirstMarkdownPath,
  collectAncestorDirectoryPaths,
  createDefaultCollapsedDirectoryPaths,
  storageKeyForRoot,
  readCollapsedPaths,
  writeCollapsedPaths,
} from "../src/tree-view-state";

describe("tree-view-state", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    const mockStorage = {
      getItem: vi.fn((key: string) => store.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        store.set(key, String(value));
      }),
      removeItem: vi.fn((key: string) => {
        store.delete(key);
      }),
      clear: vi.fn(() => store.clear()),
      get length() {
        return store.size;
      },
      key: vi.fn(() => null),
    };
    vi.stubGlobal("localStorage", mockStorage);
    vi.stubGlobal("window", { localStorage: mockStorage });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("path utilities", () => {
    it("extracts directory path correctly", () => {
      expect(getDirectoryPath("/docs/sub/readme.md")).toBe("/docs/sub");
      expect(getDirectoryPath("/docs/readme.md")).toBe("/docs");
      expect(getDirectoryPath("/readme.md")).toBe(".");
    });

    it("checks isSameOrChildPath correctly", () => {
      expect(isSameOrChildPath("/docs/sub/readme.md", "/docs")).toBe(true);
      expect(isSameOrChildPath("/docs", "/docs")).toBe(true);
      expect(isSameOrChildPath("/docs", "/docs/")).toBe(true);
      expect(isSameOrChildPath("/other/file.md", "/docs")).toBe(false);
      expect(isSameOrChildPath("/docs-sibling/file.md", "/docs")).toBe(false);
    });
  });

  describe("findFirstMarkdownPath", () => {
    it("finds first markdown at root level", () => {
      const tree = {
        name: "root",
        path: "/root",
        kind: "directory" as const,
        children: [
          { name: "image.png", path: "/root/image.png", kind: "asset" as const },
          { name: "post.md", path: "/root/post.md", kind: "markdown" as const },
        ],
      };
      expect(findFirstMarkdownPath(tree)).toBe("/root/post.md");
    });

    it("finds first markdown inside nested directory", () => {
      const tree = {
        name: "root",
        path: "/root",
        kind: "directory" as const,
        children: [
          {
            name: "sub",
            path: "/root/sub",
            kind: "directory" as const,
            children: [{ name: "intro.md", path: "/root/sub/intro.md", kind: "markdown" as const }],
          },
        ],
      };
      expect(findFirstMarkdownPath(tree)).toBe("/root/sub/intro.md");
    });

    it("returns null if no markdown exists", () => {
      const tree = {
        name: "root",
        path: "/root",
        kind: "directory" as const,
        children: [{ name: "image.png", path: "/root/image.png", kind: "asset" as const }],
      };
      expect(findFirstMarkdownPath(tree)).toBeNull();
    });
  });

  describe("createDefaultCollapsedDirectoryPaths", () => {
    it("collapses all non-ancestor child directories by default", () => {
      const tree = {
        name: "docs",
        path: "/docs",
        kind: "directory" as const,
        children: [
          { name: "readme.md", path: "/docs/readme.md", kind: "markdown" as const },
          {
            name: "drafts",
            path: "/docs/drafts",
            kind: "directory" as const,
            children: [
              { name: "post.md", path: "/docs/drafts/post.md", kind: "markdown" as const },
            ],
          },
          {
            name: "assets",
            path: "/docs/assets",
            kind: "directory" as const,
            children: [
              { name: "cover.png", path: "/docs/assets/cover.png", kind: "asset" as const },
            ],
          },
        ],
      };

      const collapsed = createDefaultCollapsedDirectoryPaths(tree, "/docs/readme.md");
      expect(collapsed).toEqual(new Set(["/docs/assets", "/docs/drafts"]));
    });

    it("keeps only active file ancestors expanded when nested deeply", () => {
      const tree = {
        name: "workspace",
        path: "/workspace",
        kind: "directory" as const,
        children: [
          {
            name: "chapter1",
            path: "/workspace/chapter1",
            kind: "directory" as const,
            children: [
              {
                name: "section",
                path: "/workspace/chapter1/section",
                kind: "directory" as const,
                children: [
                  {
                    name: "intro.md",
                    path: "/workspace/chapter1/section/intro.md",
                    kind: "markdown" as const,
                  },
                ],
              },
              {
                name: "notes",
                path: "/workspace/chapter1/notes",
                kind: "directory" as const,
                children: [],
              },
            ],
          },
          {
            name: "chapter2",
            path: "/workspace/chapter2",
            kind: "directory" as const,
            children: [],
          },
        ],
      };

      const collapsed = createDefaultCollapsedDirectoryPaths(
        tree,
        "/workspace/chapter1/section/intro.md",
      );
      // /workspace is root, /workspace/chapter1 and /workspace/chapter1/section are ancestors
      // so only /workspace/chapter1/notes and /workspace/chapter2 are collapsed
      expect(collapsed).toEqual(new Set(["/workspace/chapter1/notes", "/workspace/chapter2"]));
    });

    it("collapses all child directories when visibleFilePath is null", () => {
      const tree = {
        name: "workspace",
        path: "/workspace",
        kind: "directory" as const,
        children: [
          {
            name: "assets",
            path: "/workspace/assets",
            kind: "directory" as const,
            children: [],
          },
          {
            name: "notes",
            path: "/workspace/notes",
            kind: "directory" as const,
            children: [],
          },
        ],
      };

      const collapsed = createDefaultCollapsedDirectoryPaths(tree, null);
      expect(collapsed).toEqual(new Set(["/workspace/assets", "/workspace/notes"]));
    });
  });

  describe("readCollapsedPaths & writeCollapsedPaths", () => {
    it("persists and reads back collapsed paths with localStorage", () => {
      expect(storageKeyForRoot("/test/root")).toBe("md-editor:file-tree:collapsed:%2Ftest%2Froot");
      expect(readCollapsedPaths("/test/root")).toBeNull();

      writeCollapsedPaths("/test/root", new Set(["/test/root/assets", "/test/root/sub"]));
      const restored = readCollapsedPaths("/test/root");
      expect(restored).toEqual(new Set(["/test/root/assets", "/test/root/sub"]));

      // Empty set removes key
      writeCollapsedPaths("/test/root", new Set());
      expect(readCollapsedPaths("/test/root")).toBeNull();
    });
  });

  describe("collectAncestorDirectoryPaths", () => {
    it("collects ancestors up to root correctly", () => {
      const ancestors = collectAncestorDirectoryPaths("/workspace", "/workspace/docs/sub/file.md");
      expect(ancestors).toEqual(new Set(["/workspace", "/workspace/docs", "/workspace/docs/sub"]));
    });

    it("returns root only when filePath is null", () => {
      const ancestors = collectAncestorDirectoryPaths("/workspace", null);
      expect(ancestors).toEqual(new Set(["/workspace"]));
    });
  });
});
