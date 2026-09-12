import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  createDefaultCollapsedDirectoryPaths,
  collectAncestorDirectoryPaths,
  readCollapsedPaths,
  writeCollapsedPaths,
} from "@md-editor/file-system";

describe("Web File Tree View State & Collapse Persistence", () => {
  const store = new Map<string, string>();

  beforeEach(() => {
    store.clear();
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

  const sampleFolderTree = {
    name: "my-project",
    path: "/my-project",
    kind: "directory" as const,
    children: [
      { name: "README.md", path: "/my-project/README.md", kind: "markdown" as const },
      {
        name: "docs",
        path: "/my-project/docs",
        kind: "directory" as const,
        children: [
          { name: "guide.md", path: "/my-project/docs/guide.md", kind: "markdown" as const },
          {
            name: "advanced",
            path: "/my-project/docs/advanced",
            kind: "directory" as const,
            children: [
              {
                name: "deep.md",
                path: "/my-project/docs/advanced/deep.md",
                kind: "markdown" as const,
              },
            ],
          },
        ],
      },
      {
        name: "assets",
        path: "/my-project/assets",
        kind: "directory" as const,
        children: [
          { name: "logo.png", path: "/my-project/assets/logo.png", kind: "asset" as const },
        ],
      },
    ],
  };

  it("collapses all non-ancestor child folders by default when opening folder with root active file", () => {
    const collapsed = createDefaultCollapsedDirectoryPaths(
      sampleFolderTree,
      "/my-project/README.md",
    );
    // /my-project is root; docs, docs/advanced, assets are all collapsed!
    expect(collapsed.has("/my-project/docs")).toBe(true);
    expect(collapsed.has("/my-project/docs/advanced")).toBe(true);
    expect(collapsed.has("/my-project/assets")).toBe(true);
  });

  it("keeps only active file ancestors expanded when active file is nested", () => {
    const collapsed = createDefaultCollapsedDirectoryPaths(
      sampleFolderTree,
      "/my-project/docs/advanced/deep.md",
    );
    // docs and docs/advanced are ancestors -> expanded (NOT in collapsed)
    expect(collapsed.has("/my-project/docs")).toBe(false);
    expect(collapsed.has("/my-project/docs/advanced")).toBe(false);
    // assets is not an ancestor -> collapsed
    expect(collapsed.has("/my-project/assets")).toBe(true);
  });

  it("persists manual toggles in localStorage and restores them", () => {
    expect(readCollapsedPaths("/my-project")).toBeNull();

    const customCollapsed = new Set(["/my-project/assets"]);
    writeCollapsedPaths("/my-project", customCollapsed);

    const restored = readCollapsedPaths("/my-project");
    expect(restored).toEqual(new Set(["/my-project/assets"]));
  });

  it("calculates ancestor chain to expand collapsed parent directories when switching active file", () => {
    const activeFile = "/my-project/docs/advanced/deep.md";
    const ancestors = collectAncestorDirectoryPaths("/my-project", activeFile);

    expect(ancestors).toEqual(
      new Set(["/my-project", "/my-project/docs", "/my-project/docs/advanced"]),
    );
  });
});
