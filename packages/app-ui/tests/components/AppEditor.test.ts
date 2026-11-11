// @vitest-environment jsdom
import { act, createElement, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDocumentState } from "@md-editor/core";
import type { CodeMirrorEditorProps } from "@md-editor/editor-react";
import { AppEditor } from "../../src/components/AppEditor";

const harness = vi.hoisted(() => ({
  props: null as CodeMirrorEditorProps | null,
  ports: { recomputeMarkdownLint: vi.fn() },
  unregister: vi.fn(),
  register: vi.fn(),
  outline: vi.fn(),
}));

vi.mock("@md-editor/i18n", () => ({ useTranslation: () => ({ i18n: { language: "zh" } }) }));
vi.mock("../../src/hooks/useEditorUi", () => ({
  useOptionalEditorUiActions: () => actions,
}));
vi.mock("@md-editor/editor-react", () => ({
  CodeMirrorEditor: (props: CodeMirrorEditorProps) => {
    harness.props = props;
    const { onRendererPortsChange } = props;
    useLayoutEffect(() => {
      onRendererPortsChange?.(harness.ports as never);
      return () => onRendererPortsChange?.(null);
    }, [onRendererPortsChange]);
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

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  container?.remove();
  vi.clearAllMocks();
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

  it("uses the latest callbacks without remounting and removes application language listeners", async () => {
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
    window.dispatchEvent(new Event("md-editor:language-changed"));
    expect(harness.ports.recomputeMarkdownLint).toHaveBeenCalledOnce();
    await act(() => root!.unmount());
    root = undefined;
    window.dispatchEvent(new Event("md-editor:language-changed"));
    expect(harness.ports.recomputeMarkdownLint).toHaveBeenCalledOnce();
  });
});
