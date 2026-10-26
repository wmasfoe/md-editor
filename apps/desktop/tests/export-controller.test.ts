import { describe, expect, it, vi } from "vitest";
import { copyDocumentAsHtml } from "../src/app/controller/export-controller";

describe("export-controller", () => {
  it("copies rich text html to clipboard using ClipboardItem", async () => {
    let writtenItems: unknown[] = [];
    const writeMock = vi.fn(async (items: unknown[]) => {
      writtenItems = items;
    });

    class MockClipboardItem {
      readonly data: Record<string, unknown>;
      constructor(data: Record<string, unknown>) {
        this.data = data;
      }
    }

    vi.stubGlobal("ClipboardItem", MockClipboardItem);
    vi.stubGlobal("navigator", {
      clipboard: {
        write: writeMock,
      },
    });

    const md = "# Test Title\n\nThis is a **bold** paragraph.";
    const result = await copyDocumentAsHtml(md);

    expect(result).toBe(true);
    expect(writeMock).toHaveBeenCalledOnce();
    expect(writtenItems.length).toBe(1);

    vi.unstubAllGlobals();
  });

  it("falls back to writeText when ClipboardItem is unavailable", async () => {
    let writtenText = "";
    const writeTextMock = vi.fn(async (text: string) => {
      writtenText = text;
    });

    vi.stubGlobal("ClipboardItem", undefined);
    vi.stubGlobal("navigator", {
      clipboard: {
        writeText: writeTextMock,
      },
    });

    const md = "Hello world";
    const result = await copyDocumentAsHtml(md);

    expect(result).toBe(true);
    expect(writeTextMock).toHaveBeenCalledOnce();
    expect(writtenText).toContain("<p>Hello world</p>");

    vi.unstubAllGlobals();
  });
});
