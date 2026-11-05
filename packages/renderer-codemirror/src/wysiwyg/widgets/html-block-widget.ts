import { html } from "@codemirror/lang-html";
import { history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { EditorState, StateField, Transaction } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, WidgetType } from "@codemirror/view";
import type { WysiwygDiagnostics } from "../../diagnostics.ts";
import { dispatchEditorUserNotice } from "../../editor-user-notice.ts";
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
  /** `toDOM` 时抓住的草稿表。销毁时禁止再读 `parentView.state`，见 {@link htmlSourcePeekDraftField}。 */
  readonly draftStore: Map<string, string> | null;
  currentValue: HtmlBlockWidgetValue;
  mode: "rendered" | "source-peek";
  nestedView: EditorView | null;
  isAborting: boolean;
  isCommitting: boolean;
  disposed: boolean;
  recordMissingNotified: boolean;
  readonly toolbarEl: HTMLElement;
  readonly contentEl: HTMLElement;
  rebuildToolbar: () => void;
  rebuildContent: () => void;
}

const listenersByDom = new WeakMap<HTMLElement, HtmlBlockWidgetListeners>();
const stateByDom = new WeakMap<HTMLElement, HtmlBlockState>();

/**
 * 每个 EditorState（一份文档）一份未提交草稿。
 *
 * `update` 返回同一 Map：同一文档上的后续事务不会丢掉草稿。
 * `EditorState.create` / `view.setState` 走 `create()`，换文档时得到空表。
 * 挂件在 `toDOM` 时抓住这份 Map。文档替换时 CM 会在 `view.state` 已经是新文档之后
 * 才销毁旧挂件；若 destroy 再读 `view.state`，文档 A 的草稿会被写进文档 B。
 */
const DRAFT_CACHE_LIMIT = 32;
export const htmlSourcePeekDraftField = StateField.define<Map<string, string>>({
  create: () => new Map(),
  update: (drafts) => drafts,
});

/** 提交时记录已不在当前文档。文案含「未能」，桌面 toast 会走错误样式。 */
export const HTML_BLOCK_RECORD_MISSING_MESSAGE = "未能保存 HTML 块：原内容已不在文档中。";

/**
 * 只隔离嵌套源码编辑器和挂件工具栏。
 * 不能写 `.cm-editor`：挂件本身就在父编辑器的 `.cm-editor` 里，
 * `closest(".cm-editor")` 会把预览区点击也吞掉，整块无法被选中。
 */
const PEEK_ISOLATED_TARGET_SELECTOR = [
  ".cm-md-html-block-widget__editor",
  ".cm-md-html-block-widget__toolbar",
  ".cm-md-html-block-widget__btn",
  "button",
  "a",
].join(", ");

type PeekCommitReason = "explicit" | "blur";

function isPeekIsolatedTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).closest !== "function") {
    return false;
  }
  return Boolean((target as Element).closest(PEEK_ISOLATED_TARGET_SELECTOR));
}

function rememberDraft(drafts: Map<string, string> | null, recordId: string, draft: string): void {
  if (!drafts) {
    return;
  }
  // 先删再写，已有记录会移到队尾；否则容量已满时更新最旧的一条会被立刻淘汰。
  drafts.delete(recordId);
  drafts.set(recordId, draft);
  while (drafts.size > DRAFT_CACHE_LIMIT) {
    const oldestKey = drafts.keys().next().value;
    if (oldestKey === undefined) {
      break;
    }
    drafts.delete(oldestKey);
  }
}

function forgetDraft(drafts: Map<string, string> | null, recordId: string): void {
  drafts?.delete(recordId);
}

function readDraft(drafts: Map<string, string> | null, recordId: string): string | undefined {
  return drafts?.get(recordId);
}

function commitShortcutLabel(ownerDocument: Document): string {
  const platform = ownerDocument.defaultView?.navigator.platform ?? "";
  return /Mac|iPhone|iPad|iPod/i.test(platform) ? "⌘↵" : "Ctrl+Enter";
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
   * 嵌套编辑器和工具栏自己处理指针/键盘。预览区必须返回 false，父编辑器才能选中整块。
   */
  override ignoreEvent(event: Event): boolean {
    return isPeekIsolatedTarget(event.target);
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
      draftStore: view.state.field(htmlSourcePeekDraftField, false) ?? null,
      currentValue: this.value,
      mode: "rendered",
      nestedView: null,
      isAborting: false,
      isCommitting: false,
      disposed: false,
      recordMissingNotified: false,
      toolbarEl,
      contentEl,
      rebuildToolbar: () => rebuildToolbar(wrapper, state),
      rebuildContent: () => rebuildContent(wrapper, state),
    };
    stateByDom.set(wrapper, state);

    const onPointerDown: EventListener = (event) => {
      if (state.mode === "source-peek" || isPeekIsolatedTarget(event.target)) {
        return;
      }
      preventWidgetSelection(event);
    };

    const onClick: EventListener = (event) => {
      if (state.mode === "source-peek" || isPeekIsolatedTarget(event.target)) {
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
      if (state.mode === "source-peek" || isPeekIsolatedTarget(event.target)) {
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
      state.disposed = true;
      // 提交进行中时父视图正在更新。嵌套编辑器留给 commit 在 dispatch 返回后释放，
      // 避免在父更新内部同步 destroy 另一个 EditorView。
      if (state.nestedView && !state.isCommitting) {
        const draft = state.nestedView.state.doc.toString();
        const original = state.currentValue.rawHtml ?? state.currentValue.sanitizedHtml;
        if (draft !== original) {
          rememberDraft(state.draftStore, state.currentValue.recordId, draft);
        }
        releaseNestedEditor(state);
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
    commitBtn.textContent = `完成 (${commitShortcutLabel(document)})`;
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
  if (state.mode === "source-peek" || state.disposed) {
    return;
  }
  state.mode = "source-peek";
  state.isAborting = false;
  state.recordMissingNotified = false;
  wrapper.classList.add("cm-md-html-block-widget--peek");
  state.rebuildToolbar();

  const document = wrapper.ownerDocument;
  state.contentEl.replaceChildren();

  const editorContainer = document.createElement("div");
  editorContainer.className = "cm-md-html-block-widget__editor";
  state.contentEl.append(editorContainer);

  // 只在容器上听 focusout。嵌套 EditorView 自己的 domEventHandlers 会再冒泡一次。
  // 提交推迟到 microtask：避免在嵌套视图的事件回调里同步 destroy 它。
  editorContainer.addEventListener("focusout", (event) => {
    if (state.disposed || state.isAborting || state.isCommitting || state.mode !== "source-peek") {
      return;
    }
    const related = (event as FocusEvent).relatedTarget;
    if (related instanceof Element && related.closest(".cm-md-html-block-widget") === wrapper) {
      return;
    }
    queueMicrotask(() => {
      if (
        state.disposed ||
        state.isAborting ||
        state.isCommitting ||
        state.mode !== "source-peek" ||
        !editorContainer.isConnected
      ) {
        return;
      }
      commitSourcePeek(wrapper, state, "blur");
    });
  });

  const initialDoc =
    readDraft(state.draftStore, state.currentValue.recordId) ??
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
  ];

  state.nestedView = new EditorView({
    parent: editorContainer,
    state: EditorState.create({ doc: initialDoc, extensions }),
  });
  state.nestedView.focus();
}

export function cancelSourcePeek(wrapper: HTMLElement, state: HtmlBlockState): void {
  if (state.disposed || state.mode !== "source-peek") {
    return;
  }
  forgetDraft(state.draftStore, state.currentValue.recordId);
  finishPeek(wrapper, state);
}

export function commitSourcePeek(
  wrapper: HTMLElement,
  state: HtmlBlockState,
  reason: PeekCommitReason = "explicit",
): void {
  if (state.disposed || state.isCommitting || state.mode !== "source-peek" || !state.nestedView) {
    return;
  }
  const nestedView = state.nestedView;
  const newHtml = nestedView.state.doc.toString();
  const originalHtml = state.currentValue.rawHtml ?? state.currentValue.sanitizedHtml;

  if (newHtml !== originalHtml) {
    // 动态 Range 寻址：基于 recordId 实时查询最新区间，防御主文档行位移撕裂
    const rangeIndex = state.parentView.state.field(markdownRangeIndexField, false);
    const currentRecord = rangeIndex?.get(state.currentValue.recordId);
    if (!currentRecord) {
      rememberDraft(state.draftStore, state.currentValue.recordId, newHtml);
      notifyMissingRecord(wrapper, state, reason);
      return;
    }
    state.isCommitting = true;
    try {
      state.parentView.dispatch({
        changes: {
          from: currentRecord.fullRange.from,
          to: currentRecord.fullRange.to,
          insert: newHtml,
        },
        annotations: [Transaction.addToHistory.of(true), authorizeWysiwygProtectedChange.of(true)],
        userEvent: "input.type",
      });
    } finally {
      state.isCommitting = false;
    }
  }

  forgetDraft(state.draftStore, state.currentValue.recordId);
  finishPeek(wrapper, state);
}

function notifyMissingRecord(
  wrapper: HTMLElement,
  state: HtmlBlockState,
  reason: PeekCommitReason,
): void {
  ensureMissingRecordNotice(wrapper);
  if (reason === "blur" && state.recordMissingNotified) {
    return;
  }
  state.recordMissingNotified = true;
  dispatchEditorUserNotice(state.parentView, HTML_BLOCK_RECORD_MISSING_MESSAGE);
}

function ensureMissingRecordNotice(wrapper: HTMLElement): void {
  if (wrapper.querySelector(".cm-md-html-block-widget__notice")) {
    return;
  }
  const notice = wrapper.ownerDocument.createElement("div");
  notice.className = "cm-md-html-block-widget__notice";
  notice.setAttribute("role", "alert");
  notice.textContent = HTML_BLOCK_RECORD_MISSING_MESSAGE;
  const content = wrapper.querySelector(".cm-md-html-block-widget__content");
  if (content) {
    wrapper.insertBefore(notice, content);
  } else {
    wrapper.append(notice);
  }
}

function clearMissingRecordNotice(wrapper: HTMLElement): void {
  wrapper.querySelector(".cm-md-html-block-widget__notice")?.remove();
}

function releaseNestedEditor(state: HtmlBlockState): void {
  const nestedView = state.nestedView;
  state.nestedView = null;
  nestedView?.destroy();
}

function finishPeek(wrapper: HTMLElement, state: HtmlBlockState): void {
  state.mode = "rendered";
  state.isAborting = true;
  releaseNestedEditor(state);
  state.isAborting = false;
  state.isCommitting = false;
  state.recordMissingNotified = false;
  wrapper.classList.remove("cm-md-html-block-widget--peek");
  clearMissingRecordNotice(wrapper);
  if (state.disposed || !wrapper.isConnected) {
    return;
  }
  state.rebuildToolbar();
  state.rebuildContent();
  state.parentView.focus();
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
