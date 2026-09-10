import { markdown } from "@codemirror/lang-markdown";
import { EditorSelection, EditorState, type StateEffect } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { WysiwygDiagnostics } from "../../src/diagnostics.ts";
import { M1_MARKDOWN_EXTENSIONS } from "../../src/markdown/extensions.ts";
import { markdownRangeIndexField } from "../../src/markdown/range-index.ts";
import { editorModeField } from "../../src/mode.ts";
import {
  configureWysiwygProjectionFeatures,
  wysiwygProjectionField,
} from "../../src/wysiwyg/projection-state.ts";
import {
  commitTableCell,
  deleteTableBodyRow,
  deleteTableColumn,
  exitTableWithParagraph,
  insertTableBodyRow,
  insertTableColumn,
  setTableColumnAlignment,
} from "../../src/wysiwyg/table-editing.ts";
import { TableGridWidget, flushActiveTableCell } from "../../src/wysiwyg/widgets/table-widget.ts";
import { wysiwygChangeProtection } from "../../src/wysiwyg/change-protection.ts";
import {
  createCodeMirrorRendererWithFactory,
  type RendererViewAdapter,
} from "../../src/renderer.ts";

function createView(doc: string): { view: EditorView; getState: () => EditorState } {
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
  const view = {
    get state() {
      return state;
    },
    dispatch(spec: Parameters<EditorState["update"]>[0] | ReturnType<EditorState["update"]>) {
      state = ("state" in spec && spec.state ? spec : state.update(spec as never)).state;
    },
  } as unknown as EditorView;
  return {
    view,
    getState: () => state,
  };
}

describe("table cell / structure editing", () => {
  it("commits a body cell edit into GFM source through protected authorization", () => {
    const doc = "| a | b |\n| - | - |\n| 1 | 2 |";
    const { view, getState } = createView(doc);
    const table = getState().field(markdownRangeIndexField).byKind("table")[0];
    expect(
      commitTableCell(
        view,
        { recordId: table.id, rowKind: "body", rowIndex: 0, colIndex: 1 },
        "edited",
      ),
    ).toBe(true);
    expect(getState().doc.toString()).toBe("| a | b |\n| - | - |\n| 1 | edited |");
  });

  it("escapes pipes written into a cell", () => {
    const doc = "| a | b |\n| - | - |\n| 1 | 2 |";
    const { view, getState } = createView(doc);
    const table = getState().field(markdownRangeIndexField).byKind("table")[0];
    commitTableCell(
      view,
      { recordId: table.id, rowKind: "header", rowIndex: 0, colIndex: 0 },
      "x|y",
    );
    expect(getState().doc.toString().startsWith("| x\\|y | b |")).toBe(true);
  });

  it("inserts and deletes body rows", () => {
    const doc = "| a | b |\n| - | - |\n| 1 | 2 |";
    const { view, getState } = createView(doc);
    let table = getState().field(markdownRangeIndexField).byKind("table")[0];
    expect(insertTableBodyRow(view, table.id, 0)).toBe(true);
    const afterInsert = getState().doc.toString();
    expect(afterInsert.split("\n").length).toBeGreaterThan(3);
    table = getState().field(markdownRangeIndexField).byKind("table")[0];
    expect(table).toBeDefined();
    expect(table.tableBlock?.bodyRowCount).toBe(2);
    expect(deleteTableBodyRow(view, table.id, 1)).toBe(true);
    expect(getState().doc.toString()).toContain("| 1 | 2 |");
    table = getState().field(markdownRangeIndexField).byKind("table")[0];
    expect(table).toBeDefined();
    expect(table.tableBlock?.bodyRowCount).toBe(1);
  });

  it("inserts and deletes columns across header, delimiter, and body", () => {
    const doc = "| a | b |\n| - | - |\n| 1 | 2 |";
    const { view, getState } = createView(doc);
    let table = getState().field(markdownRangeIndexField).byKind("table")[0];
    expect(insertTableColumn(view, table.id, 1)).toBe(true);
    table = getState().field(markdownRangeIndexField).byKind("table")[0];
    expect(table.tableBlock?.columnCount).toBe(3);
    expect(getState().doc.toString()).toMatch(/\| a \|  \| b \|/);
    expect(deleteTableColumn(view, table.id, 1)).toBe(true);
    table = getState().field(markdownRangeIndexField).byKind("table")[0];
    expect(table.tableBlock?.columnCount).toBe(2);
  });

  it("refuses to delete the last remaining column", () => {
    const doc = "| a |\n| - |\n| 1 |";
    const { view, getState } = createView(doc);
    const table = getState().field(markdownRangeIndexField).byKind("table")[0];
    expect(deleteTableColumn(view, table.id, 0)).toBe(false);
    expect(getState().doc.toString()).toBe(doc);
  });

  it("switches a column alignment by rewriting its delimiter marker", () => {
    const doc = "| a | b |\n| - | - |\n| 1 | 2 |";
    const { view, getState } = createView(doc);
    const table = getState().field(markdownRangeIndexField).byKind("table")[0];
    expect(setTableColumnAlignment(view, table.id, 1, "center")).toBe(true);
    const afterCenter = getState().doc.toString();
    expect(afterCenter).toBe("| a | b |\n| - | :---: |\n| 1 | 2 |");
    let fresh = getState().field(markdownRangeIndexField).byKind("table")[0];
    expect(fresh.tableBlock?.alignments[1]).toBe("center");

    // 再切回无对齐：`:-:` → `---`（GFM 允许任意 ≥1 个 `-`），其余单元格内容不受影响。
    expect(setTableColumnAlignment(view, fresh.id, 1, "none")).toBe(true);
    expect(getState().doc.toString()).toBe("| a | b |\n| - | --- |\n| 1 | 2 |");
    fresh = getState().field(markdownRangeIndexField).byKind("table")[0];
    expect(fresh.tableBlock?.alignments[1]).toBe("none");
  });

  it("ignores alignment changes for out-of-range columns", () => {
    const doc = "| a | b |\n| - | - |\n| 1 | 2 |";
    const { view, getState } = createView(doc);
    const table = getState().field(markdownRangeIndexField).byKind("table")[0];
    expect(setTableColumnAlignment(view, table.id, 5, "left")).toBe(false);
    expect(getState().doc.toString()).toBe(doc);
  });

  it("exits the table with a new paragraph after the last row (document end)", () => {
    const doc = "| a | b |\n| - | - |\n| 1 | 2 |";
    const { view, getState } = createView(doc);
    const table = getState().field(markdownRangeIndexField).byKind("table")[0];
    expect(exitTableWithParagraph(view, table.id)).toBe(true);
    expect(getState().doc.toString()).toBe(`${doc}\n\n`);
    expect(getState().selection.main.head).toBe(doc.length + 2);
  });

  it("inserts a fresh paragraph line after the table's blank separator", () => {
    const doc = "| a | b |\n| - | - |\n| 1 | 2 |\n\nnext paragraph";
    const { view, getState } = createView(doc);
    const table = getState().field(markdownRangeIndexField).byKind("table")[0];
    expect(exitTableWithParagraph(view, table.id)).toBe(true);
    // 终止空行保留不动（它保护表格不被 GFM 吞并），新空行 + 分隔空行插在其后。
    expect(getState().doc.toString()).toBe("| a | b |\n| - | - |\n| 1 | 2 |\n\n\n\nnext paragraph");
    expect(getState().selection.main.head).toBe(31);
  });

  it("keeps the blank terminator and continues the paragraph on a fresh line below it", () => {
    const doc = [
      "Before table.",
      "",
      "| Header A | Header B |",
      "| --- | --- |",
      "| 1 | 2 |",
      "| 3 | 4x |",
      "",
      "After table.",
      "",
    ].join("\n");
    const { view, getState } = createView(doc);
    const table = getState().field(markdownRangeIndexField).byKind("table")[0];
    expect(exitTableWithParagraph(view, table.id)).toBe(true);
    const head = getState().selection.main.head;
    // 光标落在新空行上；打字不再吞掉终止空行，表格范围保持稳定。
    const typed = getState().update({
      changes: { from: head, to: head, insert: "Tail" },
      userEvent: "input.type",
    }).state;
    expect(typed.doc.toString()).toBe(
      [
        "Before table.",
        "",
        "| Header A | Header B |",
        "| --- | --- |",
        "| 1 | 2 |",
        "| 3 | 4x |",
        "",
        "Tail",
        "",
        "After table.",
        "",
      ].join("\n"),
    );
  });
});

class MockDOMElement {
  readonly nodeType = 1;
  parentElement: MockDOMElement | null = null;
  children: MockDOMElement[] = [];
  classList = {
    _classes: new Set<string>(),
    add: (...cls: string[]) => cls.forEach((c) => this.classList._classes.add(c)),
    remove: (...cls: string[]) => cls.forEach((c) => this.classList._classes.delete(c)),
    toggle: (c: string, force?: boolean) => {
      const has = this.classList._classes.has(c);
      const next = force !== undefined ? force : !has;
      if (next) this.classList._classes.add(c);
      else this.classList._classes.delete(c);
      return next;
    },
    contains: (c: string) => this.classList._classes.has(c),
  };
  dataset: Record<string, string> = {};
  style: Record<string, string> = {};
  attributes: Record<string, string> = {};
  textContent = "";
  innerText = "";
  contentEditable = "inherit";
  spellcheck = true;
  type = "";
  scope = "";
  title = "";
  hidden = false;
  tagName: string;
  ownerDocument: MockDocument;
  #listeners: Record<string, EventListener[]> = {};

  constructor(tagName: string, doc: MockDocument) {
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = doc;
  }

  get className(): string {
    return Array.from(this.classList._classes).join(" ");
  }
  set className(val: string) {
    this.classList._classes = new Set(val.split(/\s+/).filter(Boolean));
  }

  append(...nodes: (MockDOMElement | string)[]) {
    for (const n of nodes) {
      if (typeof n === "string") {
        this.textContent += n;
      } else {
        n.parentElement = this;
        this.children.push(n);
      }
    }
  }

  appendChild(child: MockDOMElement) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  remove() {
    if (this.parentElement) {
      this.parentElement.children = this.parentElement.children.filter((c) => c !== this);
      this.parentElement = null;
    }
  }

  replaceChildren(...nodes: (MockDOMElement | string)[]) {
    this.children.forEach((c) => {
      c.parentElement = null;
    });
    this.children = [];
    this.textContent = "";
    this.append(...nodes);
  }

  setAttribute(name: string, val: string) {
    this.attributes[name] = val;
  }
  getAttribute(name: string) {
    return this.attributes[name] ?? null;
  }
  removeAttribute(name: string) {
    delete this.attributes[name];
  }

  closest<T extends MockDOMElement = MockDOMElement>(selector: string): T | null {
    if (this.matches(selector)) {
      return this as unknown as T;
    }
    return this.parentElement?.closest<T>(selector) ?? null;
  }

  matches(selector: string): boolean {
    const parts = selector.split(",").map((s) => s.trim());
    return parts.some((sel) => this.#matchesSingle(sel));
  }

  #matchesSingle(selector: string): boolean {
    if (selector.startsWith("[")) {
      const match = selector.match(/\[([^=\]]+)(?:="?([^"\]]*)"?)?\]/);
      if (match) {
        const [, key, val] = match;
        if (key.startsWith("data-")) {
          const rawKey = key.slice(5);
          const camelKey = rawKey.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
          const actualVal = this.dataset[camelKey] ?? this.dataset[rawKey];
          return val !== undefined ? actualVal === val : actualVal !== undefined;
        }
        return val !== undefined ? this.attributes[key] === val : key in this.attributes;
      }
      return false;
    }
    const dotIdx = selector.indexOf(".");
    if (dotIdx === -1) {
      return selector.toLowerCase() === this.tagName.toLowerCase();
    }
    const tagPart = selector.slice(0, dotIdx);
    const classParts = selector
      .slice(dotIdx + 1)
      .split(".")
      .filter(Boolean);
    if (tagPart && tagPart.toLowerCase() !== this.tagName.toLowerCase()) {
      return false;
    }
    return classParts.every((c) => this.classList.contains(c));
  }

  contains(other: MockDOMElement | null): boolean {
    if (!other) {
      return false;
    }
    if (other === this) {
      return true;
    }
    return this.contains(other.parentElement);
  }

  querySelector<T extends MockDOMElement = MockDOMElement>(selector: string): T | null {
    const parts = selector.trim().split(/\s+/);
    if (parts.length > 1) {
      const first = parts[0];
      const rest = parts.slice(1).join(" ");
      for (const child of this.children) {
        if (child.matches(first)) {
          const found = child.querySelector<T>(rest);
          if (found) return found;
        }
        const found = child.querySelector<T>(selector);
        if (found) return found;
      }
      return null;
    }
    for (const child of this.children) {
      if (child.matches(selector)) return child as T;
      const found = child.querySelector<T>(selector);
      if (found) return found;
    }
    return null;
  }

  querySelectorAll<T extends MockDOMElement = MockDOMElement>(selector: string): T[] {
    const parts = selector.trim().split(/\s+/);
    if (parts.length > 1) {
      const first = parts[0];
      const rest = parts.slice(1).join(" ");
      const res: T[] = [];
      for (const child of this.children) {
        if (child.matches(first)) {
          res.push(...child.querySelectorAll<T>(rest));
        }
        res.push(...child.querySelectorAll<T>(selector));
      }
      return Array.from(new Set(res));
    }
    const res: T[] = [];
    for (const child of this.children) {
      if (child.matches(selector)) res.push(child as T);
      res.push(...child.querySelectorAll<T>(selector));
    }
    return res;
  }

  cloneNode(deep = false): MockDOMElement {
    const copy = new MockDOMElement(this.tagName, this.ownerDocument);
    copy.classList._classes = new Set(this.classList._classes);
    copy.dataset = { ...this.dataset };
    copy.attributes = { ...this.attributes };
    copy.textContent = this.textContent;
    copy.innerText = this.innerText || this.textContent;
    if (deep) {
      copy.children = this.children.map((c) => {
        const childCopy = c.cloneNode(true);
        childCopy.parentElement = copy;
        return childCopy;
      });
    }
    return copy;
  }

  addEventListener(type: string, listener: EventListener) {
    this.#listeners[type] = this.#listeners[type] || [];
    this.#listeners[type].push(listener);
  }

  removeEventListener(type: string, listener: EventListener) {
    if (this.#listeners[type]) {
      this.#listeners[type] = this.#listeners[type].filter((l) => l !== listener);
    }
  }

  dispatchEvent(event: { type: string; [key: string]: unknown }) {
    if (!event.target) {
      (event as { target?: unknown }).target = this;
    }
    const listeners = this.#listeners[event.type] || [];
    listeners.forEach((l) => l(event as unknown as Event));
    if (this.parentElement) {
      this.parentElement.dispatchEvent(event);
    }
    return true;
  }

  focus() {
    this.ownerDocument.activeElement = this;
  }

  blur() {
    if (this.ownerDocument.activeElement === this) {
      this.ownerDocument.activeElement = null;
    }
  }
}

class MockDocument {
  activeElement: MockDOMElement | null = null;
  createElement(tag: string): MockDOMElement {
    return new MockDOMElement(tag, this);
  }
  createRange() {
    return {
      selectNodeContents: () => {},
    };
  }
  defaultView = {
    getSelection: () => ({
      removeAllRanges: () => {},
      addRange: () => {},
    }),
  };
  addEventListener() {}
  removeEventListener() {}
}

describe("TableGridWidget DOM structure and pending edits flush", () => {
  function createDomView(doc: string) {
    const mockDoc = new MockDocument();
    const dom = mockDoc.createElement("div");
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
    const view = {
      dom,
      get state() {
        return state;
      },
      dispatch(spec: Parameters<EditorState["update"]>[0] | ReturnType<EditorState["update"]>) {
        state = ("state" in spec && spec.state ? spec : state.update(spec as never)).state;
      },
      focus() {},
    } as unknown as EditorView;
    return { view, mockDoc, dom, getState: () => state };
  }

  it("decouples cell editor from action handles so all cells remain editable", () => {
    const doc = "| Header 1 | Header 2 |\n| --- | --- |\n| Cell 1 | Cell 2 |";
    const { view } = createDomView(doc);
    const table = view.state.field(markdownRangeIndexField).byKind("table")[0];

    const widget = new TableGridWidget({
      recordId: table.id,
      selected: false,
      headerCells: ["Header 1", "Header 2"],
      bodyRows: [["Cell 1", "Cell 2"]],
      alignments: ["none", "none"],
      diagnostics: new WysiwygDiagnostics(),
    });

    const widgetDom = widget.toDOM(view) as unknown as MockDOMElement;
    expect(widgetDom).toBeDefined();

    // Check all headers have inner cell-editor and column handles outside cell-editor
    const headerCells = widgetDom.querySelectorAll("th.cm-md-table-widget__cell");
    expect(headerCells.length).toBe(2);
    for (const th of headerCells) {
      const editor = th.querySelector(".cm-md-table-widget__cell-editor");
      expect(editor).not.toBeNull();
      expect(editor?.contentEditable).toBe("plaintext-only");
      const handle = th.querySelector(".cm-md-table-widget__handle--col");
      expect(handle).not.toBeNull();
      // Handle is sibling to editor, NOT inside editor
      expect(editor?.contains(handle)).toBe(false);
    }

    // Check body cells: col 0 has row handle, which is NOT inside cell-editor
    const bodyCells = widgetDom.querySelectorAll("td.cm-md-table-widget__cell");
    expect(bodyCells.length).toBe(2);
    const col0Cell = bodyCells[0];
    const rowHandle = col0Cell.querySelector(".cm-md-table-widget__handle--row");
    expect(rowHandle).not.toBeNull();
    const bodyEditor = col0Cell.querySelector(".cm-md-table-widget__cell-editor");
    expect(bodyEditor).not.toBeNull();
    expect(bodyEditor?.contains(rowHandle)).toBe(false);
  });

  it("commits cell edits on intra-table focusout between different cells", () => {
    const doc = "| H1 | H2 |\n| --- | --- |\n| B1 | B2 |";
    const { view, getState } = createDomView(doc);
    const table = view.state.field(markdownRangeIndexField).byKind("table")[0];

    const widget = new TableGridWidget({
      recordId: table.id,
      selected: false,
      headerCells: ["H1", "H2"],
      bodyRows: [["B1", "B2"]],
      alignments: ["none", "none"],
      diagnostics: new WysiwygDiagnostics(),
    });

    const widgetDom = widget.toDOM(view) as unknown as MockDOMElement;
    const headerCells = widgetDom.querySelectorAll("th.cm-md-table-widget__cell");
    const cellA = headerCells[0];
    const cellB = headerCells[1];
    const editorA = cellA.querySelector(".cm-md-table-widget__cell-editor")!;
    const editorB = cellB.querySelector(".cm-md-table-widget__cell-editor")!;

    // Focusin on Cell A
    widgetDom.dispatchEvent({
      type: "focusin",
      target: editorA,
    });
    expect(cellA.classList.contains("cm-md-table-widget__cell--editing")).toBe(true);

    // Edit content in Cell A
    editorA.textContent = "H1_edited";

    // Focusout from Cell A with relatedTarget = editorB (moving inside the table)
    widgetDom.dispatchEvent({
      type: "focusout",
      target: editorA,
      relatedTarget: editorB,
    });

    // Cell A's edit should be committed to the state despite relatedTarget being inside table wrapper
    expect(getState().doc.toString()).toContain("| H1_edited | H2 |");
  });

  it("flushes active unblurred table cell edits immediately via flushActiveTableCell", () => {
    const doc = "| A | B |\n| --- | --- |\n| 1 | 2 |";
    const { view, dom, getState } = createDomView(doc);
    const table = view.state.field(markdownRangeIndexField).byKind("table")[0];

    const widget = new TableGridWidget({
      recordId: table.id,
      selected: false,
      headerCells: ["A", "B"],
      bodyRows: [["1", "2"]],
      alignments: ["none", "none"],
      diagnostics: new WysiwygDiagnostics(),
    });

    const widgetDom = widget.toDOM(view) as unknown as MockDOMElement;
    dom.append(widgetDom);

    const firstCell = widgetDom.querySelector("th.cm-md-table-widget__cell")!;
    const editor = firstCell.querySelector(".cm-md-table-widget__cell-editor")!;

    // Cell is focused and marked editing
    firstCell.classList.add("cm-md-table-widget__cell--editing");
    editor.textContent = "FlushedHeader";

    // Call flushActiveTableCell without blurring (e.g. before mode switch or save)
    const flushed = flushActiveTableCell(view);
    expect(flushed).toBe(true);
    expect(getState().doc.toString()).toContain("| FlushedHeader | B |");
    expect(firstCell.classList.contains("cm-md-table-widget__cell--editing")).toBe(false);

    // Calling again returns false (nothing to flush)
    expect(flushActiveTableCell(view)).toBe(false);
  });

  it("delegates flushPendingEdits from renderer to view adapter and respects destruction", () => {
    const mockDoc = new MockDocument();
    let flushedCount = 0;
    let viewState = EditorState.create({ doc: "# Test" });
    const renderer = createCodeMirrorRendererWithFactory(
      {
        parent: mockDoc.createElement("div") as unknown as HTMLElement,
        initialSnapshot: {
          documentGeneration: 1,
          stateRevision: 1,
          contentRevision: 1,
          markdown: "# Test",
          savedMarkdown: "# Test",
          filePath: null,
          mode: "wysiwyg",
          isDirty: false,
          persistenceStatus: { kind: "verified", checkpointId: null, sequence: null },
        },
        onEditorChange: () => {},
        onQueuedExternalEditReady: () => {},
        onQueuedExternalEditCancelled: () => {},
      },
      (): RendererViewAdapter => ({
        get state() {
          return viewState;
        },
        isComposing: false,
        dispatch: () => {},
        dispatchTransaction: () => {},
        setState: (next) => {
          viewState = next;
        },
        scrollSnapshot: () => ({}) as unknown as StateEffect<unknown>,
        getScrollTop: () => 0,
        setScrollTop: () => {},
        hasFocus: () => false,
        focus: () => {},
        requestMeasure: () => {},
        clearDomSelection: () => {},
        flushPendingEdits: () => {
          flushedCount += 1;
          return true;
        },
        destroy: () => {},
      }),
    );

    expect(renderer.flushPendingEdits()).toBe(true);
    expect(flushedCount).toBe(1);

    renderer.destroy();
    expect(renderer.flushPendingEdits()).toBe(false);
    expect(flushedCount).toBe(1);
  });
});
