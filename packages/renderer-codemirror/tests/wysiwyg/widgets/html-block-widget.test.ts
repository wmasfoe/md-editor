// @vitest-environment jsdom

if (typeof Range !== "undefined" && !Range.prototype.getClientRects) {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
}

import { history, undo } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { EditorSelection, EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
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

  it("renders placeholder for unsafe/unsupported HTML structures", () => {
    const view = mountView("Before\n\n<table><tr><td>Data</td></tr></table>\n\nAfter\n");
    const widget = projectedWidget(view);

    const placeholder = widget.querySelector(".cm-md-html-block-widget__placeholder");
    expect(placeholder?.textContent).toContain("Unsupported or unsafe HTML block");
  });
});
