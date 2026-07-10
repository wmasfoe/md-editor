import { describe, expect, it, beforeEach } from "vitest";
import {
  createRecentFilesStore,
  type RecentFile,
  type RecentFilesBackend,
} from "../src/recent-files";

describe("RecentFilesStore", () => {
  let store: ReturnType<typeof createRecentFilesStore>;

  beforeEach(() => {
    const memoryStorage = new Map<string, string>();
    const mockStorage: Storage = {
      getItem: (key) => memoryStorage.get(key) ?? null,
      setItem: (key, value) => memoryStorage.set(key, value),
      removeItem: (key) => memoryStorage.delete(key),
      clear: () => memoryStorage.clear(),
      get length() {
        return memoryStorage.size;
      },
      key: (index) => Array.from(memoryStorage.keys())[index] ?? null,
    };
    store = createRecentFilesStore(mockStorage);
  });

  it("starts with empty list", () => {
    expect(store.list()).toEqual([]);
  });

  it("adds files to the list", () => {
    store.add({ path: "/test/file.md", name: "file.md" });
    const files = store.list();

    expect(files).toHaveLength(1);
    expect(files[0].path).toBe("/test/file.md");
    expect(files[0].name).toBe("file.md");
    expect(files[0].lastOpenedAt).toBeGreaterThan(0);
  });

  it("moves existing file to the top when added again", () => {
    store.add({ path: "/test/file1.md", name: "file1.md" });
    store.add({ path: "/test/file2.md", name: "file2.md" });
    store.add({ path: "/test/file1.md", name: "file1.md" });

    const files = store.list();
    expect(files).toHaveLength(2);
    expect(files[0].path).toBe("/test/file1.md");
    expect(files[1].path).toBe("/test/file2.md");
  });

  it("limits to maximum number of files", () => {
    for (let i = 0; i < 15; i++) {
      store.add({ path: `/test/file${i}.md`, name: `file${i}.md` });
    }

    const files = store.list();
    expect(files).toHaveLength(10);
    expect(files[0].path).toBe("/test/file14.md");
  });

  it("removes files by path", () => {
    store.add({ path: "/test/file1.md", name: "file1.md" });
    store.add({ path: "/test/file2.md", name: "file2.md" });
    store.remove("/test/file1.md");

    const files = store.list();
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe("/test/file2.md");
  });

  it("moves existing recent files after a rename without changing their order", async () => {
    await store.add({ path: "/test/file1.md", name: "file1.md" });
    await store.add({ path: "/test/file2.md", name: "file2.md" });

    const previousLastOpenedAt = store.list()[1].lastOpenedAt;
    await store.move("/test/file1.md", {
      path: "/test/renamed.md",
      name: "renamed.md",
    });

    const files = store.list();
    expect(files).toHaveLength(2);
    expect(files[0].path).toBe("/test/file2.md");
    expect(files[1]).toEqual({
      path: "/test/renamed.md",
      name: "renamed.md",
      lastOpenedAt: previousLastOpenedAt,
    });
  });

  it("updates descendant recent files when a directory path changes", async () => {
    await store.add({ path: "/test/docs/child.md", name: "child.md" });
    await store.add({ path: "/test/other.md", name: "other.md" });

    await store.move("/test/docs", {
      path: "/test/notes",
      name: "notes",
    });

    expect(store.list()).toEqual([
      {
        path: "/test/other.md",
        name: "other.md",
        lastOpenedAt: expect.any(Number),
      },
      {
        path: "/test/notes/child.md",
        name: "child.md",
        lastOpenedAt: expect.any(Number),
      },
    ]);
  });

  it("deduplicates the target path when moving a recent file", async () => {
    await store.add({ path: "/test/file1.md", name: "file1.md" });
    await store.add({ path: "/test/file2.md", name: "file2.md" });

    await store.move("/test/file1.md", {
      path: "/test/file2.md",
      name: "file2.md",
    });

    expect(store.list()).toEqual([
      {
        path: "/test/file2.md",
        name: "file2.md",
        lastOpenedAt: expect.any(Number),
      },
    ]);
  });

  it("ignores move requests for files outside the recent list", async () => {
    await store.add({ path: "/test/file1.md", name: "file1.md" });

    await store.move("/test/missing.md", {
      path: "/test/renamed.md",
      name: "renamed.md",
    });

    expect(store.list()).toHaveLength(1);
    expect(store.list()[0].path).toBe("/test/file1.md");
  });

  it("keeps existing names for descendant files when moving a directory", async () => {
    await store.add({ path: "/test/docs/child.md", name: "child.md" });

    await store.move("/test/docs", {
      path: "/test/archive",
      name: "archive",
    });

    expect(store.list()[0].name).toBe("child.md");
  });

  it("clears all files", () => {
    store.add({ path: "/test/file1.md", name: "file1.md" });
    store.add({ path: "/test/file2.md", name: "file2.md" });
    store.clear();

    expect(store.list()).toEqual([]);
  });

  it("persists data across store instances", () => {
    const memoryStorage = new Map<string, string>();
    const mockStorage: Storage = {
      getItem: (key) => memoryStorage.get(key) ?? null,
      setItem: (key, value) => memoryStorage.set(key, value),
      removeItem: (key) => memoryStorage.delete(key),
      clear: () => memoryStorage.clear(),
      get length() {
        return memoryStorage.size;
      },
      key: (index) => Array.from(memoryStorage.keys())[index] ?? null,
    };

    const store1 = createRecentFilesStore(mockStorage);
    store1.add({ path: "/test/file.md", name: "file.md" });

    const store2 = createRecentFilesStore(mockStorage);
    const files = store2.list();

    expect(files).toHaveLength(1);
    expect(files[0].path).toBe("/test/file.md");
  });

  it("listAuthoritative falls back to stored list off-Tauri", async () => {
    store.add({ path: "/test/file1.md", name: "file1.md" });
    store.add({ path: "/test/file2.md", name: "file2.md" });

    // Without a Tauri backend, the authoritative list must equal the local one
    // so the same index the menu carries still resolves to the right path.
    const authoritative = await store.listAuthoritative();
    expect(authoritative).toEqual(store.list());
    expect(authoritative[0].path).toBe("/test/file2.md");
  });

  it("keeps the native recent-file source and menu synchronized", async () => {
    const nativeFiles: RecentFile[][] = [];
    let menuUpdates = 0;
    const backend: RecentFilesBackend = {
      load: async () => nativeFiles.at(-1) ?? [],
      save: async (files) => {
        nativeFiles.push([...files]);
      },
      updateMenu: async () => {
        menuUpdates += 1;
      },
    };
    const synchronizedStore = createRecentFilesStore(undefined, backend);

    await synchronizedStore.add({ path: "/test/file.md", name: "file.md" });
    expect(await synchronizedStore.listAuthoritative()).toEqual(synchronizedStore.list());

    await synchronizedStore.clear();
    expect(synchronizedStore.list()).toEqual([]);
    expect(nativeFiles.at(-1)).toEqual([]);
    expect(menuUpdates).toBe(2);
  });

  it("surfaces native persistence failures without losing the local update", async () => {
    const synchronizedStore = createRecentFilesStore(undefined, {
      load: async () => [],
      save: async () => {
        throw new Error("native write failed");
      },
      updateMenu: async () => undefined,
    });

    await expect(synchronizedStore.add({ path: "/test/file.md", name: "file.md" })).rejects.toThrow(
      "native write failed",
    );
    expect(synchronizedStore.list()).toHaveLength(1);
  });
});
