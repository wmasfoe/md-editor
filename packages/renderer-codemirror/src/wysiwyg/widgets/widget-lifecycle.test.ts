import type { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { WysiwygDiagnostics } from "../../diagnostics.ts";
import { DefaultAtomWidget } from "./default-atom-widget.ts";
import { FrontmatterHeaderWidget } from "./frontmatter-header-widget.ts";
import { ImageWidget } from "./image-widget.ts";
import { ThematicBreakWidget } from "./thematic-break-widget.ts";

class FakeClassList {
  constructor(private readonly element: FakeElement) {}

  toggle(name: string, force: boolean): void {
    const names = new Set(this.element.className.split(/\s+/u).filter(Boolean));
    if (force) {
      names.add(name);
    } else {
      names.delete(name);
    }
    this.element.className = [...names].join(" ");
  }

  contains(name: string): boolean {
    return this.element.className.split(/\s+/u).includes(name);
  }
}

class FakeElement {
  readonly dataset: Record<string, string> = {};
  readonly classList = new FakeClassList(this);
  readonly children: FakeElement[] = [];
  readonly #attributes = new Map<string, string>();
  readonly #listeners = new Map<string, Set<EventListener>>();
  className = "";
  textContent = "";
  hidden = false;
  draggable = false;
  alt = "";
  title = "";

  constructor(
    readonly tagName: string,
    readonly ownerDocument: FakeDocument,
  ) {}

  set src(value: string) {
    this.#attributes.set("src", value);
  }

  get src(): string {
    return this.#attributes.get("src") ?? "";
  }

  append(...children: FakeElement[]): void {
    this.children.push(...children);
  }

  setAttribute(name: string, value: string): void {
    this.#attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.#attributes.get(name) ?? null;
  }

  removeAttribute(name: string): void {
    this.#attributes.delete(name);
  }

  querySelector<T extends HTMLElement>(selector: string): T | null {
    const match = this.children.find((child) =>
      selector.startsWith(".")
        ? child.className.split(/\s+/u).includes(selector.slice(1))
        : child.tagName === selector.toLowerCase(),
    );
    return (match as unknown as T | undefined) ?? null;
  }

  addEventListener(name: string, listener: EventListener): void {
    const listeners = this.#listeners.get(name) ?? new Set<EventListener>();
    listeners.add(listener);
    this.#listeners.set(name, listeners);
  }

  removeEventListener(name: string, listener: EventListener): void {
    this.#listeners.get(name)?.delete(listener);
  }

  dispatch(name: string, event: Partial<MouseEvent> = {}): void {
    const value = { preventDefault() {}, ...event } as Event;
    for (const listener of this.#listeners.get(name) ?? []) {
      listener(value);
    }
  }

  listenerCount(): number {
    return [...this.#listeners.values()].reduce((count, listeners) => count + listeners.size, 0);
  }
}

class FakeDocument {
  createElement(tagName: string): HTMLElement {
    return new FakeElement(tagName.toLowerCase(), this) as unknown as HTMLElement;
  }
}

function createView(): { readonly view: EditorView; readonly document: FakeDocument } {
  const document = new FakeDocument();
  const view = { dom: { ownerDocument: document } } as unknown as EditorView;
  return { view, document };
}

describe("media widget DOM lifecycle", () => {
  it("updates image metadata without replacing DOM and releases every listener", () => {
    const diagnostics = new WysiwygDiagnostics();
    const { view } = createView();
    const original = new ImageWidget({
      recordId: "image:1",
      markdownSource: "image.png",
      previewSource: "asset://image.png",
      alt: "Original",
      title: null,
      active: false,
      selected: false,
      diagnostics,
    });
    const dom = original.toDOM(view) as unknown as FakeElement;
    const image = dom.querySelector<HTMLElement>("img") as unknown as FakeElement;
    const placeholder = dom.querySelector<HTMLElement>(
      ".cm-md-image-widget__placeholder",
    ) as unknown as FakeElement;

    expect(dom.getAttribute("role")).toBe("img");
    expect(dom.getAttribute("tabindex")).toBe("-1");
    expect(dom.getAttribute("aria-selected")).toBe("false");
    expect(image.getAttribute("src")).toBe("asset://image.png");
    expect(dom.listenerCount()).toBe(2);
    expect(image.listenerCount()).toBe(2);

    const updated = new ImageWidget({
      ...original.value,
      previewSource: "asset://updated.png",
      alt: "Updated",
      title: "Caption",
      active: true,
      selected: true,
    });
    expect(updated.updateDOM(dom as unknown as HTMLElement)).toBe(true);
    expect(image.getAttribute("src")).toBe("asset://updated.png");
    expect(image.alt).toBe("Updated");
    expect(image.title).toBe("Caption");
    expect(dom.getAttribute("aria-selected")).toBe("true");
    expect(dom.classList.contains("cm-md-image-widget--active")).toBe(true);
    expect(dom.classList.contains("cm-md-image-widget--selected")).toBe(true);

    image.dispatch("error");
    image.dispatch("error");
    expect(dom.classList.contains("cm-md-image-widget--failed")).toBe(true);
    expect(dom.getAttribute("aria-label")).toBe("Updated: preview unavailable");
    expect(image.hidden).toBe(true);
    expect(placeholder.hidden).toBe(false);
    expect(
      (
        placeholder.querySelector<HTMLElement>(
          ".cm-md-image-widget__placeholder-title",
        ) as unknown as FakeElement
      ).textContent,
    ).toBe("Image unavailable");
    expect(
      (
        placeholder.querySelector<HTMLElement>(
          ".cm-md-image-widget__placeholder-alt",
        ) as unknown as FakeElement
      ).textContent,
    ).toBe("Updated");
    expect(
      (
        placeholder.querySelector<HTMLElement>(
          ".cm-md-image-widget__placeholder-source",
        ) as unknown as FakeElement
      ).textContent,
    ).toBe("image.png");
    expect(diagnostics.snapshot().safeFallbackDiagnosticCounts).toMatchObject({
      IMAGE_PREVIEW_LOAD_FAILED: 1,
    });

    updated.destroy(dom as unknown as HTMLElement);
    expect(dom.listenerCount()).toBe(0);
    expect(image.listenerCount()).toBe(0);
    expect(diagnostics.snapshot().widgetLifecycleCounts.image).toEqual({
      create: 1,
      update: 1,
      destroy: 1,
    });
  });

  it("updates thematic-break selection and accessibility in place", () => {
    const diagnostics = new WysiwygDiagnostics();
    const { view } = createView();
    const unselected = new ThematicBreakWidget({
      recordId: "thematic-break:1",
      selected: false,
      diagnostics,
    });
    const dom = unselected.toDOM(view) as unknown as FakeElement;

    expect(dom.getAttribute("role")).toBe("separator");
    expect(dom.getAttribute("aria-label")).toBe("Thematic break");
    expect(dom.getAttribute("aria-selected")).toBe("false");
    expect(dom.listenerCount()).toBe(2);

    const selected = new ThematicBreakWidget({ ...unselected.value, selected: true });
    expect(selected.updateDOM(dom as unknown as HTMLElement)).toBe(true);
    expect(dom.getAttribute("aria-selected")).toBe("true");
    expect(dom.classList.contains("cm-md-thematic-break-widget--selected")).toBe(true);

    selected.destroy(dom as unknown as HTMLElement);
    expect(dom.listenerCount()).toBe(0);
    expect(diagnostics.snapshot().widgetLifecycleCounts["thematic-break"]).toEqual({
      create: 1,
      update: 1,
      destroy: 1,
    });
  });

  it("updates default atom content, selection, and heading semantics in place", () => {
    const diagnostics = new WysiwygDiagnostics();
    const { view } = createView();
    const original = new DefaultAtomWidget({
      recordId: "heading-setext:1",
      kind: "heading-setext",
      primaryText: "Title",
      secondaryText: null,
      accessibleLabel: "Heading level 1: Title",
      selected: false,
      block: true,
      headingLevel: 1,
      diagnostics,
    });
    const dom = original.toDOM(view) as unknown as FakeElement;
    const primary = dom.querySelector<HTMLElement>(
      ".cm-md-default-atom__primary",
    ) as unknown as FakeElement;
    const secondary = dom.querySelector<HTMLElement>(
      ".cm-md-default-atom__secondary",
    ) as unknown as FakeElement;

    expect(dom.getAttribute("role")).toBe("heading");
    expect(dom.getAttribute("aria-level")).toBe("1");
    expect(dom.getAttribute("aria-selected")).toBe("false");
    expect(primary.textContent).toBe("Title");
    expect(secondary.hidden).toBe(true);
    expect(dom.listenerCount()).toBe(2);

    const selected = new DefaultAtomWidget({
      ...original.value,
      primaryText: "Updated title",
      selected: true,
    });
    expect(selected.eq(original)).toBe(false);
    expect(selected.updateDOM(dom as unknown as HTMLElement)).toBe(true);
    expect(primary.textContent).toBe("Updated title");
    expect(dom.getAttribute("aria-selected")).toBe("true");
    expect(dom.classList.contains("cm-md-default-atom--selected")).toBe(true);

    selected.destroy(dom as unknown as HTMLElement);
    expect(dom.listenerCount()).toBe(0);
    expect(diagnostics.snapshot().widgetLifecycleCounts.default).toEqual({
      create: 1,
      update: 1,
      destroy: 1,
    });
  });

  it("keeps the Frontmatter status hidden until YAML needs attention", () => {
    const diagnostics = new WysiwygDiagnostics();
    const { view } = createView();
    const valid = new FrontmatterHeaderWidget({
      recordId: "frontmatter:1",
      status: "closed",
      errorCount: 0,
      diagnostics,
    });
    const dom = valid.toDOM(view) as unknown as FakeElement;

    expect(dom.getAttribute("role")).toBe("status");
    expect(dom.getAttribute("aria-label")).toBe("YAML metadata");
    expect(dom.hidden).toBe(true);
    expect(dom.querySelector<HTMLElement>(".cm-md-frontmatter-header__title")).toBeNull();
    expect(dom.querySelector<HTMLElement>(".cm-md-frontmatter-header__format")).toBeNull();
    expect(dom.querySelector<HTMLElement>("input")).toBeNull();
    expect(dom.querySelector<HTMLElement>("textarea")).toBeNull();
    expect(dom.listenerCount()).toBe(0);

    const invalid = new FrontmatterHeaderWidget({
      ...valid.value,
      errorCount: 2,
    });
    expect(invalid.updateDOM(dom as unknown as HTMLElement)).toBe(true);
    expect(dom.getAttribute("aria-label")).toBe("YAML error");
    expect(dom.hidden).toBe(false);
    expect(dom.classList.contains("cm-md-frontmatter-header--error")).toBe(true);
    invalid.destroy();
    expect(diagnostics.snapshot().widgetLifecycleCounts.frontmatter).toEqual({
      create: 1,
      update: 1,
      destroy: 1,
    });
  });
});
