// @vitest-environment jsdom

if (typeof Range !== "undefined" && !Range.prototype.getClientRects) {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
}

import { history, undo } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { EditorSelection, EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { virtualTrailingLineExtension } from "../../../src/wysiwyg/editing/virtual-trailing-line.ts";
import { virtualTrailingLineActiveField } from "../../../src/wysiwyg/state/types.ts";
import { HtmlBlockWidget } from "../../../src/wysiwyg/widgets/html-block-widget.ts";
import { openLinkTargetFacet } from "../../../src/wysiwyg/view/link-interaction.ts";
import { afterEach, describe, expect, it } from "vitest";
import { M1_MARKDOWN_EXTENSIONS } from "../../../src/markdown/extensions.ts";
import { markdownRangeIndexField } from "../../../src/markdown/range-index.ts";
import { editorModeField } from "../../../src/mode.ts";
import { wysiwygChangeProtection } from "../../../src/wysiwyg/state/change-protection.ts";
import {
  configureWysiwygProjectionFeatures,
  inspectWysiwygProjection,
  wysiwygProjectionField,
} from "../../../src/wysiwyg/state/projection-field.ts";
import {
  htmlProjectionTheme,
  htmlSourceKeymap,
} from "../../../src/wysiwyg/projections/html-projection.ts";

const views: EditorView[] = [];

function parentExtensions(): Extension[] {
  return [
    history(),
    markdown({ extensions: M1_MARKDOWN_EXTENSIONS, addKeymap: false }),
    editorModeField,
    markdownRangeIndexField,
    configureWysiwygProjectionFeatures(["html"]),
    wysiwygProjectionField,
    wysiwygChangeProtection,
    htmlProjectionTheme,
    htmlSourceKeymap,
    virtualTrailingLineExtension,
  ];
}

function mountView(doc: string): EditorView {
  const parent = document.createElement("div");
  document.body.append(parent);
  const view = new EditorView({
    parent,
    state: EditorState.create({ doc, extensions: parentExtensions() }),
  });
  views.push(view);
  return view;
}

function projectedWidget(view: EditorView): HTMLElement {
  const widget = view.dom.querySelector(".cm-md-html-block-widget");
  if (!(widget instanceof HTMLElement)) {
    throw new Error("HTML block widget was not mounted");
  }
  return widget;
}

function clickControl(dom: HTMLElement, selector: string): void {
  const button = dom.querySelector(selector);
  if (!(button instanceof HTMLElement)) {
    throw new Error(`missing ${selector}`);
  }
  button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

function dispatchKey(view: EditorView, key: string, mod = false): void {
  const apple = /Mac|iPhone|iPad|iPod/i.test(navigator.platform);
  view.focus();
  view.contentDOM.dispatchEvent(
    new KeyboardEvent("keydown", {
      key,
      code: key === "Enter" ? "Enter" : key,
      bubbles: true,
      cancelable: true,
      ctrlKey: mod && !apple,
      metaKey: mod && apple,
    }),
  );
}

afterEach(() => {
  for (const view of views) {
    view.destroy();
  }
  views.length = 0;
  document.body.replaceChildren();
});

describe("HtmlBlockWidget native in-place reveal (Option A)", () => {
  it("renders sanitized HTML preview with hover edit control", () => {
    const view = mountView("Before\n\n<div>Safe</div>\n\nAfter\n");
    const widget = projectedWidget(view);
    expect(widget.closest(".cm-editor")).toBe(view.dom);

    const content = widget.querySelector(".cm-md-html-block-widget__content");
    expect(content?.innerHTML).toContain("<div>Safe</div>");

    const editBtn = widget.querySelector(".cm-md-html-block-widget__btn--edit");
    expect(editBtn?.textContent).toBe("编辑源码");
  });

  it("clicking the edit button reveals HTML source lines in the parent editor", () => {
    const original = "Before\n\n<div>Safe</div>\n\nAfter\n";
    const view = mountView(original);
    const widget = projectedWidget(view);

    clickControl(widget, ".cm-md-html-block-widget__btn--edit");

    // 点击后挂件替换解除，光标落入 HTML 块首字符，主编辑器原位展现源码行
    expect(view.dom.querySelector(".cm-md-html-block-widget")).toBeNull();
    expect(view.dom.querySelector(".cm-md-html-source-line")).not.toBeNull();
    const projection = inspectWysiwygProjection(view.state);
    const htmlRecord = view.state.field(markdownRangeIndexField).byKind("html")[0];
    expect(projection.activeSyntaxIds).toContain(htmlRecord.id);
  });

  it("clicking the widget selects the atom, and double-clicking activates in-place source editing", () => {
    const original = "Before\n\n<div>Clickable</div>\n\nAfter\n";
    const view = mountView(original);
    const widget = projectedWidget(view);

    // 单击块体：原子选中
    widget.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(projectedWidget(view).getAttribute("aria-selected")).toBe("true");

    // 双击块体：激活就地源码编辑
    projectedWidget(view).dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(view.dom.querySelector(".cm-md-html-block-widget")).toBeNull();
    expect(view.dom.querySelector(".cm-md-html-source-line")).not.toBeNull();
  });

  it("allows native typing and seamless undo/redo in the parent editor", () => {
    const original = "Before\n\n<div>Safe</div>\n\nAfter\n";
    const view = mountView(original);
    const widget = projectedWidget(view);

    clickControl(widget, ".cm-md-html-block-widget__btn--edit");

    // 原生向主编辑器派发字符修改
    const htmlRecord = view.state.field(markdownRangeIndexField).byKind("html")[0];
    view.dispatch({
      changes: {
        from: htmlRecord.fullRange.from,
        to: htmlRecord.fullRange.to,
        insert: "<div>Edited Content</div>",
      },
    });

    expect(view.state.doc.toString()).toContain("<div>Edited Content</div>");

    // 全局单栈撤销天然连续
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(original);
  });

  it("exits source editing and re-renders HTML widget when cursor moves away", () => {
    const original = "Before\n\n<div>Safe</div>\n\nAfter\n";
    const view = mountView(original);
    const widget = projectedWidget(view);

    clickControl(widget, ".cm-md-html-block-widget__btn--edit");
    expect(view.dom.querySelector(".cm-md-html-block-widget")).toBeNull();

    // 光标移动到文档开头（离开 HTML 块）
    view.dispatch({ selection: EditorSelection.cursor(0) });

    // 重新折叠为视觉预览挂件
    expect(view.dom.querySelector(".cm-md-html-block-widget")).not.toBeNull();
    const newWidget = projectedWidget(view);
    expect(newWidget.querySelector(".cm-md-html-block-widget__content")?.innerHTML).toContain(
      "<div>Safe</div>",
    );
  });

  it("Mod-Enter leaves a comment-prefixed line without a newline so undo restores the HTML block", () => {
    const original = "Before\n\n<div>Safe peek</div>\n\nAfter\n";
    const view = mountView(original);
    clickControl(projectedWidget(view), ".cm-md-html-block-widget__btn--edit");
    const from = view.state.selection.main.head;
    const inserted = "<!--peek-->";
    view.dispatch({
      changes: { from, insert: inserted },
      selection: EditorSelection.cursor(from + inserted.length),
      userEvent: "input.type",
    });
    const peeked = view.state.doc.toString();
    const comment = view.state
      .field(markdownRangeIndexField)
      .records.find((record) => record.nodeName === "CommentBlock");
    expect(comment?.fullRange.from).toBe(from);

    dispatchKey(view, "Enter", true);

    expect(view.state.doc.toString()).toBe(peeked);
    expect(view.state.selection.main.head).toBe((comment?.fullRange.to ?? 0) + 1);
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(original);
  });

  it("Mod-Enter exits source editing and moves cursor to the next line", () => {
    const original = "Before\n\n<div>Keyed</div>\n\nAfter\n";
    const view = mountView(original);
    const widget = projectedWidget(view);

    clickControl(widget, ".cm-md-html-block-widget__btn--edit");
    expect(view.dom.querySelector(".cm-md-html-block-widget")).toBeNull();

    dispatchKey(view, "Enter", true);

    expect(view.dom.querySelector(".cm-md-html-block-widget")).not.toBeNull();
    expect(view.state.selection.main.head).toBeGreaterThan(
      original.indexOf("<div>Keyed</div>") + "<div>Keyed</div>".length,
    );
  });

  it("Escape exits source editing and moves cursor out to re-render", () => {
    const original = "Before\n\n<div>Escaped</div>\n\nAfter\n";
    const view = mountView(original);
    const widget = projectedWidget(view);

    clickControl(widget, ".cm-md-html-block-widget__btn--edit");
    expect(view.dom.querySelector(".cm-md-html-block-widget")).toBeNull();

    dispatchKey(view, "Escape");

    expect(view.dom.querySelector(".cm-md-html-block-widget")).not.toBeNull();
  });

  it("Mod-Enter on a selected atom reveals source", () => {
    const view = mountView("Before\n\n<div>Toggle</div>\n\nAfter\n");
    const widget = projectedWidget(view);
    widget.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(projectedWidget(view).getAttribute("aria-selected")).toBe("true");

    dispatchKey(view, "Enter", true);

    expect(view.dom.querySelector(".cm-md-html-block-widget")).toBeNull();
    expect(view.dom.querySelector(".cm-md-html-source-banner")?.textContent).toContain("Esc");
    expect(view.state.doc.toString()).toBe("Before\n\n<div>Toggle</div>\n\nAfter\n");
  });

  it("Escape at EOF collapses the preview onto the virtual line without changing the document", () => {
    const original = "Before\n\n<div>End</div>";
    const view = mountView(original);
    clickControl(projectedWidget(view), ".cm-md-html-block-widget__btn--edit");
    expect(view.dom.querySelector(".cm-md-html-source-line")).not.toBeNull();

    dispatchKey(view, "Escape");

    expect(view.dom.querySelector(".cm-md-html-block-widget")).not.toBeNull();
    expect(view.state.doc.toString()).toBe(original);
    expect(view.state.field(virtualTrailingLineActiveField)).toBe(true);
    expect(view.dom.querySelector(".cm-virtual-trailing-line--active")).not.toBeNull();
  });

  it("opens a safe preview link without selecting the atom", () => {
    const opened: string[] = [];
    const parent = document.createElement("div");
    document.body.append(parent);
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: 'Before\n\n<div><a href="https://example.com">Docs</a></div>\n\nAfter\n',
        extensions: [...parentExtensions(), openLinkTargetFacet.of((url) => opened.push(url))],
      }),
    });
    views.push(view);

    const anchor = projectedWidget(view).querySelector("a");
    if (!(anchor instanceof HTMLElement)) {
      throw new Error("preview link was not rendered");
    }
    anchor.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    expect(opened).toEqual(["https://example.com"]);
    expect(projectedWidget(view).getAttribute("aria-selected")).toBe("false");
  });

  it("rebuilds preview DOM without script nodes or event handler attributes", () => {
    const view = mountView("x");
    const widget = new HtmlBlockWidget({
      recordId: "html-rebuild",
      sanitizedHtml:
        '<div>Safe</div><img src="x" onerror="alert(1)"><script>alert(1)</script><a href="javascript:alert(1)">x</a>',
      placeholder: null,
      selected: false,
      diagnostics: null,
    });
    const content = widget.toDOM(view).querySelector(".cm-md-html-block-widget__content");
    expect(content?.querySelector("script")).toBeNull();
    expect(content?.querySelector("img")?.hasAttribute("onerror")).toBe(false);
    expect(content?.querySelector("a")?.getAttribute("href") ?? "").not.toMatch(/javascript:/i);
    expect(content?.textContent).toContain("Safe");
  });

  it("renders placeholder for unsafe/unsupported HTML structures", () => {
    const view = mountView("Before\n\n<table><tr><td>Data</td></tr></table>\n\nAfter\n");
    const widget = projectedWidget(view);

    const placeholder = widget.querySelector(".cm-md-html-block-widget__placeholder");
    expect(placeholder?.textContent).toContain("Unsupported or unsafe HTML block");
  });
});
