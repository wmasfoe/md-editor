// @vitest-environment jsdom
/**
 * L-2：库默认英文，宿主语言经 `translateEditorMessage` 决定。
 *
 * 此前 `ariaLabel` 默认值是写死的中文 `"Markdown 编辑器"`，非中文宿主无法消除；
 * AI 建议标签同样以中文为默认值。
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDocumentState } from "@md-editor/core";
import { CodeMirrorEditor } from "../../src/react/index.ts";
import { DEFAULT_AI_SUGGESTION_LABELS } from "../../src/wysiwyg/view/suggestion-model.ts";

vi.mock("../../src/bridge.ts", () => ({
  createCodeMirrorEditorBridge: vi.fn(() => ({
    ports: {
      setCodeBlockLineNumbers: vi.fn(),
      setInlineStyleMarkers: vi.fn(),
      setMarkdownLint: vi.fn(),
      setMarkdownLintEngine: vi.fn(),
      recomputeMarkdownLint: vi.fn(),
      setLanguage: vi.fn(),
      setAiSuggestionLabels: vi.fn(),
      setPlugins: vi.fn(),
      requestMeasure: vi.fn(),
      setHostVisibility: vi.fn(),
    },
    destroy: vi.fn(),
  })),
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root | undefined;
let container: HTMLDivElement | undefined;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  container?.remove();
});

async function hostAriaLabel(ariaLabel?: string): Promise<string | null> {
  const documentState = createDocumentState({ markdown: "" });
  await act(() =>
    root!.render(
      createElement(CodeMirrorEditor, {
        document: documentState,
        ...(ariaLabel === undefined ? {} : { ariaLabel }),
      }),
    ),
  );
  return container!.querySelector(".code-mirror-editor-host")!.getAttribute("aria-label");
}

describe("L-2 库默认中文不得泄漏到非中文宿主", () => {
  it("未指定 ariaLabel 时默认英文", async () => {
    expect(await hostAriaLabel()).toBe("Markdown editor");
  });

  it("宿主传什么就用什么", async () => {
    expect(await hostAriaLabel("エディタ")).toBe("エディタ");
  });

  it("AI 建议默认标签是英文", () => {
    expect(DEFAULT_AI_SUGGESTION_LABELS).toMatchObject({
      accept: "Accept",
      dismiss: "Dismiss",
      kindFix: "Fix",
      kindStyle: "Style",
    });
  });
});
