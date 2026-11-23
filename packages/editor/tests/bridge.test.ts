import { createDocumentState, type DocumentState } from "@md-editor/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCodeMirrorEditorBridge, type CodeMirrorEditorClipboardWriter } from "../src/bridge";

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
        applyMode: vi.fn(
          (request: {
            operationId: string;
            mode: "wysiwyg" | "source";
            expectedGeneration: number;
            expectedStateRevision: number;
          }) => ({
            status: "applied" as const,
            receipt: {
              operationId: request.operationId,
              documentGeneration: request.expectedGeneration,
              expectedStateRevision: request.expectedStateRevision,
              previousMode: request.mode === "source" ? "wysiwyg" : "source",
              appliedMode: request.mode,
            },
          }),
        ),
        rollbackMode: vi.fn(),
        flushPendingEdits: vi.fn(() => true),
        setCodeBlockLineNumbers: vi.fn(() => ({ status: "noop" as const })),
        setMarkdownLint: vi.fn(() => ({ status: "noop" as const })),
        setMarkdownLintEngine: vi.fn(),
        configureMarkdownLint: vi.fn(),
        getMarkdownLintState: () => ({ enabled: false, hasEngine: false }),
        recomputeMarkdownLint: vi.fn(() => ({ status: "noop" as const })),
        setHostVisibility: vi.fn(),
        focus: vi.fn(),
        requestMeasure: vi.fn(),
        isComposing: true,
        destroy: vi.fn(),
      };
    }),
  };
});

vi.mock("../src/renderer", () => rendererMock);

describe("CodeMirrorEditor clipboard bridge", () => {
  beforeEach(() => {
    rendererMock.calls.length = 0;
    rendererMock.createCodeMirrorRenderer.mockClear();
  });

  it("accepts custom document states without the optional busy capability and refuses guarded edits", () => {
    const { isMutationBusy: _isMutationBusy, ...legacyState } = createDocumentState({
      markdown: "Legacy custom state",
    });
    // This assignment also checks compatibility for structural implementations.
    const document: DocumentState = legacyState;
    const bridge = createCodeMirrorEditorBridge({
      parent: createParent(),
      document,
      onSyncError: vi.fn(),
      onQueuedExternalEditResult: vi.fn(),
    });
    const options = rendererMock.calls.at(-1) as { isDocumentBusy: () => boolean };
    expect(options.isDocumentBusy()).toBe(true);
    expect(document.getSnapshot().markdown).toBe("Legacy custom state");
    bridge.destroy();
  });

  it("内置 Mod-/：桥接层自己完成源码/所见即所得切换，宿主不必再绑键", () => {
    const document = createDocumentState({ markdown: "# Hello" });
    const bridge = createCodeMirrorEditorBridge({
      parent: createParent(),
      document,
      onSyncError: vi.fn(),
      onQueuedExternalEditResult: vi.fn(),
    });

    // 渲染器拿到的选项里必须带内置实现（renderer 是 mock，所以直接调用它验证协议）
    const options = rendererMock.calls.at(-1) as { onToggleSourceMode?: () => boolean };
    expect(typeof options.onToggleSourceMode).toBe("function");

    expect(document.getSnapshot().mode).toBe("wysiwyg");
    expect(options.onToggleSourceMode?.()).toBe(true);
    expect(document.getSnapshot().mode).toBe("source");
    expect(options.onToggleSourceMode?.()).toBe(true);
    expect(document.getSnapshot().mode).toBe("wysiwyg");

    // 两阶段协议：渲染器先应用 → 核心再 CAS 提交
    expect(rendererMock.calls.length).toBeGreaterThan(0);
    bridge.destroy();
  });

  it("把渲染器的组合输入状态透传给宿主端口（iOS 壳子据此推迟重排与桥接上报）", () => {
    const bridge = createCodeMirrorEditorBridge({
      parent: createParent(),
      document: createDocumentState({ markdown: "拼字\n" }),
      onSyncError: vi.fn(),
      onQueuedExternalEditResult: vi.fn(),
    });

    expect(bridge.ports.isComposing()).toBe(true);
    bridge.destroy();
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
