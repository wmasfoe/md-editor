// @vitest-environment jsdom
import { act, createElement, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDocumentState } from "@md-editor/core";
import type { CodeMirrorEditorProps } from "@md-editor/editor/react";
import { changeLanguage, configureI18n } from "@md-editor/i18n";
import { AppEditor } from "../../src/components/AppEditor";

const harness = vi.hoisted(() => ({
  props: null as CodeMirrorEditorProps | null,
  ports: { recomputeMarkdownLint: vi.fn() },
  unregister: vi.fn(),
  register: vi.fn(),
  outline: vi.fn(),
}));

vi.mock("../../src/hooks/useEditorUi", () => ({
  useOptionalEditorUiActions: () => actions,
}));
vi.mock("@md-editor/editor/react", () => ({
  CodeMirrorEditor: (props: CodeMirrorEditorProps) => {
    harness.props = props;
    const { onRendererPortsChange } = props;
    useLayoutEffect(() => {
      onRendererPortsChange?.(harness.ports as never);
      return () => onRendererPortsChange?.(null);
    }, [onRendererPortsChange]);
    // Model the child's public language contract; the adapter has its own behavior tests.
    useLayoutEffect(() => {
      if (props.enableMarkdownLint) harness.ports.recomputeMarkdownLint();
    }, [props.language, props.enableMarkdownLint]);
    return null;
  },
}));

// Stable provider actions model the real context without mounting unrelated application UI.
const actions = {
  registerRendererPorts: harness.register.mockImplementation(() => harness.unregister),
  updateActiveOutlineForLine: harness.outline,
};
let root: Root | undefined;
let container: HTMLDivElement | undefined;
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

beforeEach(async () => {
  configureI18n({ syncDocumentLang: true });
  await changeLanguage("zh");
});

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  container?.remove();
  configureI18n({ syncDocumentLang: false });
  vi.clearAllMocks();
  harness.ports.recomputeMarkdownLint.mockReset();
});

async function render(props: CodeMirrorEditorProps) {
  if (!root) {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  }
  await act(() => root!.render(createElement(AppEditor, props)));
}

describe("AppEditor application integration", () => {
  it("registers editor ports, forwards cursor callbacks and unregisters on unmount", async () => {
    const onCursorLineChange = vi.fn();
    const onRendererPortsChange = vi.fn();
    await render({ document: createDocumentState(), onCursorLineChange, onRendererPortsChange });
    expect(harness.register).toHaveBeenNthCalledWith(1, harness.ports);
    harness.props?.onCursorLineChange?.(7);
    expect(onCursorLineChange).toHaveBeenNthCalledWith(1, 7);
    expect(harness.outline).toHaveBeenNthCalledWith(1, 7);
    expect(onRendererPortsChange).toHaveBeenCalledWith(harness.ports);
    await act(() => root!.unmount());
    root = undefined;
    expect(harness.unregister).toHaveBeenCalledOnce();
    expect(onRendererPortsChange).toHaveBeenLastCalledWith(null);
  });

  it("uses the latest callbacks without remounting and forwards an explicit host language", async () => {
    const state = createDocumentState();
    const first = vi.fn();
    const latest = vi.fn();
    await render({ document: state, onCursorLineChange: first, enableMarkdownLint: true });
    expect(harness.props?.language).toBe("zh");
    await render({
      document: state,
      language: "en",
      onCursorLineChange: latest,
      enableMarkdownLint: true,
    });
    expect(harness.props?.language).toBe("en");
    expect(harness.register).toHaveBeenCalledOnce();
    harness.props?.onCursorLineChange?.(2);
    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenNthCalledWith(1, 2);
    const calls = harness.ports.recomputeMarkdownLint.mock.calls.length;
    window.dispatchEvent(new Event("md-editor:language-changed"));
    expect(harness.ports.recomputeMarkdownLint).toHaveBeenCalledTimes(calls);
    await act(() => root!.unmount());
    root = undefined;
    window.dispatchEvent(new Event("md-editor:language-changed"));
    expect(harness.ports.recomputeMarkdownLint).toHaveBeenCalledTimes(calls);
  });

  it("forwards an i18n change through one lint refresh path after the document language updates", async () => {
    await render({ document: createDocumentState(), enableMarkdownLint: true });
    harness.ports.recomputeMarkdownLint.mockClear();
    const documentLanguages: string[] = [];
    harness.ports.recomputeMarkdownLint.mockImplementation(() => {
      documentLanguages.push(document.documentElement.lang);
    });
    await act(() => changeLanguage("en"));
    expect(harness.props?.language).toBe("en");
    expect(harness.ports.recomputeMarkdownLint).toHaveBeenCalledOnce();
    expect(documentLanguages).toEqual(["en"]);
    harness.ports.recomputeMarkdownLint.mockReset();
  });
});
