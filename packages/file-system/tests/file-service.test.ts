import { describe, expect, it, vi } from "vitest";
import { createFileService, type FileServiceAdapter } from "../src";

describe("FileService", () => {
  it("creates a clean unsaved document", () => {
    const service = createFileService(fakeAdapter());

    expect(service.newDocument("# Draft")).toEqual({
      markdown: "# Draft",
      filePath: null
    });
  });

  it("opens Markdown through the adapter", async () => {
    const service = createFileService(
      fakeAdapter({
        openResult: { filePath: "/Users/me/post.md", markdown: "# Post" }
      })
    );

    await expect(service.openDocument()).resolves.toEqual({
      filePath: "/Users/me/post.md",
      markdown: "# Post"
    });
  });

  it("opens a Markdown folder tree through the adapter", async () => {
    const service = createFileService(
      fakeAdapter({
        folderResult: {
          rootPath: "/Users/me/docs",
          rootName: "docs",
          tree: {
            name: "docs",
            path: "/Users/me/docs",
            kind: "directory",
            children: [
              { name: "index.md", path: "/Users/me/docs/index.md", kind: "markdown" },
              {
                name: "guide",
                path: "/Users/me/docs/guide",
                kind: "directory",
                children: [{ name: "intro.mdx", path: "/Users/me/docs/guide/intro.mdx", kind: "markdown" }]
              }
            ]
          }
        }
      })
    );

    await expect(service.openFolder()).resolves.toMatchObject({
      rootName: "docs",
      tree: {
        children: [
          { name: "index.md", kind: "markdown" },
          {
            name: "guide",
            kind: "directory",
            children: [{ name: "intro.mdx", kind: "markdown" }]
          }
        ]
      }
    });
  });

  it("opens a Markdown document by path through the adapter", async () => {
    const service = createFileService(
      fakeAdapter({
        readResult: { filePath: "/Users/me/docs/index.md", markdown: "# Index" }
      })
    );

    await expect(service.openDocumentAtPath("/Users/me/docs/index.md")).resolves.toEqual({
      filePath: "/Users/me/docs/index.md",
      markdown: "# Index"
    });
  });

  it("saves to the existing path without forcing the dialog", async () => {
    const adapter = fakeAdapter({
      saveResult: { filePath: "/Users/me/post.md", markdown: "# Saved" }
    });
    const service = createFileService(adapter);

    await expect(
      service.saveDocument({ filePath: "/Users/me/post.md", markdown: "# Saved" })
    ).resolves.toEqual({
      filePath: "/Users/me/post.md",
      markdown: "# Saved"
    });
    expect(adapter.saveMarkdownFile).toHaveBeenCalledWith({
      filePath: "/Users/me/post.md",
      markdown: "# Saved"
    });
  });

  it("keeps cancellation explicit so callers do not mark the document saved", async () => {
    const service = createFileService(fakeAdapter({ saveResult: null }));

    await expect(service.saveDocument({ filePath: null, markdown: "# Draft" })).resolves.toBeNull();
  });

  it("forces a dialog for Save As even when the document already has a path", async () => {
    const adapter = fakeAdapter({
      saveResult: { filePath: "/Users/me/copy.md", markdown: "# Copy" }
    });
    const service = createFileService(adapter);

    await service.saveDocumentAs({ filePath: "/Users/me/post.md", markdown: "# Copy" });

    expect(adapter.saveMarkdownFile).toHaveBeenCalledWith({
      filePath: "/Users/me/post.md",
      markdown: "# Copy",
      forceDialog: true
    });
  });
});

function fakeAdapter(options: {
  readonly openResult?: Awaited<ReturnType<FileServiceAdapter["openMarkdownFile"]>>;
  readonly folderResult?: Awaited<ReturnType<FileServiceAdapter["openMarkdownFolder"]>>;
  readonly readResult?: Awaited<ReturnType<FileServiceAdapter["readMarkdownFile"]>>;
  readonly saveResult?: Awaited<ReturnType<FileServiceAdapter["saveMarkdownFile"]>>;
} = {}): FileServiceAdapter {
  return {
    openMarkdownFile: vi.fn(async () => options.openResult ?? null),
    openMarkdownFolder: vi.fn(async () => options.folderResult ?? null),
    readMarkdownFile: vi.fn(async () => options.readResult ?? { filePath: "", markdown: "" }),
    saveMarkdownFile: vi.fn(async () => options.saveResult ?? null)
  };
}
