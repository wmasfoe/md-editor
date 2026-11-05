// @vitest-environment jsdom

import { history, undo } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { EDITOR_USER_NOTICE_EVENT } from "../../../src/editor-user-notice.ts";
import { M1_MARKDOWN_EXTENSIONS } from "../../../src/markdown/extensions.ts";
import { markdownRangeIndexField } from "../../../src/markdown/range-index.ts";
import { editorModeField } from "../../../src/mode.ts";
import { authorizeWysiwygProtectedChange } from "../../../src/wysiwyg/state/change-authorization.ts";
import { wysiwygChangeProtection } from "../../../src/wysiwyg/state/change-protection.ts";
import {
  configureWysiwygProjectionFeatures,
  wysiwygProjectionField,
} from "../../../src/wysiwyg/state/projection-field.ts";
import { htmlProjectionTheme } from "../../../src/wysiwyg/projections/html-projection.ts";
import {
  HTML_BLOCK_RECORD_MISSING_MESSAGE,
  HtmlBlockWidget,
  getHtmlBlockWidgetState,
  htmlSourcePeekDraftField,
} from "../../../src/wysiwyg/widgets/html-block-widget.ts";

const HTML_DOC = "<div>Shared</div>\n";

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
    htmlSourcePeekDraftField,
    htmlProjectionTheme,
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

function htmlRecordId(view: EditorView): string {
  const record = view.state.field(markdownRangeIndexField).byKind("html")[0];
  if (!record) {
    throw new Error("expected an HTML block");
  }
  return record.id;
}

function projectedWidget(view: EditorView): HTMLElement {
  const widget = view.dom.querySelector(".cm-md-html-block-widget");
  if (!(widget instanceof HTMLElement)) {
    throw new Error("HTML block widget was not mounted");
  }
  return widget;
}

function mountManualWidget(view: EditorView): { widget: HtmlBlockWidget; dom: HTMLElement } {
  const record = view.state.field(markdownRangeIndexField).byKind("html")[0];
  if (!record) {
    throw new Error("expected an HTML block");
  }
  const rawHtml = view.state.sliceDoc(record.fullRange.from, record.fullRange.to);
  const widget = new HtmlBlockWidget({
    recordId: record.id,
    sanitizedHtml: rawHtml,
    placeholder: null,
    selected: false,
    diagnostics: null,
    rawHtml,
  });
  const dom = widget.toDOM(view);
  document.body.append(dom);
  return { widget, dom };
}

function enterPeek(dom: HTMLElement): void {
  dom.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
}

function nestedText(dom: HTMLElement): string {
  const nested = getHtmlBlockWidgetState(dom)?.nestedView;
  if (!nested) {
    throw new Error("nested editor missing");
  }
  return nested.state.doc.toString();
}

function replaceNested(dom: HTMLElement, text: string): void {
  const nested = getHtmlBlockWidgetState(dom)?.nestedView;
  if (!nested) {
    throw new Error("nested editor missing");
  }
  nested.dispatch({ changes: { from: 0, to: nested.state.doc.length, insert: text } });
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

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  for (const view of views) {
    view.destroy();
  }
  views.length = 0;
  document.body.replaceChildren();
});

describe("HtmlBlockWidget source peek", () => {
  it("selects a preview click inside the parent editor and ignores only the nested editor", () => {
    const view = mountView("Before\n\n<div>Safe</div>\n\nAfter\n");
    const widget = projectedWidget(view);
    expect(widget.closest(".cm-editor")).toBe(view.dom);

    const content = widget.querySelector(".cm-md-html-block-widget__content");
    if (!(content instanceof HTMLElement)) {
      throw new Error("missing preview content");
    }
    const click = new MouseEvent("click", { bubbles: true });
    content.dispatchEvent(click);
    const probe = new HtmlBlockWidget({
      recordId: "probe",
      sanitizedHtml: "",
      placeholder: null,
      selected: false,
      diagnostics: null,
    });
    expect(probe.ignoreEvent(click)).toBe(false);
    expect(projectedWidget(view).getAttribute("aria-selected")).toBe("true");

    const parentEvent = new MouseEvent("mousedown", { bubbles: true });
    view.dom.dispatchEvent(parentEvent);
    expect(probe.ignoreEvent(parentEvent)).toBe(false);

    enterPeek(projectedWidget(view));
    const nested = projectedWidget(view).querySelector(
      ".cm-md-html-block-widget__editor .cm-content",
    );
    if (!(nested instanceof HTMLElement)) {
      throw new Error("nested editor did not mount");
    }
    const nestedEvent = new MouseEvent("mousedown", { bubbles: true });
    nested.dispatchEvent(nestedEvent);
    expect(probe.ignoreEvent(nestedEvent)).toBe(true);
    expect(nested.closest(".cm-editor")).not.toBe(view.dom);
  });

  it("commits a real nested EditorView and undoes in the parent history", () => {
    const original = "Before\n\n<div>Safe</div>\n\nAfter\n";
    const view = mountView(original);
    const widget = projectedWidget(view);
    expect(widget.querySelector(".cm-md-html-block-widget__btn--edit")?.textContent).toBe(
      "编辑源码",
    );

    enterPeek(widget);
    const commitLabel = widget.querySelector(".cm-md-html-block-widget__btn--commit")?.textContent;
    expect(commitLabel === "完成 (⌘↵)" || commitLabel === "完成 (Ctrl+Enter)").toBe(true);
    replaceNested(widget, "<div>Edited</div>");
    clickControl(widget, ".cm-md-html-block-widget__btn--commit");

    expect(view.state.doc.toString()).toContain("<div>Edited</div>");
    expect(view.state.doc.toString()).not.toContain("<div>Safe</div>");
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(original);
  });

  it("commits with Mod-Enter and cancels with Escape on the real nested keymap", () => {
    const original = HTML_DOC;
    const view = mountView(original);
    const widget = projectedWidget(view);
    enterPeek(widget);
    const nested = getHtmlBlockWidgetState(widget)?.nestedView;
    if (!nested) {
      throw new Error("nested editor missing");
    }
    replaceNested(widget, "<div>Keyed</div>");
    dispatchKey(nested, "Enter", true);
    expect(view.state.doc.toString()).toContain("<div>Keyed</div>");

    const undone = mountView(original);
    const cancelWidget = projectedWidget(undone);
    enterPeek(cancelWidget);
    const cancelNested = getHtmlBlockWidgetState(cancelWidget)?.nestedView;
    if (!cancelNested) {
      throw new Error("nested editor missing");
    }
    replaceNested(cancelWidget, "<div>Discard</div>");
    dispatchKey(cancelNested, "Escape");
    expect(getHtmlBlockWidgetState(cancelWidget)?.mode).toBe("rendered");
    expect(undone.state.doc.toString()).toBe(original);
  });

  it("keeps an uncommitted draft on the same document and does not leak it into another view", () => {
    const viewA = mountView(HTML_DOC);
    const viewB = mountView(HTML_DOC);
    const recordId = htmlRecordId(viewA);
    expect(htmlRecordId(viewB)).toBe(recordId);

    const manualA = mountManualWidget(viewA);
    enterPeek(manualA.dom);
    replaceNested(manualA.dom, "<div>Draft A</div>");
    manualA.widget.destroy(manualA.dom);

    expect(viewA.state.field(htmlSourcePeekDraftField).get(recordId)).toBe("<div>Draft A</div>");
    expect(viewB.state.field(htmlSourcePeekDraftField).get(recordId)).toBeUndefined();

    const manualB = mountManualWidget(viewB);
    enterPeek(manualB.dom);
    expect(nestedText(manualB.dom)).not.toContain("Draft A");
    clickControl(manualB.dom, ".cm-md-html-block-widget__btn--commit");
    expect(viewB.state.doc.toString()).toBe(HTML_DOC);

    const restored = mountManualWidget(viewA);
    enterPeek(restored.dom);
    expect(nestedText(restored.dom)).toBe("<div>Draft A</div>");
  });

  it("does not move a draft into the next document when setState runs before widget destroy", () => {
    const view = mountView(HTML_DOC);
    const previous = view.state;
    const recordId = htmlRecordId(view);
    const manual = mountManualWidget(view);
    enterPeek(manual.dom);
    replaceNested(manual.dom, "<div>Draft A</div>");

    view.setState(EditorState.create({ doc: HTML_DOC, extensions: parentExtensions() }));
    manual.widget.destroy(manual.dom);

    expect(previous.field(htmlSourcePeekDraftField).get(recordId)).toBe("<div>Draft A</div>");
    expect(view.state.field(htmlSourcePeekDraftField).get(recordId)).toBeUndefined();

    const next = mountManualWidget(view);
    enterPeek(next.dom);
    expect(nestedText(next.dom)).not.toContain("Draft A");
    clickControl(next.dom, ".cm-md-html-block-widget__btn--commit");
    expect(view.state.doc.toString()).not.toContain("Draft A");
  });

  it("shows a toast and an inline alert when the block is gone, and stays in peek", async () => {
    const view = mountView(HTML_DOC);
    const notices: string[] = [];
    const onNotice = (event: Event) => {
      const message = (event as CustomEvent<{ message?: string }>).detail?.message;
      if (message) {
        notices.push(message);
      }
    };
    window.addEventListener(EDITOR_USER_NOTICE_EVENT, onNotice);

    const manual = mountManualWidget(view);
    enterPeek(manual.dom);
    replaceNested(manual.dom, "<div>Edited</div>");
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: "plain\n" },
      annotations: authorizeWysiwygProtectedChange.of(true),
    });
    clickControl(manual.dom, ".cm-md-html-block-widget__btn--commit");

    expect(getHtmlBlockWidgetState(manual.dom)?.mode).toBe("source-peek");
    expect(manual.dom.querySelector(".cm-md-html-block-widget__notice")?.textContent).toBe(
      HTML_BLOCK_RECORD_MISSING_MESSAGE,
    );
    expect(notices).toEqual([HTML_BLOCK_RECORD_MISSING_MESSAGE]);
    expect(view.dom.querySelector(".cm-announced")?.textContent).toContain("未能保存");
    expect(view.state.doc.toString()).toBe("plain\n");

    const editor = manual.dom.querySelector(".cm-md-html-block-widget__editor");
    if (!(editor instanceof HTMLElement)) {
      throw new Error("editor missing");
    }
    editor.dispatchEvent(
      new FocusEvent("focusout", { bubbles: true, relatedTarget: document.body }),
    );
    await flush();
    expect(notices).toEqual([HTML_BLOCK_RECORD_MISSING_MESSAGE]);
    expect(getHtmlBlockWidgetState(manual.dom)?.mode).toBe("source-peek");

    clickControl(manual.dom, ".cm-md-html-block-widget__btn--commit");
    expect(notices).toEqual([HTML_BLOCK_RECORD_MISSING_MESSAGE, HTML_BLOCK_RECORD_MISSING_MESSAGE]);
    window.removeEventListener(EDITOR_USER_NOTICE_EVENT, onNotice);
  });

  it("blur-commits a changed peek and lets Cancel win the focusout race", async () => {
    const view = mountView(HTML_DOC);
    const widget = projectedWidget(view);
    enterPeek(widget);
    replaceNested(widget, "<div>Blurred</div>");
    const editor = widget.querySelector(".cm-md-html-block-widget__editor");
    if (!(editor instanceof HTMLElement)) {
      throw new Error("editor missing");
    }
    editor.dispatchEvent(
      new FocusEvent("focusout", { bubbles: true, relatedTarget: document.body }),
    );
    await flush();
    expect(view.state.doc.toString()).toContain("<div>Blurred</div>");

    const cancelView = mountView(HTML_DOC);
    const cancelWidget = projectedWidget(cancelView);
    enterPeek(cancelWidget);
    replaceNested(cancelWidget, "<div>Nope</div>");
    const cancelButton = cancelWidget.querySelector(".cm-md-html-block-widget__btn--cancel");
    const cancelEditor = cancelWidget.querySelector(".cm-md-html-block-widget__editor");
    if (!(cancelButton instanceof HTMLElement) || !(cancelEditor instanceof HTMLElement)) {
      throw new Error("cancel controls missing");
    }
    cancelButton.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    cancelEditor.dispatchEvent(
      new FocusEvent("focusout", { bubbles: true, relatedTarget: document.body }),
    );
    cancelButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flush();
    expect(cancelView.state.doc.toString()).toBe(HTML_DOC);
    expect(getHtmlBlockWidgetState(cancelWidget)?.mode).toBe("rendered");
  });

  it("resolves the HTML range after text is inserted above the block", () => {
    const view = mountView("# Heading\n\n<div>Expand</div>\n\nFooter\n");
    const widget = projectedWidget(view);
    enterPeek(widget);
    view.dispatch({ changes: { from: 0, insert: "New line 1\nNew line 2\n\n" } });
    const current = projectedWidget(view);
    if (getHtmlBlockWidgetState(current)?.mode !== "source-peek") {
      enterPeek(current);
    }
    replaceNested(current, "<div>Shifted</div>");
    clickControl(current, ".cm-md-html-block-widget__btn--commit");
    const doc = view.state.doc.toString();
    expect(doc).toContain("New line 1\nNew line 2");
    expect(doc).toContain("<div>Shifted</div>");
    expect(doc).toContain("Footer");
  });
});
