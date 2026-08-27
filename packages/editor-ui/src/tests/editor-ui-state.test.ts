import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { CodeMirrorEditorPorts } from "../components/CodeMirrorEditor";
import {
  EditorUiProvider,
  unsupportedEditorUiCommandSlots,
  useEditorUiActions,
  useEditorUiState,
  type EditorUiActionsContextValue,
} from "../hooks/useEditorUi";

describe("editor UI instance state policy", () => {
  it("returns typed unsupported results when no editor command implementation is mounted", async () => {
    const unsupported = {
      status: "unsupported",
      reason: "not-available-in-active-editor",
    };
    expect(unsupportedEditorUiCommandSlots.openMdxComponentMenu()).toEqual(unsupported);
    await expect(unsupportedEditorUiCommandSlots.continueAiWriting()).resolves.toEqual(unsupported);
  });

  it("isolates provider state and renderer ports per editor instance", () => {
    let firstActions: EditorUiActionsContextValue | null = null;
    let secondActions: EditorUiActionsContextValue | null = null;

    const html = renderToStaticMarkup(
      createElement(
        "div",
        null,
        createElement(
          EditorUiProvider,
          { markdown: "# One", showToast: () => {} },
          createElement(CaptureProbe, {
            label: "first",
            capture: (actions) => {
              firstActions = actions;
            },
          }),
        ),
        createElement(
          EditorUiProvider,
          { markdown: "# Two", showToast: () => {} },
          createElement(CaptureProbe, {
            label: "second",
            capture: (actions) => {
              secondActions = actions;
            },
          }),
        ),
      ),
    );

    expect(html).toContain("first:One");
    expect(html).toContain("second:Two");

    const rendererPorts = createRendererPorts("renderer:first");
    expect(firstActions).not.toBeNull();
    expect(secondActions).not.toBeNull();
    const unregister = firstActions!.registerRendererPorts(rendererPorts);

    expect(firstActions!.getRendererPorts()).toEqual({ status: "available", ports: rendererPorts });
    expect(secondActions!.getRendererPorts()).toEqual({
      status: "unavailable",
      reason: "editor-not-mounted",
    });

    unregister();
    unregister();
    expect(firstActions!.getRendererPorts()).toEqual({
      status: "unavailable",
      reason: "editor-not-mounted",
    });
  });

  it("rejects a second active renderer registration instead of silently replacing it", () => {
    let actions: EditorUiActionsContextValue | null = null;
    renderToStaticMarkup(
      createElement(
        EditorUiProvider,
        { markdown: "", showToast: () => {} },
        createElement(CaptureProbe, {
          label: "only",
          capture: (value) => {
            actions = value;
          },
        }),
      ),
    );

    const unregister = actions!.registerRendererPorts(createRendererPorts("renderer:one"));
    expect(() => actions!.registerRendererPorts(createRendererPorts("renderer:two"))).toThrow(
      "Only one active Markdown renderer",
    );
    unregister();
  });

  it("fails fast when provider-scoped state is read outside EditorUiProvider", () => {
    expect(() => renderToStaticMarkup(createElement(OutsideProviderProbe))).toThrow(
      "useEditorUiState must be used within an EditorUiProvider.",
    );
  });

  it("forwards jumpToTocItem and jumpToMarkdownFragment to registered renderer ports scrollToLine", () => {
    let actions: EditorUiActionsContextValue | null = null;
    renderToStaticMarkup(
      createElement(
        EditorUiProvider,
        { markdown: "# Heading 1\n\n## Heading 2\n", showToast: () => {} },
        createElement(CaptureProbe, {
          label: "jump",
          capture: (value) => {
            actions = value;
          },
        }),
      ),
    );

    const rendererPorts = createRendererPorts("renderer:jump");
    const unregister = actions!.registerRendererPorts(rendererPorts);

    actions!.jumpToTocItem({ line: 3, level: 2, text: "Heading 2" });
    expect(rendererPorts.scrollToLine).toHaveBeenCalledWith(3);

    actions!.jumpToMarkdownFragment("# Heading 1\n\n## Heading 2\n", "heading-2");
    expect(rendererPorts.scrollToLine).toHaveBeenCalledWith(3);

    unregister();
  });
});

function createRendererPorts(clientId: string): CodeMirrorEditorPorts {
  return {
    clientId,
    mode: {
      applyMode: vi.fn(() => ({ status: "failed" as const, errorCode: "TEST" })),
      rollbackMode: vi.fn(),
    },
    applyExternalEdit: vi.fn(() => ({ status: "noop" as const })),
    setCodeBlockLineNumbers: vi.fn(() => ({ status: "noop" as const })),
    setHostVisibility: vi.fn(),
    showSuggestion: vi.fn(),
    acceptSuggestion: vi.fn(() => false),
    dismissSuggestion: vi.fn(() => false),
    getSuggestion: vi.fn(() => null),
    getSelectionSnapshot: vi.fn(() => ({ from: 0, to: 0, text: "", head: 0 })),
    focus: vi.fn(),
    setSelection: vi.fn(),
    scrollToLine: vi.fn(() => true),
    requestMeasure: vi.fn(),
  };
}

function CaptureProbe({
  capture,
  label,
}: {
  readonly capture: (actions: EditorUiActionsContextValue) => void;
  readonly label: string;
}) {
  const state = useEditorUiState();
  const actions = useEditorUiActions();
  capture(actions);
  return createElement(
    "span",
    null,
    `${label}:${state.outline.map((item) => item.text).join(",")}`,
  );
}

function OutsideProviderProbe() {
  useEditorUiState();
  return null;
}
