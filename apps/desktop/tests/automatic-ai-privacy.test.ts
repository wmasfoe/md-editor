// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const listeners = new Set<(event: unknown) => void>();
  return {
    listeners,
    settings: null as unknown,
    exposePorts: null as null | ((ports: unknown) => void),
    snapshot: {
      markdown: "This document is long enough to be eligible for background document distillation.",
      filePath: "/notes/current.md",
      mode: "wysiwyg",
    },
    predict: vi.fn(),
    distill: vi.fn(),
    abort: vi.fn(),
    getOrExtract: vi.fn(() => ({})),
  };
});

vi.mock("@md-editor/editor-ui", () => ({
  CodeMirrorEditor: (props: { onRendererPortsChange: (ports: unknown) => void }) => {
    mocks.exposePorts = props.onRendererPortsChange;
    return null;
  },
  resolveCodeFontStack: () => "monospace",
  resolveProseFontStack: () => "serif",
}));
vi.mock("@md-editor/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@md-editor/syntax-plugins", () => ({
  containerDirectivePlugin: { id: "container" },
  highlightPlugin: { id: "highlight" },
  mathPlugin: { id: "math" },
  mermaidPlugin: { id: "mermaid" },
}));
vi.mock("@md-editor/ai", () => ({ shouldSkipAutoGec: () => false }));
vi.mock("../src/app/ai/desktop-ai-service", () => ({
  desktopAiService: {
    predictUnifiedEdit: mocks.predict,
    scheduleDistillation: mocks.distill,
    abort: mocks.abort,
    documentContext: { getOrExtract: mocks.getOrExtract },
  },
}));
vi.mock("../src/app/runtime/editor-runtime", () => ({
  runtime: {
    document: {
      getSnapshot: () => mocks.snapshot,
      subscribeTransitions: (listener: (event: unknown) => void) => {
        mocks.listeners.add(listener);
        return () => mocks.listeners.delete(listener);
      },
    },
  },
}));
vi.mock("../src/app/settings-context", () => ({
  useAppSettings: () => ({ settings: mocks.settings }),
}));
vi.mock("../src/app/document-store", () => ({ useDocumentSnapshot: () => mocks.snapshot }));
vi.mock("../src/app/context/DesktopEditorActionsContext", () => ({
  useDesktopEditorActions: () => ({
    openWysiwygLink: vi.fn(),
    dispatchCommand: vi.fn(),
    refreshFolderForDocumentPath: vi.fn(),
  }),
}));
vi.mock("../src/lib/markdown-preview", () => ({ resolvePreviewImageSrc: vi.fn() }));
vi.mock("../src/app/events/drop-image-listener", () => ({ bindDropImageListener: () => () => {} }));
vi.mock("../src/app/events/paste-image-listener", () => ({
  bindPasteImageListener: () => () => {},
}));
vi.mock("../src/app/stores/confirmation-store", () => ({
  useConfirmationStore: { getState: vi.fn() },
}));

import { DesktopCodeMirrorEditor } from "../src/components/DesktopCodeMirrorEditor";

function makeSettings(backgroundProcessing: boolean) {
  return {
    ai: {
      enabled: true,
      provider: "openai",
      features: { editing: true, continuation: true, backgroundProcessing },
      endpoints: { openai: { apiKey: "test-key" } },
    },
    shortcuts: [],
    assetsDirectory: "assets",
    plugins: { enabled: {} },
    editor: {
      wysiwygFontSize: 16,
      proseFontFamily: "serif",
      codeFontFamily: "monospace",
    },
  };
}

const ports = {
  setFormattingKeymaps: vi.fn(),
  dismissSuggestion: vi.fn(),
  getSuggestion: vi.fn(() => null),
  getSelectionSnapshot: vi.fn(() => ({ from: 40, to: 40, head: 40 })),
  showSuggestion: vi.fn(),
};

let root: Root;

function render(backgroundProcessing: boolean) {
  mocks.settings = makeSettings(backgroundProcessing);
  act(() => root.render(createElement(DesktopCodeMirrorEditor, { showToast: () => {} })));
}

function typeInEditor() {
  act(() => {
    for (const listener of mocks.listeners) {
      listener({ transition: { kind: "content", origin: { kind: "renderer" } } });
    }
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  mocks.listeners.clear();
  mocks.exposePorts = null;
  vi.clearAllMocks();
  mocks.distill.mockReturnValue(new Promise(() => {}));
  mocks.predict.mockReturnValue(new Promise(() => {}));
  root = createRoot(document.createElement("div"));
});

afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("desktop automatic AI privacy switch", () => {
  it("does not register or start background work while disabled", async () => {
    render(false);
    expect(mocks.listeners.size).toBe(0);
    typeInEditor();
    await act(async () => vi.advanceTimersByTimeAsync(10_000));
    expect(mocks.getOrExtract).not.toHaveBeenCalled();
    expect(mocks.distill).not.toHaveBeenCalled();
    expect(mocks.predict).not.toHaveBeenCalled();
  });

  it("only schedules distillation and suggestions after explicit opt-in", async () => {
    render(false);
    act(() => mocks.exposePorts?.(ports));
    render(true);
    typeInEditor();
    await act(async () => vi.advanceTimersByTimeAsync(600));
    expect(mocks.predict).toHaveBeenCalledTimes(1);
    expect(mocks.distill).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(7_400));
    expect(mocks.distill).toHaveBeenCalledTimes(1);
  });

  it("cancels timers and only distillation tasks when opted out", async () => {
    render(true);
    act(() => mocks.exposePorts?.(ports));
    typeInEditor();
    mocks.abort.mockClear();
    render(false);
    expect(mocks.abort.mock.calls).toEqual([[undefined, "distill"]]);
    expect(mocks.listeners.size).toBe(0);
    await act(async () => vi.advanceTimersByTimeAsync(10_000));
    expect(mocks.distill).not.toHaveBeenCalled();
    expect(mocks.predict).not.toHaveBeenCalled();
  });

  it("aborts in-flight work and discards a late suggestion after opt-out", async () => {
    let resolvePrediction!: (value: unknown) => void;
    mocks.predict.mockReturnValue(
      new Promise((resolve) => {
        resolvePrediction = resolve;
      }),
    );
    render(true);
    act(() => mocks.exposePorts?.(ports));
    await act(async () => vi.advanceTimersByTimeAsync(3_000));
    expect(mocks.distill).toHaveBeenCalledTimes(1);
    typeInEditor();
    await act(async () => vi.advanceTimersByTimeAsync(600));
    expect(mocks.predict).toHaveBeenCalledTimes(1);
    const signal = mocks.predict.mock.calls[0][2].signal as AbortSignal;
    mocks.abort.mockClear();
    render(false);
    expect(signal.aborted).toBe(true);
    expect(mocks.abort.mock.calls).toEqual([[undefined, "distill"]]);
    await act(async () => {
      resolvePrediction({
        action: "continuation",
        items: [{ action: "continuation", text: "late" }],
      });
      await Promise.resolve();
    });
    expect(ports.showSuggestion).not.toHaveBeenCalled();
  });
});
