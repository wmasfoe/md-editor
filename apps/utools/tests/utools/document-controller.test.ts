import { createDocumentState } from "@md-editor/core";
import type { CodeMirrorEditorPorts } from "@md-editor/editor";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useUtoolsDocumentController } from "../../src/utools/use-utools-document-controller.ts";

// Exercise the action use cases without mounting platform UI or scheduling autosave timers.
vi.mock("react", () => ({ useCallback: (callback: unknown) => callback, useEffect: vi.fn() }));
vi.mock("../../src/utools/db-storage", () => ({
  clearLastOpenedFile: vi.fn(),
  saveLastOpenedFile: vi.fn(),
}));
beforeEach(() => vi.mocked(useEffect).mockClear());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function UseTestController(
  filePath: string | null = "/doc.md",
  rendererPorts: CodeMirrorEditorPorts | null = null,
) {
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
    rendererPorts,
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
    // Synchronous direct writes may have truncated the file before throwing.
    expect(document.getSnapshot().persistenceStatus.kind).toBe("verification-required");
  });

  it("keeps an untitled draft when the save dialog is cancelled", async () => {
    const { document, writeFile, showSaveDialog, controller } = UseTestController(null);
    await controller.handleNewFile();
    expect(showSaveDialog).toHaveBeenCalledOnce();
    expect(writeFile).not.toHaveBeenCalled();
    expect(document.getSnapshot().markdown).toBe("unsaved");
  });

  it("clears uncertain-write protection after a successful retry", async () => {
    const { document, writeFile, controller } = UseTestController();
    writeFile.mockImplementationOnce(() => {
      throw new Error("disk-full");
    });
    expect(await controller.handleSaveDocument()).toBe(false);
    expect(document.getSnapshot().persistenceStatus.kind).toBe("verification-required");
    expect(await controller.handleSaveDocument()).toBe(true);
    expect(document.getSnapshot()).toMatchObject({
      isDirty: false,
      persistenceStatus: { kind: "verified" },
    });
  });

  it("writes the current checkpoint before creating a new document", async () => {
    const { document, writeFile, controller } = UseTestController();
    await controller.handleNewFile();
    expect(writeFile).toHaveBeenCalledWith("/doc.md", "unsaved");
    expect(document.getSnapshot()).toMatchObject({ markdown: "", filePath: null, isDirty: false });
  });

  it("keeps repeated automatic failures silent and does not flush active input", async () => {
    vi.useFakeTimers();
    const flushPendingEdits = vi.fn();
    const { writeFile, showToast, controller, document } = UseTestController("/doc.md", {
      flushPendingEdits,
    } as unknown as CodeMirrorEditorPorts);
    writeFile.mockImplementation(() => {
      throw new Error("disk-full");
    });
    const scheduleAutosave = vi.mocked(useEffect).mock.calls[0]![0];
    for (let attempt = 0; attempt < 2; attempt += 1) {
      scheduleAutosave();
      await vi.advanceTimersByTimeAsync(600);
    }
    expect(writeFile).toHaveBeenCalledTimes(2);
    expect(showToast).not.toHaveBeenCalled();
    expect(flushPendingEdits).not.toHaveBeenCalled();
    expect(document.getSnapshot().isDirty).toBe(true);
    await controller.handleSaveDocument();
    expect(flushPendingEdits).toHaveBeenCalledOnce();
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining("disk-full"));
  });

  it("reports an unavailable editor before starting image storage", async () => {
    const { controller, showToast, writeFile } = UseTestController();
    const arrayBuffer = vi.fn();
    await controller.handleInsertImageFile({ name: "photo.png", arrayBuffer } as unknown as File);
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining("编辑器尚未就绪"));
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
  });
});
