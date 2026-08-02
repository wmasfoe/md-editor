import { markdown } from "@codemirror/lang-markdown";
import { EditorSelection, EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { describe, expect, it, vi } from "vitest";
import { M1_MARKDOWN_EXTENSIONS } from "../../markdown/extensions.ts";
import { markdownRangeIndexField } from "../../markdown/range-index.ts";
import { WysiwygDiagnostics } from "../../diagnostics.ts";
import { editorModeField } from "../../mode.ts";
import { configureWysiwygProjectionFeatures, wysiwygProjectionField } from "../projection-state.ts";
import { wysiwygChangeProtection } from "../change-protection.ts";
import { DefaultAtomWidget } from "./default-atom-widget.ts";
import { FrontmatterHeaderWidget } from "./frontmatter-header-widget.ts";
import { ImageWidget } from "./image-widget.ts";
import { TableGridWidget } from "./table-widget.ts";
import { ThematicBreakWidget } from "./thematic-break-widget.ts";

// Node 测试环境没有 DOM 全局类；为 widget 代码中的 instanceof 检查提供最小桩类型。
class NodeStub {
  readonly __nodeStub = true;
}
class ElementStub extends NodeStub {
  readonly __elementStub = true;
}
class HTMLElementStub extends ElementStub {
  readonly __htmlElementStub = true;
}
if (typeof globalThis.Node === "undefined") {
  (globalThis as unknown as Record<string, unknown>).Node = NodeStub;
}
if (typeof globalThis.Element === "undefined") {
  (globalThis as unknown as Record<string, unknown>).Element = ElementStub;
}
if (typeof globalThis.HTMLElement === "undefined") {
  (globalThis as unknown as Record<string, unknown>).HTMLElement = HTMLElementStub;
}

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

  add(...names: string[]): void {
    const current = new Set(this.element.className.split(/\s+/u).filter(Boolean));
    for (const name of names) {
      current.add(name);
    }
    this.element.className = [...current].join(" ");
  }

  remove(...names: string[]): void {
    const current = new Set(this.element.className.split(/\s+/u).filter(Boolean));
    for (const name of names) {
      current.delete(name);
    }
    this.element.className = [...current].join(" ");
  }

  contains(name: string): boolean {
    return this.element.className.split(/\s+/u).includes(name);
  }
}

class FakeElement extends HTMLElementStub {
  readonly dataset: Record<string, string> = {};
  readonly classList = new FakeClassList(this);
  readonly children: FakeElement[] = [];
  readonly style: Record<string, string> = {};
  readonly #attributes = new Map<string, string>();
  readonly #listeners = new Map<string, Set<EventListener>>();
  className = "";
  textContent = "";
  hidden = false;
  draggable = false;
  alt = "";
  title = "";
  contentEditable = "";
  spellcheck = false;
  scope = "";
  type = "";
  parentNode: FakeElement | null = null;

  get innerText(): string {
    return this.textContent;
  }

  set innerText(value: string) {
    this.textContent = value;
  }

  constructor(
    readonly tagName: string,
    readonly ownerDocument: FakeDocument,
  ) {
    super();
  }

  set src(value: string) {
    this.#attributes.set("src", value);
  }

  get src(): string {
    return this.#attributes.get("src") ?? "";
  }

  append(...children: FakeElement[]): void {
    this.children.push(...children);
    for (const child of children) {
      child.parentNode = this;
    }
  }

  replaceChildren(...children: FakeElement[]): void {
    this.children.length = 0;
    this.append(...children);
  }

  setAttribute(name: string, value: string): void {
    this.#attributes.set(name, value);
    const dataKey = dataKeyFromAttribute(name);
    if (dataKey) {
      this.dataset[dataKey] = value;
    }
  }

  getAttribute(name: string): string | null {
    if (this.#attributes.has(name)) {
      return this.#attributes.get(name) ?? null;
    }
    const dataKey = dataKeyFromAttribute(name);
    return dataKey ? (this.dataset[dataKey] ?? null) : null;
  }

  removeAttribute(name: string): void {
    this.#attributes.delete(name);
    const dataKey = dataKeyFromAttribute(name);
    if (dataKey) {
      delete this.dataset[dataKey];
    }
  }

  matches(selector: string): boolean {
    return selector
      .split(",")
      .map((part) => part.trim())
      .some((part) => this.#matchesSimple(part));
  }

  #matchesSimple(selector: string): boolean {
    const tokens = selector.trim().split(/\s+/u);
    // 自身必须匹配最后一个 token（如 "th"）。
    if (!this.#matchToken(tokens[tokens.length - 1]!)) {
      return false;
    }
    // 其余 token（如 "thead"）从最近的祖先开始依次向上匹配。
    let ancestor: FakeElement | null = this.parentNode;
    for (let index = tokens.length - 2; index >= 0; index -= 1) {
      while (ancestor && !ancestor.#matchToken(tokens[index]!)) {
        ancestor = ancestor.parentNode;
      }
      if (!ancestor) {
        return false;
      }
    }
    return true;
  }

  #matchToken(token: string): boolean {
    if (token.startsWith(".")) {
      return this.className.split(/\s+/u).includes(token.slice(1));
    }
    const attribute = /^\[([\w-]+)(?:="([^"]*)")?\]$/u.exec(token);
    if (attribute) {
      const value = this.getAttribute(attribute[1]);
      return attribute[2] === undefined ? value !== null : value === attribute[2];
    }
    return this.tagName === token.toLowerCase();
  }

  querySelector<T extends HTMLElement>(selector: string): T | null {
    const stack = [...this.children];
    while (stack.length > 0) {
      const child = stack.shift()!;
      if (child.matches(selector)) {
        return child as unknown as T;
      }
      stack.push(...child.children);
    }
    return null;
  }

  querySelectorAll<T extends HTMLElement>(selector: string): T[] {
    const matches: FakeElement[] = [];
    const stack = [...this.children];
    while (stack.length > 0) {
      const child = stack.shift()!;
      if (child.matches(selector)) {
        matches.push(child);
      }
      stack.push(...child.children);
    }
    return matches as unknown as T[];
  }

  closest<T extends HTMLElement>(selector: string): T | null {
    if (this.matches(selector)) {
      return this as unknown as T;
    }
    return this.parentNode ? this.parentNode.closest(selector) : null;
  }

  contains(node: FakeElement): boolean {
    let current: FakeElement | null = node;
    while (current) {
      if (current === this) {
        return true;
      }
      current = current.parentNode;
    }
    return false;
  }

  focus(): void {}

  blur(): void {}

  addEventListener(name: string, listener: EventListener): void {
    const listeners = this.#listeners.get(name) ?? new Set<EventListener>();
    listeners.add(listener);
    this.#listeners.set(name, listeners);
  }

  removeEventListener(name: string, listener: EventListener): void {
    this.#listeners.get(name)?.delete(listener);
  }

  dispatch(name: string, event: Partial<MouseEvent> = {}): void {
    const value = {
      preventDefault() {},
      stopPropagation() {},
      target: this,
      ...event,
    } as Event;
    for (const listener of this.#listeners.get(name) ?? []) {
      listener(value);
    }
  }

  listenerCount(): number {
    return [...this.#listeners.values()].reduce((count, listeners) => count + listeners.size, 0);
  }
}

/** data-* 属性名转 dataset 驼峰键（data-row-kind → rowKind）。 */
function dataKeyFromAttribute(name: string): string | null {
  const match = /^data-([\w-]+)$/u.exec(name);
  if (!match) {
    return null;
  }
  return match[1].replace(/-([a-z])/gu, (_, letter: string) => letter.toUpperCase());
}

class FakeDocument {
  readonly #listeners = new Map<string, Set<EventListener>>();

  createElement(tagName: string): HTMLElement {
    return new FakeElement(tagName.toLowerCase(), this) as unknown as HTMLElement;
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
    const value = {
      preventDefault() {},
      stopPropagation() {},
      target: this,
      ...event,
    } as Event;
    for (const listener of this.#listeners.get(name) ?? []) {
      listener(value);
    }
  }

  listenerCount(): number {
    return [...this.#listeners.values()].reduce((count, listeners) => count + listeners.size, 0);
  }
}

function createView(): { readonly view: EditorView; readonly document: FakeDocument } {
  const document = new FakeDocument();
  const view = {
    dom: { ownerDocument: document },
    dispatch() {},
    focus() {},
  } as unknown as EditorView;
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

describe("table widget DOM lifecycle", () => {
  function createTableWidget(options?: Partial<ConstructorParameters<typeof TableGridWidget>[0]>) {
    const diagnostics = new WysiwygDiagnostics();
    const { view, document } = createView();
    const widget = new TableGridWidget({
      recordId: "table:1",
      headerCells: ["A", "B"],
      bodyRows: [
        ["1", "2"],
        ["3", "4"],
      ],
      alignments: ["none", "right"],
      selected: false,
      diagnostics,
      ...options,
    });
    const dom = widget.toDOM(view) as unknown as FakeElement;
    return { view, dom, document, widget, diagnostics };
  }

  it("renders an editable grid with Notion-style block handles and a lazy action menu", () => {
    const { dom } = createTableWidget();

    expect(dom.getAttribute("role")).toBe("group");
    expect(dom.getAttribute("aria-label")).toBe("Markdown table");
    expect(dom.getAttribute("data-record-id")).toBe("table:1");
    expect(dom.getAttribute("aria-selected")).toBe("false");
    // 顶部工具行已被行/列块手柄 + 菜单取代。
    expect(dom.querySelector<HTMLElement>(".cm-md-table-widget__toolbar")).toBeNull();

    const headerCells = dom.querySelectorAll<HTMLElement>("thead th") as unknown as FakeElement[];
    const bodyCells = dom.querySelectorAll<HTMLElement>("tbody td") as unknown as FakeElement[];
    expect(headerCells).toHaveLength(2);
    expect(bodyCells).toHaveLength(4);

    // 单元格是原生 contenteditable：左键点击不会被 widget 拦截（见下方 pointerdown 用例）。
    const firstCell = bodyCells[0];
    expect(firstCell.contentEditable).toBe("plaintext-only");
    expect(firstCell.spellcheck).toBe(false);
    expect(firstCell.getAttribute("data-row-kind")).toBe("body");
    expect(firstCell.getAttribute("data-row-index")).toBe("0");
    expect(firstCell.getAttribute("data-col-index")).toBe("0");
    expect(firstCell.textContent).toBe("1");
    // 对齐经内联样式应用；表头单元格声明 scope="col"。
    expect(bodyCells[1].style.textAlign).toBe("right");
    expect(headerCells[0].scope).toBe("col");

    // 行块手柄：每行第一列；列块手柄：每个表头单元格。每个手柄一个 ⋮⋮ 切换按钮。
    const rowHandleCells = bodyCells.filter((cell) =>
      cell.querySelector<HTMLElement>(".cm-md-table-widget__handle--row"),
    );
    expect(rowHandleCells).toHaveLength(2);
    const colHandleCells = headerCells.filter((cell) =>
      cell.querySelector<HTMLElement>(".cm-md-table-widget__handle--col"),
    );
    expect(colHandleCells).toHaveLength(2);

    const toggles = dom.querySelectorAll<HTMLElement>(
      "[data-table-toggle]",
    ) as unknown as FakeElement[];
    expect(toggles).toHaveLength(4);
    for (const toggle of toggles) {
      expect(toggle.textContent).toBe("⋮⋮");
      expect(toggle.className).toContain("cm-md-table-widget__btn--handle");
    }
    // 菜单初始为空（hidden），菜单项在点击手柄时惰性生成。
    const menu = dom.querySelector<HTMLElement>(
      ".cm-md-table-widget__menu",
    ) as unknown as FakeElement;
    expect(menu).not.toBeNull();
    expect(menu.hidden).toBe(true);
    expect(menu.getAttribute("role")).toBe("menu");
    expect(dom.querySelectorAll<HTMLElement>("[data-table-action]")).toHaveLength(0);
  });

  it("opens a row/col action menu on handle click and closes it on outside click", () => {
    const { dom, document } = createTableWidget();
    const menu = dom.querySelector<HTMLElement>(
      ".cm-md-table-widget__menu",
    ) as unknown as FakeElement;

    // 行手柄 → 行菜单：上方插入 / 下方插入 / 删除本行。
    // （FakeElement.dispatch 不冒泡，需对注册监听器的 wrapper 派发并指定 target。）
    const rowToggle = dom.querySelector<HTMLElement>(
      '[data-table-toggle="row"]',
    ) as unknown as FakeElement;
    dom.dispatch("click", { target: rowToggle } as unknown as MouseEvent);
    expect(menu.hidden).toBe(false);
    const rowItems = dom.querySelectorAll<HTMLElement>(
      "[data-table-action]",
    ) as unknown as FakeElement[];
    expect(rowItems.map((item) => item.dataset.tableAction)).toEqual([
      "insert-row-above",
      "insert-row-below",
      "delete-row",
    ]);
    expect(rowItems[0]?.dataset.rowIndex).toBe("0");
    // 打开菜单时注册文档级点击监听（点击表格外关闭）。
    expect(document.listenerCount()).toBe(1);

    // 点击表格外（对 document 派发，命中 capture 阶段的 documentClick）→ 菜单关闭、监听移除。
    const outside = new FakeElement("div", document);
    document.dispatch("click", { target: outside } as unknown as MouseEvent);
    expect(menu.hidden).toBe(true);
    expect(document.listenerCount()).toBe(0);

    // 列手柄 → 列菜单：左侧插入 / 右侧插入 / 删除本列（末列也可删）+ 对齐分组（当前列勾选）。
    const colToggle = dom.querySelector<HTMLElement>(
      '[data-table-toggle="col"]',
    ) as unknown as FakeElement;
    dom.dispatch("click", { target: colToggle } as unknown as MouseEvent);
    expect(menu.hidden).toBe(false);
    const colItems = dom.querySelectorAll<HTMLElement>(
      "[data-table-action]",
    ) as unknown as FakeElement[];
    expect(colItems.map((item) => item.dataset.tableAction)).toEqual([
      "insert-col-left",
      "insert-col-right",
      "delete-col",
      "align-none",
      "align-left",
      "align-center",
      "align-right",
    ]);
    expect(colItems[2]?.dataset.colIndex).toBe("0");
    expect(colItems[2]?.className).toContain("cm-md-table-widget__menu-item--danger");
    // createTableWidget 的 alignments 是 ["none", "right"]：第 0 列当前对齐为 none → 勾选 align-none。
    expect(colItems[3]?.className).toContain("cm-md-table-widget__menu-item--active");
    expect(colItems[3]?.getAttribute("aria-checked")).toBe("true");
    expect(colItems[4]?.getAttribute("aria-checked")).toBeNull();
  });

  it("executes the picked action and closes the menu", () => {
    // 真实 EditorState：菜单项点击要真实驱动 table-editing 的增删事务。
    let state = EditorState.create({
      doc: "| a | b |\n| - | - |\n| 1 | 2 |\n| 3 | 4 |",
      selection: EditorSelection.cursor(0),
      extensions: [
        markdown({ extensions: M1_MARKDOWN_EXTENSIONS, addKeymap: false }),
        editorModeField,
        markdownRangeIndexField,
        configureWysiwygProjectionFeatures(["tables"]),
        wysiwygProjectionField,
        wysiwygChangeProtection,
      ],
    });
    const document = new FakeDocument();
    const view = {
      dom: { ownerDocument: document },
      get state() {
        return state;
      },
      dispatch(spec: Parameters<EditorState["update"]>[0]) {
        state = state.update(spec).state;
      },
      focus() {},
    } as unknown as EditorView;

    const table = state.field(markdownRangeIndexField).byKind("table")[0]!;
    const widget = new TableGridWidget({
      recordId: table.id,
      headerCells: ["a", "b"],
      bodyRows: [
        ["1", "2"],
        ["3", "4"],
      ],
      alignments: ["none", "none"],
      selected: false,
      diagnostics: null,
    });
    const dom = widget.toDOM(view) as unknown as FakeElement;
    const menu = dom.querySelector<HTMLElement>(
      ".cm-md-table-widget__menu",
    ) as unknown as FakeElement;

    const rowToggle = dom.querySelector<HTMLElement>(
      '[data-table-toggle="row"]',
    ) as unknown as FakeElement;
    dom.dispatch("click", { target: rowToggle } as unknown as MouseEvent);
    const deleteItem = dom.querySelector<HTMLElement>(
      '[data-table-action="delete-row"]',
    ) as unknown as FakeElement;
    dom.dispatch("click", { target: deleteItem } as unknown as MouseEvent);

    // 删除行 1（第 0 行 body）生效；菜单关闭、文档级监听移除。
    expect(state.doc.toString()).toBe("| a | b |\n| - | - |\n| 3 | 4 |");
    expect(menu.hidden).toBe(true);
    expect(document.listenerCount()).toBe(0);
  });

  it("switches column alignment from the column menu", () => {
    let state = EditorState.create({
      doc: "| a | b |\n| - | - |\n| 1 | 2 |",
      selection: EditorSelection.cursor(0),
      extensions: [
        markdown({ extensions: M1_MARKDOWN_EXTENSIONS, addKeymap: false }),
        editorModeField,
        markdownRangeIndexField,
        configureWysiwygProjectionFeatures(["tables"]),
        wysiwygProjectionField,
        wysiwygChangeProtection,
      ],
    });
    const document = new FakeDocument();
    const view = {
      dom: { ownerDocument: document },
      get state() {
        return state;
      },
      dispatch(spec: Parameters<EditorState["update"]>[0]) {
        state = state.update(spec).state;
      },
      focus() {},
    } as unknown as EditorView;

    const table = state.field(markdownRangeIndexField).byKind("table")[0]!;
    const widget = new TableGridWidget({
      recordId: table.id,
      headerCells: ["a", "b"],
      bodyRows: [["1", "2"]],
      alignments: ["none", "none"],
      selected: false,
      diagnostics: null,
    });
    const dom = widget.toDOM(view) as unknown as FakeElement;
    const menu = dom.querySelector<HTMLElement>(
      ".cm-md-table-widget__menu",
    ) as unknown as FakeElement;

    const colToggle = dom.querySelector<HTMLElement>(
      '[data-table-toggle="col"]',
    ) as unknown as FakeElement;
    dom.dispatch("click", { target: colToggle } as unknown as MouseEvent);
    const alignItem = dom.querySelector<HTMLElement>(
      '[data-table-action="align-right"]',
    ) as unknown as FakeElement;
    dom.dispatch("click", { target: alignItem } as unknown as MouseEvent);

    // 点击的是第 0 列菜单的 align-right：delimiter 第 0 列变为 `---:`，菜单关闭、监听移除。
    expect(state.doc.toString()).toBe("| a | b |\n| ---: | - |\n| 1 | 2 |");
    expect(state.field(markdownRangeIndexField).byKind("table")[0]?.tableBlock?.alignments[0]).toBe(
      "right",
    );
    expect(menu.hidden).toBe(true);
    expect(document.listenerCount()).toBe(0);
  });

  it("does not preventDefault on left-click cells; clears the atom highlight when selected", () => {
    const { view, dom } = createTableWidget({ selected: true });
    const cell = dom.querySelector<HTMLElement>("tbody td") as unknown as FakeElement;
    const preventDefault = vi.fn();
    const dispatch = vi.fn();
    (view as unknown as { dispatch: (value: unknown) => void }).dispatch = dispatch;

    // pointerdown 监听器注册在 wrapper 上，冒泡目标为单元格。
    dom.dispatch("pointerdown", { preventDefault, target: cell } as unknown as MouseEvent);

    // 根因回归：旧实现拦截 pointerdown，导致左键无法把焦点交给 contenteditable。
    expect(preventDefault).not.toHaveBeenCalled();
    // 表格处于原子选中态时，单击单元格先清除整表高亮。
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it("syncs cell text and selection in place; asks for rebuild when the grid structure changes", () => {
    const { dom, widget } = createTableWidget();

    const updated = new TableGridWidget({
      ...widget.value,
      bodyRows: [
        ["11", "22"],
        ["3", "4"],
      ],
      selected: true,
    });
    expect(updated.eq(widget)).toBe(false);
    expect(updated.updateDOM(dom as unknown as HTMLElement)).toBe(true);
    expect((dom.querySelector<HTMLElement>("tbody td") as unknown as FakeElement).textContent).toBe(
      "11",
    );
    expect(dom.getAttribute("aria-selected")).toBe("true");

    // 行列数变化时返回 false，让 CM6 重建 widget。
    const restructured = new TableGridWidget({
      ...widget.value,
      bodyRows: [
        ["1", "2"],
        ["3", "4"],
        ["5", "6"],
      ],
    });
    expect(restructured.updateDOM(dom as unknown as HTMLElement)).toBe(false);
  });

  it("releases every listener on destroy", () => {
    const { dom, document, widget, diagnostics } = createTableWidget();
    expect(dom.listenerCount()).toBe(5);

    // 打开菜单（注册文档级点击监听）后再销毁：所有监听都要释放。
    const rowToggle = dom.querySelector<HTMLElement>(
      '[data-table-toggle="row"]',
    ) as unknown as FakeElement;
    dom.dispatch("click", { target: rowToggle } as unknown as MouseEvent);
    expect(document.listenerCount()).toBe(1);

    widget.destroy(dom as unknown as HTMLElement);
    expect(dom.listenerCount()).toBe(0);
    expect(document.listenerCount()).toBe(0);
    expect(diagnostics.snapshot().widgetLifecycleCounts.table).toEqual({
      create: 1,
      update: 0,
      destroy: 1,
    });
  });
});

describe("table widget select-all inside a cell", () => {
  // 真实 EditorState（与 table-editing 相同的扩展集）+ Fake DOM，模拟单元格内 keydown。
  function createRealView(doc: string): {
    readonly view: EditorView;
    readonly getState: () => EditorState;
  } {
    let state = EditorState.create({
      doc,
      selection: EditorSelection.cursor(doc.length),
      extensions: [
        markdown({ extensions: M1_MARKDOWN_EXTENSIONS, addKeymap: false }),
        editorModeField,
        markdownRangeIndexField,
        configureWysiwygProjectionFeatures(["tables"]),
        wysiwygProjectionField,
        wysiwygChangeProtection,
      ],
    });
    const document = new FakeDocument();
    const view = {
      dom: { ownerDocument: document },
      get state() {
        return state;
      },
      dispatch(spec: Parameters<EditorState["update"]>[0]) {
        state = state.update(spec).state;
      },
      focus() {},
    } as unknown as EditorView;
    return { view, getState: () => state };
  }

  it("Cmd+A inside a cell commits the edit and selects the whole table atom", () => {
    const doc = "| a | b |\n| - | - |\n| 1 | 2 |";
    const { view, getState } = createRealView(doc);
    const table = getState().field(markdownRangeIndexField).byKind("table")[0];
    const widget = new TableGridWidget({
      recordId: table.id,
      headerCells: ["a", "b"],
      bodyRows: [["1", "2"]],
      alignments: ["none", "none"],
      selected: false,
      diagnostics: null,
    });
    const dom = widget.toDOM(view) as unknown as FakeElement;
    const cell = dom.querySelector<HTMLElement>("tbody td") as unknown as FakeElement;
    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();

    dom.dispatch("keydown", {
      key: "a",
      metaKey: true,
      target: cell,
      preventDefault,
      stopPropagation,
    } as unknown as KeyboardEvent);

    // 浏览器默认行为被拦截，选区切换为整表原子（fresh 读取避免提交造成位移）。
    expect(preventDefault).toHaveBeenCalledTimes(1);
    const fresh = getState().field(markdownRangeIndexField).byKind("table")[0];
    expect(getState().selection.main.from).toBe(fresh.fullRange.from);
    expect(getState().selection.main.to).toBe(fresh.fullRange.to);
  });

  it("plain 'a' is not intercepted so the browser keeps cell-level selection", () => {
    const doc = "| a | b |\n| - | - |\n| 1 | 2 |";
    const { view, getState } = createRealView(doc);
    const table = getState().field(markdownRangeIndexField).byKind("table")[0];
    const widget = new TableGridWidget({
      recordId: table.id,
      headerCells: ["a", "b"],
      bodyRows: [["1", "2"]],
      alignments: ["none", "none"],
      selected: false,
      diagnostics: null,
    });
    const dom = widget.toDOM(view) as unknown as FakeElement;
    const cell = dom.querySelector<HTMLElement>("tbody td") as unknown as FakeElement;
    const preventDefault = vi.fn();

    dom.dispatch("keydown", { key: "a", target: cell, preventDefault } as unknown as KeyboardEvent);

    expect(preventDefault).not.toHaveBeenCalled();
  });
});
