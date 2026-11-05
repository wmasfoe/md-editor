import { html } from "@codemirror/lang-html";
import { history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { EditorState, Transaction } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, WidgetType } from "@codemirror/view";
import type { WysiwygDiagnostics } from "../../diagnostics.ts";
import { markdownRangeIndexField } from "../../markdown/range-index.ts";
import { selectWysiwygAtom } from "../blocks/atom-selection.ts";
import { authorizeWysiwygProtectedChange } from "../state/change-authorization.ts";

export interface HtmlBlockWidgetValue {
  readonly recordId: string;
  readonly sanitizedHtml: string;
  readonly placeholder: string | null;
  readonly selected: boolean;
  readonly diagnostics: WysiwygDiagnostics | null;
  readonly rawHtml?: string;
}

interface HtmlBlockWidgetListeners {
  readonly pointerdown: EventListener;
  readonly click: EventListener;
  readonly dblclick: EventListener;
}

export interface HtmlBlockState {
  readonly parentView: EditorView;
  currentValue: HtmlBlockWidgetValue;
  mode: "rendered" | "source-peek";
  nestedView: EditorView | null;
  isAborting: boolean;
  readonly toolbarEl: HTMLElement;
  readonly contentEl: HTMLElement;
  rebuildToolbar: () => void;
  rebuildContent: () => void;
}

export type NestedEditorFactory = (options: {
  parent: HTMLElement;
  state: EditorState;
}) => EditorView;

const listenersByDom = new WeakMap<HTMLElement, HtmlBlockWidgetListeners>();
const stateByDom = new WeakMap<HTMLElement, HtmlBlockState>();

/**
 * 视口虚拟化滚动时暂存的未提交草稿映射表 (recordId -> uncommittedDraft)。
 * 防止滚动移出视口导致 destroy(dom) 销毁微型编辑器时丢失用户就地输入的代码。
 * 设定容量上限为 32，超出时按 FIFO 自动淘汰最旧草稿，防止无界内存泄漏。
 */
const DRAFT_CACHE_LIMIT = 32;
const uncommittedDraftsByRecordId = new Map<string, string>();

function saveUncommittedDraft(recordId: string, draft: string): void {
  uncommittedDraftsByRecordId.set(recordId, draft);
  if (uncommittedDraftsByRecordId.size > DRAFT_CACHE_LIMIT) {
    const oldestKey = uncommittedDraftsByRecordId.keys().next().value;
    if (oldestKey !== undefined) {
      uncommittedDraftsByRecordId.delete(oldestKey);
    }
  }
}

let customNestedEditorFactory: NestedEditorFactory | null = null;

export function setNestedEditorFactoryForTesting(factory: NestedEditorFactory | null): void {
  customNestedEditorFactory = factory;
}

export function getHtmlUncommittedDraft(recordId: string): string | undefined {
  return uncommittedDraftsByRecordId.get(recordId);
}

export function clearHtmlUncommittedDrafts(): void {
  uncommittedDraftsByRecordId.clear();
}

export function getHtmlBlockWidgetState(dom: HTMLElement): HtmlBlockState | undefined {
  return stateByDom.get(dom);
}

function preventWidgetSelection(event: Event): void {
  event.preventDefault();
}

/**
 * HTMLBlock 挂件组件：
 * 1. 默认展示安全清洗后的 HTML 预览（经 DOMParser 解析 + 逐节点重建，绝不使用 innerHTML）；
 * 2. 支持就地 Source Peek 模式切换（悬停操作栏「编辑源码」按钮或双击触发）；
 * 3. 嵌入微型 CM6 代码编辑器，具备语法高亮、代码缩进、行号与局部独立撤销栈；
 * 4. 提交时经 dynamic range resolution（markdownRangeIndexField）安全写回主文档历史栈。
 */
export class HtmlBlockWidget extends WidgetType {
  constructor(readonly value: HtmlBlockWidgetValue) {
    super();
  }

  override eq(other: HtmlBlockWidget): boolean {
    return (
      this.value.recordId === other.value.recordId &&
      this.value.sanitizedHtml === other.value.sanitizedHtml &&
      this.value.placeholder === other.value.placeholder &&
      this.value.selected === other.value.selected &&
      (this.value.rawHtml ?? "") === (other.value.rawHtml ?? "")
    );
  }

  /**
   * 键盘与指针事件隔离：
   * 当事件目标发生在嵌套微型编辑器（.cm-editor）或挂件微操作栏（.cm-md-html-block-widget__toolbar）时，
   * 必须返回 true，彻底阻断父编辑器 keymap（如 tabArbiterKeymap、blockAtomTypingInputHandler）介入。
   */
  override ignoreEvent(event: Event): boolean {
    const target = event.target as { closest?: (selector: string) => unknown } | null;
    if (!target || typeof target.closest !== "function") {
      return false;
    }
    return Boolean(
      target.closest(
        ".cm-editor, .cm-md-html-block-widget__toolbar, .cm-md-html-block-widget__btn, button",
      ),
    );
  }

  override toDOM(view: EditorView): HTMLElement {
    const document = view.dom.ownerDocument;
    const wrapper = document.createElement("div");
    wrapper.className = "cm-md-html-block-widget";
    wrapper.dataset.recordId = this.value.recordId;
    wrapper.setAttribute("role", "group");
    wrapper.setAttribute("tabindex", "-1");
    wrapper.setAttribute("aria-label", "HTML block");
    wrapper.setAttribute("aria-selected", String(this.value.selected));
    wrapper.classList.toggle("cm-md-html-block-widget--selected", this.value.selected);

    const toolbarEl = document.createElement("div");
    toolbarEl.className = "cm-md-html-block-widget__toolbar";
    toolbarEl.setAttribute("role", "toolbar");
    toolbarEl.setAttribute("aria-label", "HTML block controls");

    const contentEl = document.createElement("div");
    contentEl.className = "cm-md-html-block-widget__content";

    wrapper.append(toolbarEl, contentEl);

    const state: HtmlBlockState = {
      parentView: view,
      currentValue: this.value,
      mode: "rendered",
      nestedView: null,
      isAborting: false,
      toolbarEl,
      contentEl,
      rebuildToolbar: () => rebuildToolbar(wrapper, state),
      rebuildContent: () => rebuildContent(wrapper, state),
    };
    stateByDom.set(wrapper, state);

    const onPointerDown: EventListener = (event) => {
      const target = event.target as { closest?: (selector: string) => unknown } | null;
      if (!target || typeof target.closest !== "function") return;
      if (
        state.mode === "source-peek" ||
        target.closest(".cm-editor, .cm-md-html-block-widget__toolbar, button, a")
      ) {
        return;
      }
      preventWidgetSelection(event);
    };

    const onClick: EventListener = (event) => {
      const target = event.target as { closest?: (selector: string) => unknown } | null;
      if (!target || typeof target.closest !== "function") return;
      if (
        state.mode === "source-peek" ||
        target.closest(".cm-editor, .cm-md-html-block-widget__toolbar, button, a")
      ) {
        return;
      }
      const mouseEvent = event as MouseEvent;
      selectWysiwygAtom(
        view,
        wrapper.dataset.recordId ?? state.currentValue.recordId,
        mouseEvent.metaKey || mouseEvent.ctrlKey,
      );
    };

    const onDblClick: EventListener = (event) => {
      const target = event.target as { closest?: (selector: string) => unknown } | null;
      if (!target || typeof target.closest !== "function") return;
      if (
        state.mode === "source-peek" ||
        target.closest(".cm-editor, .cm-md-html-block-widget__toolbar, button, a")
      ) {
        return;
      }
      event.preventDefault?.();
      event.stopPropagation?.();
      enterSourcePeek(wrapper, state);
    };

    wrapper.addEventListener("pointerdown", onPointerDown);
    wrapper.addEventListener("click", onClick);
    wrapper.addEventListener("dblclick", onDblClick);
    listenersByDom.set(wrapper, {
      pointerdown: onPointerDown,
      click: onClick,
      dblclick: onDblClick,
    });

    state.rebuildToolbar();
    state.rebuildContent();

    this.value.diagnostics?.recordWidgetLifecycle("html", "create");
    return wrapper;
  }

  override updateDOM(dom: HTMLElement): boolean {
    const state = stateByDom.get(dom);
    if (!state) {
      return false;
    }
    state.currentValue = this.value;
    dom.dataset.recordId = this.value.recordId;
    dom.setAttribute("aria-selected", String(this.value.selected));
    dom.classList.toggle("cm-md-html-block-widget--selected", this.value.selected);

    if (state.mode === "source-peek") {
      // 处于 Source Peek 源码编辑态时，严禁替换 content DOM，保留微型编辑器！
      this.value.diagnostics?.recordWidgetLifecycle("html", "update");
      return true;
    }

    state.rebuildContent();
    this.value.diagnostics?.recordWidgetLifecycle("html", "update");
    return true;
  }

  override destroy(dom: HTMLElement): void {
    const state = stateByDom.get(dom);
    if (state) {
      if (state.nestedView) {
        const draft = state.nestedView.state.doc.toString();
        const original = state.currentValue.rawHtml ?? state.currentValue.sanitizedHtml;
        if (draft !== original) {
          saveUncommittedDraft(state.currentValue.recordId, draft);
        }
        state.nestedView.destroy();
        state.nestedView = null;
      }
      stateByDom.delete(dom);
    }
    const listeners = listenersByDom.get(dom);
    if (listeners) {
      dom.removeEventListener("pointerdown", listeners.pointerdown);
      dom.removeEventListener("click", listeners.click);
      dom.removeEventListener("dblclick", listeners.dblclick);
      listenersByDom.delete(dom);
    }
    this.value.diagnostics?.recordWidgetLifecycle("html", "destroy");
  }
}

function rebuildToolbar(wrapper: HTMLElement, state: HtmlBlockState): void {
  const document = wrapper.ownerDocument;
  state.toolbarEl.replaceChildren();

  if (state.mode === "rendered") {
    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.tabIndex = -1;
    editBtn.className = "cm-md-html-block-widget__btn cm-md-html-block-widget__btn--edit";
    editBtn.setAttribute("aria-label", "编辑 HTML 源码");
    editBtn.textContent = "编辑源码";
    editBtn.addEventListener("click", (event) => {
      event.stopPropagation?.();
      enterSourcePeek(wrapper, state);
    });
    state.toolbarEl.append(editBtn);
  } else {
    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.tabIndex = -1;
    cancelBtn.className = "cm-md-html-block-widget__btn cm-md-html-block-widget__btn--cancel";
    cancelBtn.setAttribute("aria-label", "取消编辑");
    cancelBtn.textContent = "取消 (Esc)";
    // 关键：在 pointerdown 与 mousedown 时标记 isAborting = true，先于 focusout 触发，阻止失焦保存
    cancelBtn.addEventListener("pointerdown", () => {
      state.isAborting = true;
    });
    cancelBtn.addEventListener("mousedown", () => {
      state.isAborting = true;
    });
    cancelBtn.addEventListener("click", (event) => {
      event.stopPropagation?.();
      cancelSourcePeek(wrapper, state);
    });

    const commitBtn = document.createElement("button");
    commitBtn.type = "button";
    commitBtn.tabIndex = -1;
    commitBtn.className = "cm-md-html-block-widget__btn cm-md-html-block-widget__btn--commit";
    commitBtn.setAttribute("aria-label", "保存更改");
    commitBtn.textContent = "完成 (⌘↵)";
    commitBtn.addEventListener("click", (event) => {
      event.stopPropagation?.();
      commitSourcePeek(wrapper, state);
    });

    state.toolbarEl.append(cancelBtn, commitBtn);
  }
}

function rebuildContent(wrapper: HTMLElement, state: HtmlBlockState): void {
  if (state.mode === "source-peek") {
    return;
  }
  const document = wrapper.ownerDocument;
  state.contentEl.replaceChildren();

  if (state.currentValue.placeholder) {
    appendPlaceholder(state.contentEl, state.currentValue.placeholder);
    return;
  }

  const nodes = parseAndRebuildHtml(document, state.currentValue.sanitizedHtml);
  if (!nodes) {
    appendPlaceholder(
      state.contentEl,
      "HTML preview unavailable; edit the original source instead.",
    );
    return;
  }
  state.contentEl.append(...nodes);
}

export function enterSourcePeek(wrapper: HTMLElement, state: HtmlBlockState): void {
  if (state.mode === "source-peek") {
    return;
  }
  state.mode = "source-peek";
  state.isAborting = false;
  wrapper.classList.add("cm-md-html-block-widget--peek");
  state.rebuildToolbar();

  const document = wrapper.ownerDocument;
  state.contentEl.replaceChildren();

  const editorContainer = document.createElement("div");
  editorContainer.className = "cm-md-html-block-widget__editor";
  state.contentEl.append(editorContainer);

  let isHandlingFocusOut = false;
  const onFocusOut = (event: Event): void => {
    if (isHandlingFocusOut || state.isAborting || state.mode !== "source-peek") {
      return;
    }
    const related = (event as FocusEvent).relatedTarget as {
      closest?: (selector: string) => unknown;
    } | null;
    if (
      related &&
      typeof related.closest === "function" &&
      (related.closest(".cm-md-html-block-widget") === wrapper ||
        related.closest(".cm-md-html-block-widget__toolbar") === state.toolbarEl)
    ) {
      return;
    }
    isHandlingFocusOut = true;
    try {
      commitSourcePeek(wrapper, state);
    } finally {
      isHandlingFocusOut = false;
    }
  };
  editorContainer.addEventListener("focusout", onFocusOut);

  const initialDoc =
    uncommittedDraftsByRecordId.get(state.currentValue.recordId) ??
    (state.currentValue.rawHtml || state.currentValue.sanitizedHtml);

  const extensions = [
    html(),
    lineNumbers(),
    EditorView.lineWrapping,
    history(),
    keymap.of([
      {
        key: "Mod-Enter",
        run: () => {
          commitSourcePeek(wrapper, state);
          return true;
        },
      },
      {
        key: "Escape",
        run: () => {
          cancelSourcePeek(wrapper, state);
          return true;
        },
      },
      ...historyKeymap,
      indentWithTab,
    ]),
    EditorView.domEventHandlers({
      focusout: (event) => {
        onFocusOut(event);
      },
    }),
  ];

  const nestedState = EditorState.create({
    doc: initialDoc,
    extensions,
  });

  state.nestedView = customNestedEditorFactory
    ? customNestedEditorFactory({ parent: editorContainer, state: nestedState })
    : new EditorView({ parent: editorContainer, state: nestedState });

  state.nestedView.focus?.();
}

export function cancelSourcePeek(wrapper: HTMLElement, state: HtmlBlockState): void {
  if (state.mode !== "source-peek") {
    return;
  }
  state.isAborting = true;
  uncommittedDraftsByRecordId.delete(state.currentValue.recordId);
  if (state.nestedView) {
    state.nestedView.destroy();
    state.nestedView = null;
  }
  state.mode = "rendered";
  wrapper.classList.remove("cm-md-html-block-widget--peek");
  state.rebuildToolbar();
  state.rebuildContent();
  state.isAborting = false;
  state.parentView.focus?.();
}

export function commitSourcePeek(wrapper: HTMLElement, state: HtmlBlockState): void {
  if (state.mode !== "source-peek") {
    return;
  }
  if (!state.nestedView) {
    return;
  }
  const newHtml = state.nestedView.state.doc.toString();
  const originalHtml = state.currentValue.rawHtml ?? state.currentValue.sanitizedHtml;

  if (newHtml !== originalHtml) {
    // 动态 Range 寻址：基于 recordId 实时查询最新区间，防御主文档行位移撕裂
    const rangeIndex = state.parentView.state.field(markdownRangeIndexField, false);
    const currentRecord = rangeIndex?.get(state.currentValue.recordId);
    if (!currentRecord) {
      // 记录已不存在（外部并发删除），安全告警并保持编辑态，保护用户未提交输入不被静默销毁
      console.warn(
        `[HtmlBlockWidget] Record ${state.currentValue.recordId} not found in parent view; holding peek state`,
      );
      return;
    }
    state.parentView.dispatch({
      changes: {
        from: currentRecord.fullRange.from,
        to: currentRecord.fullRange.to,
        insert: newHtml,
      },
      annotations: [Transaction.addToHistory.of(true), authorizeWysiwygProtectedChange.of(true)],
      userEvent: "input.type",
    });
  }

  uncommittedDraftsByRecordId.delete(state.currentValue.recordId);
  state.nestedView.destroy();
  state.nestedView = null;
  state.mode = "rendered";
  wrapper.classList.remove("cm-md-html-block-widget--peek");
  state.rebuildToolbar();
  state.rebuildContent();
  state.isAborting = false;
  state.parentView.focus?.();
}

export function enterHtmlSourcePeekForTesting(dom: HTMLElement): void {
  const state = stateByDom.get(dom);
  if (state) {
    enterSourcePeek(dom, state);
  }
}

export function commitHtmlSourcePeekForTesting(dom: HTMLElement): void {
  const state = stateByDom.get(dom);
  if (state) {
    commitSourcePeek(dom, state);
  }
}

export function cancelHtmlSourcePeekForTesting(dom: HTMLElement): void {
  const state = stateByDom.get(dom);
  if (state) {
    cancelSourcePeek(dom, state);
  }
}

function appendPlaceholder(dom: HTMLElement, message: string): void {
  const placeholder = dom.ownerDocument.createElement("span");
  placeholder.className = "cm-md-html-block-widget__placeholder";
  placeholder.setAttribute("role", "alert");
  placeholder.textContent = message;
  dom.append(placeholder);
}

function parseAndRebuildHtml(document: Document, htmlText: string): Node[] | null {
  const Parser =
    document.defaultView?.DOMParser ?? (typeof DOMParser === "undefined" ? null : DOMParser);
  if (!Parser) {
    return null;
  }
  const parsed = new Parser().parseFromString(`<body>${htmlText}</body>`, "text/html");
  return Array.from(parsed.body.childNodes).map((node) => rebuildNode(document, node));
}

function rebuildNode(document: Document, source: Node): Node {
  if (source.nodeType === 3) {
    return document.createTextNode(source.nodeValue ?? "");
  }
  if (source.nodeType !== 1) {
    return document.createTextNode("");
  }

  const sourceElement = source as Element;
  const tagName = sourceElement.tagName.toLowerCase();
  // 纵深防御：坚决杜绝在挂件渲染层创建可执行脚本或内嵌框架节点
  if (tagName === "script" || tagName === "iframe" || tagName === "object" || tagName === "embed") {
    return document.createTextNode("");
  }

  const element = document.createElement(tagName);
  for (const attribute of Array.from(sourceElement.attributes)) {
    const attrName = attribute.name.toLowerCase();
    // 纵深防御：坚决过滤所有内联事件处理属性（如 onclick, onerror, onload 等）
    if (attrName.startsWith("on")) {
      continue;
    }
    // 过滤危险伪协议链接
    if (
      (attrName === "href" || attrName === "src") &&
      /^(javascript|vbscript):/i.test(attribute.value.trim())
    ) {
      continue;
    }
    element.setAttribute(attribute.name, attribute.value);
  }
  for (const child of Array.from(sourceElement.childNodes)) {
    element.append(rebuildNode(document, child));
  }
  return element;
}
