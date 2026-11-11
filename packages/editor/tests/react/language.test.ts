// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDocumentState } from "@md-editor/core";
import { CodeMirrorEditor } from "../../src/react/index.ts";

const bridge = vi.hoisted(() => ({
  ports: {
    setCodeBlockLineNumbers: vi.fn(),
    setInlineStyleMarkers: vi.fn(),
    setMarkdownLint: vi.fn(),
    recomputeMarkdownLint: vi.fn(),
    requestMeasure: vi.fn(),
    setHostVisibility: vi.fn(),
  },
  destroy: vi.fn(),
}));
vi.mock("../../src/bridge.ts", () => ({ createCodeMirrorEditorBridge: vi.fn(() => bridge) }));

let root: Root | undefined;
let container: HTMLDivElement | undefined;
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  container?.remove();
  vi.clearAllMocks();
});

describe("React editor language changes", () => {
  it.each([false, true])(
    "refreshes diagnostics only when lint is enabled (%s)",
    async (enabled) => {
      const documentState = createDocumentState();
      container = document.createElement("div");
      document.body.append(container);
      root = createRoot(container);
      const render = (language: string) =>
        act(() =>
          root!.render(
            createElement(CodeMirrorEditor, {
              document: documentState,
              language,
              enableMarkdownLint: enabled,
            }),
          ),
        );
      await render("en");
      bridge.ports.recomputeMarkdownLint.mockClear();
      await render("zh");
      expect(bridge.ports.recomputeMarkdownLint).toHaveBeenCalledTimes(enabled ? 1 : 0);
      expect(bridge.destroy).not.toHaveBeenCalled();
      await render("zh");
      expect(bridge.ports.recomputeMarkdownLint).toHaveBeenCalledTimes(enabled ? 1 : 0);
    },
  );
});
