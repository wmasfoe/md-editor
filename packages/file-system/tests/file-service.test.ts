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
  readonly saveResult?: Awaited<ReturnType<FileServiceAdapter["saveMarkdownFile"]>>;
} = {}): FileServiceAdapter {
  return {
    openMarkdownFile: vi.fn(async () => options.openResult ?? null),
    saveMarkdownFile: vi.fn(async () => options.saveResult ?? null)
  };
}
