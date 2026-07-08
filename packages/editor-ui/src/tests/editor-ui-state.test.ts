import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  EditorUiProvider,
  emptyEditorUiCommandSlots,
  useEditorUiActions,
  useEditorUiState,
  type EditorUiActionsContextValue,
  type EditorUiCommandSlots
} from "../hooks/useEditorUi";
import {
  clampEditorScrollRatio,
  createEditorDocumentKey,
  createModeScrollTarget
} from "../utils/editor-ui-state";

describe("editor UI instance state policy", () => {
  it("derives remount keys from document identity and revision", () => {
    expect(createEditorDocumentKey("/docs/a.md", 0)).toBe("/docs/a.md:0");
    expect(createEditorDocumentKey(null, 3)).toBe("untitled:3");
    expect(createEditorDocumentKey(undefined, 1.8)).toBe("untitled:1");
    expect(createEditorDocumentKey("/docs/a.md", -1)).toBe("/docs/a.md:0");
  });

  it("clamps mode-switch scroll ratios", () => {
    expect(clampEditorScrollRatio(-1)).toBe(0);
    expect(clampEditorScrollRatio(0.42)).toBe(0.42);
    expect(clampEditorScrollRatio(2)).toBe(1);
    expect(clampEditorScrollRatio(Number.NaN)).toBeNull();
    expect(clampEditorScrollRatio(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("creates mode scroll targets with stable nonces", () => {
    expect(createModeScrollTarget("source", 0.5, 123)).toEqual({
      mode: "source",
      target: {
        ratio: 0.5,
        nonce: 123
      }
    });
    expect(createModeScrollTarget("wysiwyg", Number.NaN, 123)).toBeNull();
  });

  it("keeps editor command defaults as safe no-ops", async () => {
    expect(emptyEditorUiCommandSlots.openMdxComponentMenu()).toBeUndefined();
    await expect(emptyEditorUiCommandSlots.continueAiWriting()).resolves.toBeUndefined();
  });

  it("isolates provider state and command slots per editor instance", () => {
    let firstActions: EditorUiActionsContextValue | null = null;
    let secondActions: EditorUiActionsContextValue | null = null;

    const html = renderToStaticMarkup(
      createElement(
        "div",
        null,
        createElement(
          EditorUiProvider,
          {
            filePath: "/docs/one.md",
            initialDocumentRevision: 1,
            markdown: "# One",
            showToast: () => {}
          },
          createElement(CaptureProbe, {
            label: "first",
            capture: (actions) => { firstActions = actions; }
          })
        ),
        createElement(
          EditorUiProvider,
          {
            filePath: "/docs/two.md",
            initialDocumentRevision: 2,
            markdown: "# Two",
            showToast: () => {}
          },
          createElement(CaptureProbe, {
            label: "second",
            capture: (actions) => { secondActions = actions; }
          })
        )
      )
    );

    expect(html).toContain("first:/docs/one.md:1:One");
    expect(html).toContain("second:/docs/two.md:2:Two");

    const customCommands: EditorUiCommandSlots = {
      openMdxComponentMenu: () => {},
      continueAiWriting: async () => {}
    };
    expect(firstActions).not.toBeNull();
    expect(secondActions).not.toBeNull();
    firstActions!.registerEditorCommands(customCommands);

    expect(firstActions!.getEditorCommands()).toBe(customCommands);
    expect(secondActions!.getEditorCommands()).toBe(emptyEditorUiCommandSlots);
  });

  it("fails fast when provider-scoped state is read outside EditorUiProvider", () => {
    expect(() => renderToStaticMarkup(createElement(OutsideProviderProbe)))
      .toThrow("useEditorUiState must be used within an EditorUiProvider.");
  });
});

function CaptureProbe({
  capture,
  label
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
    `${label}:${state.documentKey}:${state.outline.map((item) => item.text).join(",")}`
  );
}

function OutsideProviderProbe() {
  useEditorUiState();
  return null;
}
