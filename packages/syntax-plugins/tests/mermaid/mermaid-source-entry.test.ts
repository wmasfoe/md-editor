// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { syntaxPluginHostPortsFacet } from "@md-editor/plugin-sdk/syntax";
import { MermaidBlockWidget } from "../../src/mermaid/mermaid-projection.ts";

describe("Mermaid source fallback entry", () => {
  it("provides an in-context source action when graphical inspection rejects syntax", async () => {
    const opened: string[] = [];
    const state = EditorState.create({
      extensions: [
        syntaxPluginHostPortsFacet.of({
          openGraphicalCodeBlockEditor: () => {
            throw new Error("An unsupported diagram must not open the graphical editor");
          },
          revealCodeBlockSource: ({ recordId }) => opened.push(recordId),
        }),
      ],
    });
    const view = { state, dom: document.createElement("div"), requestMeasure: () => undefined };
    const widget = new MermaidBlockWidget(
      "block-1",
      "flowchart TD\nsubgraph Group\n A-->B\nend",
      0,
    );
    const wrapper = widget.toDOM(view as unknown as EditorView);
    const button = wrapper.querySelector<HTMLButtonElement>(".cm-md-mermaid-toolbar__source-edit");
    await vi.waitFor(() => expect(button?.hidden).toBe(false));
    button?.click();
    expect(opened).toEqual(["block-1"]);
    widget.destroy(wrapper);
  });
});
