// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { MermaidWysiwygEditor } from "@visimer/core";
import { MermaidCanvasView } from "@visimer/dom";

it("defers an in-flight SVG redraw until a connection gesture is canceled", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const markup =
    '<svg xmlns="http://www.w3.org/2000/svg"><g class="node" id="flowchart-A-0"><rect width="40" height="40" /></g></svg>';
  let finishRedraw!: (value: { svg: string }) => void;
  const redraw = new Promise<{ svg: string }>((resolve) => {
    finishRedraw = resolve;
  });
  const render = vi.fn().mockResolvedValue({ svg: markup });
  const view = new MermaidCanvasView({
    editor: new MermaidWysiwygEditor({ code: "flowchart TD\n A[Alpha]" }),
    container,
    mermaid: { initialize: () => undefined, render, parse: async () => true },
  });
  try {
    await vi.waitFor(() => expect(container.querySelector("svg")).not.toBeNull());
    const svg = container.querySelector("svg")!;
    render.mockReturnValueOnce(redraw);
    view.setMermaidConfig({ theme: "dark" });
    view.setTool("connect");
    container
      .querySelector('[data-mw-entity="node:A"]')!
      .dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    expect(container.querySelector(".mw-connect-source")).not.toBeNull();
    finishRedraw({ svg: markup });
    await redraw;
    await Promise.resolve();
    expect(container.querySelector("svg")).toBe(svg);
    // Native pointer cancellation clears the gesture and resumes the deferred redraw.
    svg.dispatchEvent(new MouseEvent("pointercancel", { bubbles: true }));
    await vi.waitFor(() => expect(container.querySelector("svg")).not.toBe(svg));
    expect(container.querySelector(".mw-connect-source")).toBeNull();
    expect(render).toHaveBeenCalledTimes(3);
  } finally {
    view.destroy();
    container.remove();
  }
});
