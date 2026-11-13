import { createDocumentState } from "@md-editor/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useUtoolsDocumentController } from "../../src/utools/use-utools-document-controller.ts";

// Exercise the action use cases without mounting platform UI or scheduling autosave timers.
vi.mock("react", () => ({ useCallback: (callback: unknown) => callback, useEffect: vi.fn() }));
vi.mock("../../src/utools/db-storage", () => ({
  clearLastOpenedFile: vi.fn(),
  saveLastOpenedFile: vi.fn(),
}));
afterEach(() => vi.unstubAllGlobals());

function UseTestController(filePath: string | null = "/doc.md") {
  const writeFile = vi.fn();
  const showSaveDialog = vi.fn(() => null);
  vi.stubGlobal("window", { inkpointNodeBridge: { writeFile }, utools: { showSaveDialog } });
  const document = createDocumentState({ markdown: "unsaved", savedMarkdown: "", filePath });
  const showToast = vi.fn();
  const controller = useUtoolsDocumentController({
    docState: document,
    markdown: "unsaved",
    setMode: vi.fn(),
    setFolder: vi.fn(),
    folderRef: { current: null },
    rendererPorts: null,
    showToast,
  });
  return { document, writeFile, showSaveDialog, showToast, controller };
}

describe("uTools document use cases", () => {
  it("keeps the current document when saving before new fails", async () => {
    const { document, writeFile, controller, showToast } = UseTestController();
    writeFile.mockImplementation(() => {
      throw new Error("disk-full");
    });
    await controller.handleNewFile();
    expect(document.getSnapshot()).toMatchObject({
      markdown: "unsaved",
      filePath: "/doc.md",
      isDirty: true,
    });
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining("disk-full"));
  });

  it("keeps an untitled draft when the save dialog is cancelled", async () => {
    const { document, writeFile, showSaveDialog, controller } = UseTestController(null);
    await controller.handleNewFile();
    expect(showSaveDialog).toHaveBeenCalledOnce();
    expect(writeFile).not.toHaveBeenCalled();
    expect(document.getSnapshot().markdown).toBe("unsaved");
  });

  it("writes the current checkpoint before creating a new document", async () => {
    const { document, writeFile, controller } = UseTestController();
    await controller.handleNewFile();
    expect(writeFile).toHaveBeenCalledWith("/doc.md", "unsaved");
    expect(document.getSnapshot()).toMatchObject({ markdown: "", filePath: null, isDirty: false });
  });
});
