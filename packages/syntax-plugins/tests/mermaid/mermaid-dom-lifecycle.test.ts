// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { MermaidWysiwygEditor } from "@visimer/core";
import { MermaidCanvasView } from "@visimer/dom";

describe("pinned Visimer DOM async lifecycle patch", () => {
  it("drops delayed renders and validation results after destroy", async () => {
    const delayedRenders: Array<(result: { svg: string }) => void> = [];
    const delayedParses: Array<() => void> = [];
    const mermaid = {
      initialize: () => undefined,
      render: () => new Promise<{ svg: string }>((resolve) => delayedRenders.push(resolve)),
      parse: () => new Promise<void>((resolve) => delayedParses.push(resolve)),
    };
    const container = document.createElement("div");
    document.body.append(container);
    const editor = new MermaidWysiwygEditor({ code: "flowchart TD\n A-->B" });
    const view = new MermaidCanvasView({ editor, container, mermaid, debounceMs: 60_000 });
    const validation = view.validate();
    await Promise.resolve();
    view.destroy();
    for (const resolve of delayedParses) resolve();
    for (const resolve of delayedRenders) resolve({ svg: "<svg><text>stale</text></svg>" });

    await expect(validation).resolves.toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(container.querySelector("svg")).toBeNull();
    container.remove();
  });
});
