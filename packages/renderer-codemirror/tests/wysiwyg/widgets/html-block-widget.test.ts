import { markdown } from "@codemirror/lang-markdown";
import { history, undo } from "@codemirror/commands";
import { EditorSelection, EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WysiwygDiagnostics } from "../../../src/diagnostics.ts";
import { M1_MARKDOWN_EXTENSIONS } from "../../../src/markdown/extensions.ts";
import { markdownRangeIndexField } from "../../../src/markdown/range-index.ts";
import { editorModeField } from "../../../src/mode.ts";
import { wysiwygChangeProtection } from "../../../src/wysiwyg/state/change-protection.ts";
import {
  configureWysiwygProjectionFeatures,
  wysiwygProjectionField,
} from "../../../src/wysiwyg/state/projection-field.ts";
import {
  clearHtmlUncommittedDrafts,
  getHtmlBlockWidgetState,
  getHtmlUncommittedDraft,
  HtmlBlockWidget,
  setNestedEditorFactoryForTesting,
} from "../../../src/wysiwyg/widgets/html-block-widget.ts";

/**
 * 轻量级 DOM 模拟节点，适配纯 Node.js 测试环境（无 jsdom 依赖）。
 */
class FakeElement {
  readonly dataset: Record<string, string> = {};
  readonly children: FakeElement[] = [];
  readonly attributes = new Map<string, string>();
  readonly listeners = new Map<string, Set<EventListener>>();
  parentElement: FakeElement | null = null;
  className = "";
  textContent = "";
  type = "";

  readonly classList = {
    add: (...names: string[]) => {
      const set = new Set(this.className.split(/\s+/u).filter(Boolean));
      names.forEach((name) => set.add(name));
      this.className = [...set].join(" ");
    },
    remove: (...names: string[]) => {
      const set = new Set(this.className.split(/\s+/u).filter(Boolean));
      names.forEach((name) => set.delete(name));
      this.className = [...set].join(" ");
    },
    toggle: (name: string, force?: boolean) => {
      const set = new Set(this.className.split(/\s+/u).filter(Boolean));
      const shouldHave = force !== undefined ? force : !set.has(name);
      if (shouldHave) set.add(name);
      else set.delete(name);
      this.className = [...set].join(" ");
      return shouldHave;
    },
    contains: (name: string) => {
      return this.className.split(/\s+/u).filter(Boolean).includes(name);
    },
  };

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

  dispatchEvent(event: {
    type: string;
    target?: unknown;
    relatedTarget?: unknown;
    preventDefault?: () => void;
    stopPropagation?: () => void;
  }): boolean {
    if (!event.target) {
      (event as { target: unknown }).target = this;
    }
    const set = this.listeners.get(event.type);
    if (set) {
      for (const listener of Array.from(set)) {
        listener(event as unknown as Event);
      }
    }
    return true;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  append(...children: (FakeElement | FakeNode)[]): void {
    for (const child of children) {
      if (child instanceof FakeElement) {
        child.parentElement = this;
        this.children.push(child);
      }
    }
  }

  appendChild(child: FakeElement | FakeNode): FakeElement | FakeNode {
    this.append(child);
    return child;
  }

  replaceChildren(...children: (FakeElement | FakeNode)[]): void {
    this.children.length = 0;
    this.append(...children);
  }

  closest(selector: string): FakeElement | null {
    const parts = selector.split(",").map((s) => s.trim());
    const matches = (element: FakeElement): boolean => {
      for (const part of parts) {
        if (part === "button" && element.tagName.toLowerCase() === "button") return true;
        if (part === "a" && element.tagName.toLowerCase() === "a") return true;
        if (part.startsWith(".") && element.classList.contains(part.slice(1))) return true;
      }
      return false;
    };

    if (matches(this)) {
      return this;
    }
    let parent = this.parentElement;
    while (parent) {
      if (matches(parent)) {
        return parent;
      }
      parent = parent.parentElement;
    }
    return null;
  }

  contains(other: FakeElement | null): boolean {
    let current = other;
    while (current) {
      if (current === this) return true;
      current = current.parentElement;
    }
    return false;
  }

  querySelector(selector: string): FakeElement | null {
    for (const child of this.children) {
      if (selector.startsWith(".") && child.classList.contains(selector.slice(1))) {
        return child;
      }
      if (selector === child.tagName.toLowerCase()) {
        return child;
      }
      const found = child.querySelector(selector);
      if (found) return found;
    }
    return null;
  }
}

class FakeNode {
  constructor(
    readonly ownerDocument: FakeDocument,
    readonly nodeType: number,
    public nodeValue: string,
  ) {}
}

class FakeDocument {
  createElement(tagName: string): FakeElement {
    return new FakeElement(this, tagName);
  }

  createTextNode(text: string): FakeNode {
    return new FakeNode(this, 3, text);
  }
}

interface TestParentHarness {
  readonly view: EditorView;
  readonly getState: () => EditorState;
  readonly document: FakeDocument;
}

function createTestParentHarness(doc: string): TestParentHarness {
  const document = new FakeDocument();
  let state = EditorState.create({
    doc,
    selection: EditorSelection.cursor(doc.length),
    extensions: [
      history(),
      markdown({ extensions: M1_MARKDOWN_EXTENSIONS, addKeymap: false }),
      editorModeField,
      markdownRangeIndexField,
      configureWysiwygProjectionFeatures(["html"]),
      wysiwygProjectionField,
      wysiwygChangeProtection,
    ],
  });

  const view = {
    dom: { ownerDocument: document },
    get state() {
      return state;
    },
    dispatch(spec: Parameters<EditorState["update"]>[0] | ReturnType<EditorState["update"]>) {
      state = ("state" in spec && spec.state ? spec : state.update(spec as never)).state;
    },
    focus() {},
  } as unknown as EditorView;

  return { view, getState: () => state, document };
}

describe("HtmlBlockWidget (M1 Source Peek)", () => {
  let mockDestroyCalled = false;

  beforeEach(() => {
    mockDestroyCalled = false;
    clearHtmlUncommittedDrafts();
    setNestedEditorFactoryForTesting(({ parent, state }) => {
      let currentState = state;
      return {
        dom: parent,
        get state() {
          return currentState;
        },
        dispatch(tr: Parameters<EditorState["update"]>[0] | ReturnType<EditorState["update"]>) {
          currentState = ("state" in tr && tr.state ? tr : currentState.update(tr as never)).state;
        },
        destroy() {
          mockDestroyCalled = true;
        },
        focus() {},
      } as unknown as EditorView;
    });
  });

  afterEach(() => {
    setNestedEditorFactoryForTesting(null);
    clearHtmlUncommittedDrafts();
  });

  it("TC-PEEK-1: 初始预览态挂载包含操作栏与清洗内容", () => {
    const harness = createTestParentHarness("<details><summary>Test</summary></details>");
    const rangeIndex = harness.getState().field(markdownRangeIndexField);
    const htmlRecord = rangeIndex.byKind("html")[0];
    expect(htmlRecord).toBeDefined();

    const value = {
      recordId: htmlRecord!.id,
      sanitizedHtml: "<details><summary>Test</summary></details>",
      placeholder: null,
      selected: false,
      diagnostics: new WysiwygDiagnostics(),
      rawHtml: "<details><summary>Test</summary></details>",
    };

    const widget = new HtmlBlockWidget(value);
    const dom = widget.toDOM(harness.view) as unknown as FakeElement;

    expect(dom.className).toBe("cm-md-html-block-widget");
    expect(dom.getAttribute("aria-label")).toBe("HTML block");
    expect(dom.getAttribute("aria-selected")).toBe("false");

    const editBtn = dom.querySelector(".cm-md-html-block-widget__btn--edit");
    expect(editBtn).not.toBeNull();
    expect(editBtn?.textContent).toBe("编辑源码");
  });

  it("TC-PEEK-2: 双击切入 Source Peek 态", () => {
    const harness = createTestParentHarness("<details><summary>Test</summary></details>");
    const htmlRecord = harness.getState().field(markdownRangeIndexField).byKind("html")[0]!;

    const widget = new HtmlBlockWidget({
      recordId: htmlRecord.id,
      sanitizedHtml: "<details><summary>Test</summary></details>",
      placeholder: null,
      selected: false,
      diagnostics: null,
      rawHtml: "<details><summary>Test</summary></details>",
    });

    const dom = widget.toDOM(harness.view) as unknown as FakeElement;
    dom.dispatchEvent({ type: "dblclick" });

    expect(dom.classList.contains("cm-md-html-block-widget--peek")).toBe(true);

    const cancelBtn = dom.querySelector(".cm-md-html-block-widget__btn--cancel");
    const commitBtn = dom.querySelector(".cm-md-html-block-widget__btn--commit");
    expect(cancelBtn).not.toBeNull();
    expect(commitBtn).not.toBeNull();

    const state = getHtmlBlockWidgetState(dom as unknown as HTMLElement);
    expect(state?.mode).toBe("source-peek");
    expect(state?.nestedView).not.toBeNull();
    expect(state?.nestedView?.state.doc.toString()).toBe(
      "<details><summary>Test</summary></details>",
    );
  });

  it("TC-PEEK-3: 点击「编辑源码」按钮切入 Source Peek 态", () => {
    const harness = createTestParentHarness("<p>Hello</p>");
    const htmlRecord = harness.getState().field(markdownRangeIndexField).byKind("html")[0]!;

    const widget = new HtmlBlockWidget({
      recordId: htmlRecord.id,
      sanitizedHtml: "<p>Hello</p>",
      placeholder: null,
      selected: false,
      diagnostics: null,
      rawHtml: "<p>Hello</p>",
    });

    const dom = widget.toDOM(harness.view) as unknown as FakeElement;
    const editBtn = dom.querySelector(".cm-md-html-block-widget__btn--edit");
    editBtn?.dispatchEvent({ type: "click" });

    expect(dom.classList.contains("cm-md-html-block-widget--peek")).toBe(true);
    const widgetState = getHtmlBlockWidgetState(dom as unknown as HTMLElement);
    expect(widgetState?.mode).toBe("source-peek");
  });

  it("TC-PEEK-4: 提交更新 (Commit) 写回主文档并平滑折叠回预览态", () => {
    const harness = createTestParentHarness("<details><summary>Old</summary></details>");
    const htmlRecord = harness.getState().field(markdownRangeIndexField).byKind("html")[0]!;

    const widget = new HtmlBlockWidget({
      recordId: htmlRecord.id,
      sanitizedHtml: "<details><summary>Old</summary></details>",
      placeholder: null,
      selected: false,
      diagnostics: null,
      rawHtml: "<details><summary>Old</summary></details>",
    });

    const dom = widget.toDOM(harness.view) as unknown as FakeElement;
    dom.dispatchEvent({ type: "dblclick" });

    const widgetState = getHtmlBlockWidgetState(dom as unknown as HTMLElement);
    expect(widgetState?.nestedView).not.toBeNull();

    // 模拟在微型编辑器中打字修改 HTML
    const nestedView = widgetState!.nestedView!;
    nestedView.dispatch({
      changes: {
        from: 0,
        to: nestedView.state.doc.length,
        insert: "<details><summary>New</summary></details>",
      },
    });

    // 点击完成按钮
    const commitBtn = dom.querySelector(".cm-md-html-block-widget__btn--commit");
    commitBtn?.dispatchEvent({ type: "click" });

    // 验证主文档被更新
    expect(harness.getState().doc.toString()).toBe("<details><summary>New</summary></details>");
    // 验证嵌套编辑器已销毁并折叠
    expect(mockDestroyCalled).toBe(true);
    expect(widgetState?.mode).toBe("rendered");
    expect(dom.classList.contains("cm-md-html-block-widget--peek")).toBe(false);
  });

  it("TC-PEEK-5: 取消编辑 (Escape/Cancel) 放弃修改且主文档不变", () => {
    const original = '<div class="box">Original</div>';
    const harness = createTestParentHarness(original);
    const htmlRecord = harness.getState().field(markdownRangeIndexField).byKind("html")[0]!;

    const widget = new HtmlBlockWidget({
      recordId: htmlRecord.id,
      sanitizedHtml: original,
      placeholder: null,
      selected: false,
      diagnostics: null,
      rawHtml: original,
    });

    const dom = widget.toDOM(harness.view) as unknown as FakeElement;
    dom.dispatchEvent({ type: "dblclick" });

    const widgetState = getHtmlBlockWidgetState(dom as unknown as HTMLElement);
    const nestedView = widgetState!.nestedView!;
    nestedView.dispatch({
      changes: {
        from: 0,
        to: nestedView.state.doc.length,
        insert: '<div class="box">Modified</div>',
      },
    });

    const cancelBtn = dom.querySelector(".cm-md-html-block-widget__btn--cancel");
    cancelBtn?.dispatchEvent({ type: "click" });

    expect(harness.getState().doc.toString()).toBe(original);
    expect(mockDestroyCalled).toBe(true);
    expect(widgetState?.mode).toBe("rendered");
  });

  it("TC-PEEK-6: 失焦 (focusout) 安全自动提交", () => {
    const harness = createTestParentHarness("<p>Before</p>");
    const htmlRecord = harness.getState().field(markdownRangeIndexField).byKind("html")[0]!;

    const widget = new HtmlBlockWidget({
      recordId: htmlRecord.id,
      sanitizedHtml: "<p>Before</p>",
      placeholder: null,
      selected: false,
      diagnostics: null,
      rawHtml: "<p>Before</p>",
    });

    const dom = widget.toDOM(harness.view) as unknown as FakeElement;
    dom.dispatchEvent({ type: "dblclick" });

    const widgetState = getHtmlBlockWidgetState(dom as unknown as HTMLElement);
    const nestedView = widgetState!.nestedView!;
    nestedView.dispatch({
      changes: { from: 0, to: nestedView.state.doc.length, insert: "<p>After Blur</p>" },
    });

    // 模拟非组件内部的元素失焦事件
    const outsideElement = harness.document.createElement("div");
    const editorDom = dom.querySelector(".cm-md-html-block-widget__editor")!;
    editorDom.dispatchEvent({
      type: "focusout",
      relatedTarget: outsideElement,
    });

    // 验证自动触发保存
    expect(harness.getState().doc.toString()).toBe("<p>After Blur</p>");
    expect(widgetState?.mode).toBe("rendered");
  });

  it("TC-PEEK-7: Widget 销毁清理 (destroy) 并暂存未提交草稿", () => {
    const harness = createTestParentHarness("<div>Content</div>");
    const htmlRecord = harness.getState().field(markdownRangeIndexField).byKind("html")[0]!;

    const diagnostics = new WysiwygDiagnostics();
    const widget = new HtmlBlockWidget({
      recordId: htmlRecord.id,
      sanitizedHtml: "<div>Content</div>",
      placeholder: null,
      selected: false,
      diagnostics,
      rawHtml: "<div>Content</div>",
    });

    const dom = widget.toDOM(harness.view) as unknown as FakeElement;
    dom.dispatchEvent({ type: "dblclick" });

    const widgetState = getHtmlBlockWidgetState(dom as unknown as HTMLElement);
    const nestedView = widgetState!.nestedView!;
    nestedView.dispatch({
      changes: { from: 0, to: nestedView.state.doc.length, insert: "<div>Unsaved Draft</div>" },
    });

    // 视口移出销毁
    widget.destroy(dom as unknown as HTMLElement);

    expect(mockDestroyCalled).toBe(true);
    // 草稿已被安全暂存至全局缓存
    expect(getHtmlUncommittedDraft(htmlRecord.id)).toBe("<div>Unsaved Draft</div>");
    expect(diagnostics.snapshot().widgetLifecycleCounts.html).toEqual({
      create: 1,
      update: 0,
      destroy: 1,
    });

    // 再次挂载进入 Peek 时优先恢复草稿
    const widget2 = new HtmlBlockWidget({
      recordId: htmlRecord.id,
      sanitizedHtml: "<div>Content</div>",
      placeholder: null,
      selected: false,
      diagnostics,
      rawHtml: "<div>Content</div>",
    });
    const dom2 = widget2.toDOM(harness.view) as unknown as FakeElement;
    dom2.dispatchEvent({ type: "dblclick" });
    const widgetState2 = getHtmlBlockWidgetState(dom2 as unknown as HTMLElement);
    expect(widgetState2?.nestedView?.state.doc.toString()).toBe("<div>Unsaved Draft</div>");
  });

  it("TC-PEEK-8: 全局历史撤销栈一致性 (Parent Undo)", () => {
    const harness = createTestParentHarness("<p>Step 1</p>");
    const htmlRecord = harness.getState().field(markdownRangeIndexField).byKind("html")[0]!;

    const widget = new HtmlBlockWidget({
      recordId: htmlRecord.id,
      sanitizedHtml: "<p>Step 1</p>",
      placeholder: null,
      selected: false,
      diagnostics: null,
      rawHtml: "<p>Step 1</p>",
    });

    const dom = widget.toDOM(harness.view) as unknown as FakeElement;
    dom.dispatchEvent({ type: "dblclick" });

    const widgetState = getHtmlBlockWidgetState(dom as unknown as HTMLElement);
    const nestedView = widgetState!.nestedView!;
    nestedView.dispatch({
      changes: { from: 0, to: nestedView.state.doc.length, insert: "<p>Step 2</p>" },
    });

    const commitBtn = dom.querySelector(".cm-md-html-block-widget__btn--commit");
    commitBtn?.dispatchEvent({ type: "click" });

    expect(harness.getState().doc.toString()).toBe("<p>Step 2</p>");

    // 在主编辑器执行单步撤销
    const undone = undo(harness.view);
    expect(undone).toBe(true);
    expect(harness.getState().doc.toString()).toBe("<p>Step 1</p>");
  });

  it("TC-PEEK-9: 按键与事件隔离 (ignoreEvent 契约)", () => {
    const harness = createTestParentHarness("<div>Test</div>");
    const htmlRecord = harness.getState().field(markdownRangeIndexField).byKind("html")[0]!;

    const widget = new HtmlBlockWidget({
      recordId: htmlRecord.id,
      sanitizedHtml: "<div>Test</div>",
      placeholder: null,
      selected: false,
      diagnostics: null,
      rawHtml: "<div>Test</div>",
    });

    const dom = widget.toDOM(harness.view) as unknown as FakeElement;
    const toolbar = dom.querySelector(".cm-md-html-block-widget__toolbar")!;
    const editBtn = dom.querySelector(".cm-md-html-block-widget__btn--edit")!;

    // 微型编辑器与工具栏交互必须 ignore
    expect(widget.ignoreEvent({ target: toolbar } as unknown as Event)).toBe(true);
    expect(widget.ignoreEvent({ target: editBtn } as unknown as Event)).toBe(true);

    const fakeCmEditor = harness.document.createElement("div");
    fakeCmEditor.className = "cm-editor";
    expect(widget.ignoreEvent({ target: fakeCmEditor } as unknown as Event)).toBe(true);

    // 外层容器与普通节点不得 ignore
    expect(widget.ignoreEvent({ target: dom } as unknown as Event)).toBe(false);
  });

  it("TC-PEEK-10: 动态 Range 寻址防御上游内容位移撕裂", () => {
    const harness = createTestParentHarness(
      "# Heading\n\n<details><summary>Expand</summary></details>\n\nFooter text",
    );
    const rangeIndex = harness.getState().field(markdownRangeIndexField);
    const htmlRecord = rangeIndex.byKind("html")[0]!;

    const widget = new HtmlBlockWidget({
      recordId: htmlRecord.id,
      sanitizedHtml: "<details><summary>Expand</summary></details>",
      placeholder: null,
      selected: false,
      diagnostics: null,
      rawHtml: "<details><summary>Expand</summary></details>",
    });

    const dom = widget.toDOM(harness.view) as unknown as FakeElement;
    dom.dispatchEvent({ type: "dblclick" });

    // 模拟在 HTML 块上方插入多行正文，产生 offset 位移
    harness.view.dispatch({
      changes: { from: 0, insert: "New line 1\nNew line 2\n\n" },
    });

    // 随后微型编辑器修改并提交
    const widgetState = getHtmlBlockWidgetState(dom as unknown as HTMLElement);
    widgetState!.nestedView!.dispatch({
      changes: {
        from: 0,
        to: widgetState!.nestedView!.state.doc.length,
        insert: "<details><summary>Updated at shifted offset</summary></details>",
      },
    });

    const commitBtn = dom.querySelector(".cm-md-html-block-widget__btn--commit");
    commitBtn?.dispatchEvent({ type: "click" });

    // 验证新插入的内容未被破坏，HTML 块精准在位移后的新区间完成替换
    const currentDoc = harness.getState().doc.toString();
    expect(currentDoc).toContain("New line 1\nNew line 2\n\n# Heading");
    expect(currentDoc).toContain("<details><summary>Updated at shifted offset</summary></details>");
    expect(currentDoc).toContain("Footer text");
  });

  it("TC-PEEK-11: 取消按钮 (Cancel) 优先于失焦保存 (Blur) 的竞态仲裁", () => {
    const original = '<div class="safe">Safe Original</div>';
    const harness = createTestParentHarness(original);
    const htmlRecord = harness.getState().field(markdownRangeIndexField).byKind("html")[0]!;

    const widget = new HtmlBlockWidget({
      recordId: htmlRecord.id,
      sanitizedHtml: original,
      placeholder: null,
      selected: false,
      diagnostics: null,
      rawHtml: original,
    });

    const dom = widget.toDOM(harness.view) as unknown as FakeElement;
    dom.dispatchEvent({ type: "dblclick" });

    const widgetState = getHtmlBlockWidgetState(dom as unknown as HTMLElement);
    widgetState!.nestedView!.dispatch({
      changes: {
        from: 0,
        to: widgetState!.nestedView!.state.doc.length,
        insert: '<div class="safe">Draft to be discarded</div>',
      },
    });

    const cancelBtn = dom.querySelector(".cm-md-html-block-widget__btn--cancel")!;
    const editorDom = dom.querySelector(".cm-md-html-block-widget__editor")!;

    // 模拟鼠标点击取消按钮的标准时序：pointerdown -> focusout -> click
    cancelBtn.dispatchEvent({ type: "pointerdown" });
    editorDom.dispatchEvent({
      type: "focusout",
      relatedTarget: cancelBtn,
    });
    cancelBtn.dispatchEvent({ type: "click" });

    // 验证自动保存被成功抑制，内容完全恢复原样
    expect(harness.getState().doc.toString()).toBe(original);
    expect(widgetState?.mode).toBe("rendered");
  });
});
