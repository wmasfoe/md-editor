import type { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { WysiwygDiagnostics } from "../../../src/../src/wysiwyg/../diagnostics.ts";
import { HtmlBlockWidget } from "../../../src/../src/wysiwyg/../../src/wysiwyg/widgets/html-block-widget.ts";

class FakeElement {
  readonly dataset: Record<string, string> = {};
  readonly children: FakeElement[] = [];
  readonly attributes = new Map<string, string>();
  readonly listeners = new Map<string, Set<EventListener>>();
  readonly classList = {
    toggle: (name: string, force: boolean) => {
      const names = new Set(this.className.split(/\s+/u).filter(Boolean));
      if (force) names.add(name);
      else names.delete(name);
      this.className = [...names].join(" ");
    },
  };
  className = "";
  textContent = "";

  constructor(
    readonly ownerDocument: FakeDocument,
    readonly tagName: string,
  ) {}

  addEventListener(type: string, listener: EventListener): void {
    const listeners = this.listeners.get(type) ?? new Set<EventListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: EventListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  append(...children: FakeElement[]): void {
    this.children.push(...children);
  }

  replaceChildren(...children: FakeElement[]): void {
    this.children.length = 0;
    this.append(...children);
  }
}

class FakeDocument {
  createElement(tagName: string): FakeElement {
    return new FakeElement(this, tagName);
  }
}

describe("HtmlBlockWidget lifecycle", () => {
  it("creates, updates, and destroys DOM listeners without innerHTML", () => {
    const diagnostics = new WysiwygDiagnostics();
    const document = new FakeDocument();
    const view = { dom: { ownerDocument: document } } as unknown as EditorView;
    const value = {
      recordId: "html:1",
      sanitizedHtml: "",
      placeholder: "Unsupported or unsafe HTML block",
      selected: false,
      diagnostics,
    } as const;
    const widget = new HtmlBlockWidget(value);
    const dom = widget.toDOM(view) as unknown as FakeElement;

    expect(dom.className).toContain("cm-md-html-block-widget");
    expect(dom.getAttribute("aria-selected")).toBe("false");
    expect(dom.children[0]?.textContent).toContain("Unsupported");

    const selectedWidget = new HtmlBlockWidget({ ...value, selected: true });
    expect(selectedWidget.updateDOM(dom as unknown as HTMLElement)).toBe(true);
    expect(dom.getAttribute("aria-selected")).toBe("true");
    expect(diagnostics.snapshot().widgetLifecycleCounts.html).toEqual({
      create: 1,
      update: 1,
      destroy: 0,
    });

    widget.destroy(dom as unknown as HTMLElement);
    expect(dom.listeners.get("pointerdown")?.size).toBe(0);
    expect(dom.listeners.get("click")?.size).toBe(0);
    expect(diagnostics.snapshot().widgetLifecycleCounts.html).toEqual({
      create: 1,
      update: 1,
      destroy: 1,
    });
  });
});
