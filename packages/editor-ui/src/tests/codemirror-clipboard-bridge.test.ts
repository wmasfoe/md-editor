import { createDocumentState } from "@md-editor/editor-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createCodeMirrorEditorBridge,
  type CodeMirrorEditorClipboardWriter,
} from "../components/CodeMirrorEditor/bridge";

const rendererMock = vi.hoisted(() => {
  const calls: unknown[] = [];
  return {
    calls,
    createCodeMirrorRenderer: vi.fn((options: unknown) => {
      calls.push(options);
      return {
        clientId: "renderer:test",
        sync: vi.fn(() => ({ status: "applied" as const })),
        reconcile: vi.fn(() => ({ status: "applied" as const })),
        applyReservedExternalEdit: vi.fn(() => ({ status: "noop" as const })),
        applyMode: vi.fn(() => ({ ok: true as const })),
        rollbackMode: vi.fn(),
        setCodeBlockLineNumbers: vi.fn(() => ({ status: "noop" as const })),
        setHostVisibility: vi.fn(),
        focus: vi.fn(),
        requestMeasure: vi.fn(),
        destroy: vi.fn(),
      };
    }),
  };
});

vi.mock("@md-editor/renderer-codemirror", () => rendererMock);

describe("CodeMirrorEditor clipboard bridge", () => {
  beforeEach(() => {
    rendererMock.calls.length = 0;
    rendererMock.createCodeMirrorRenderer.mockClear();
  });

  it("passes an injected clipboard writer into the renderer options", async () => {
    const written: string[] = [];
    const writer: CodeMirrorEditorClipboardWriter = async (text) => {
      written.push(text);
    };

    const bridge = createCodeMirrorEditorBridge({
      parent: createParent(),
      document: createDocumentState({ markdown: "```ts\nconst x = 1;\n```\n" }),
      writeClipboardText: writer,
      onSyncError: vi.fn(),
      onQueuedExternalEditResult: vi.fn(),
    });

    const options = rendererMock.calls.at(-1) as {
      writeClipboardText?: CodeMirrorEditorClipboardWriter;
    };
    await expect(options.writeClipboardText?.("const x = 1;")).resolves.toBeUndefined();
    expect(written).toEqual(["const x = 1;"]);
    bridge.destroy();
  });

  it("defaults to navigator.clipboard.writeText when no writer is injected", async () => {
    const writeText = vi.fn<CodeMirrorEditorClipboardWriter>(() => Promise.resolve());
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    const bridge = createCodeMirrorEditorBridge({
      parent: createParent(),
      document: createDocumentState({ markdown: "" }),
      onSyncError: vi.fn(),
      onQueuedExternalEditResult: vi.fn(),
    });

    const options = rendererMock.calls.at(-1) as {
      writeClipboardText?: CodeMirrorEditorClipboardWriter;
    };
    await expect(options.writeClipboardText?.("body only")).resolves.toBeUndefined();
    expect(writeText).toHaveBeenCalledWith("body only");
    bridge.destroy();
    vi.unstubAllGlobals();
  });

  it("rejects with a useful error when clipboard writing is unavailable", async () => {
    vi.stubGlobal("navigator", {});

    const bridge = createCodeMirrorEditorBridge({
      parent: createParent(),
      document: createDocumentState({ markdown: "" }),
      onSyncError: vi.fn(),
      onQueuedExternalEditResult: vi.fn(),
    });

    const options = rendererMock.calls.at(-1) as {
      writeClipboardText?: CodeMirrorEditorClipboardWriter;
    };
    await expect(options.writeClipboardText?.("body only")).rejects.toThrow(
      "Clipboard write is unavailable",
    );
    bridge.destroy();
    vi.unstubAllGlobals();
  });
});

function createParent(): HTMLElement {
  return {} as HTMLElement;
}
