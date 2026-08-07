import { EditorSelection, type EditorState } from "@codemirror/state";
import { WidgetType, type EditorView } from "@codemirror/view";
import type { WysiwygDiagnostics } from "../../diagnostics.ts";
import { markdownRangeIndexField } from "../../markdown/range-index.ts";
import { selectWysiwygAtom } from "../atom-selection.ts";

export interface ImageWidgetValue {
  readonly recordId: string;
  readonly markdownSource: string;
  readonly previewSource: string | null;
  readonly alt: string;
  readonly title: string | null;
  readonly active: boolean;
  readonly selected: boolean;
  readonly diagnostics: WysiwygDiagnostics | null;
}

/** 解析图片 markdown 源码(alt + src + 可选 title);畸形返回 null */
export function parseImageMarkdownSource(
  markdown: string,
): { readonly alt: string; readonly source: string; readonly title: string | null } | null {
  // src 支持 <...> 尖括号包裹(可含空格)或普通无空白形式;title 可选双引号
  const match = /^!\[([^\]]*)\]\(\s*(?:<([^>]+)>|([^)\s]+))(?:\s+"([^"]*)")?\s*\)$/u.exec(
    markdown.trim(),
  );
  if (!match) {
    return null;
  }
  const source = match[2] ?? match[3] ?? "";
  if (!source) {
    return null;
  }
  return { alt: match[1], source, title: match[4] ?? null };
}

/** 从 range-index 按 recordId 找图片记录范围(dispatch 替换/删除用) */
function recordRangeById(
  state: EditorState,
  recordId: string,
): { readonly from: number; readonly to: number } | null {
  const record = state
    .field(markdownRangeIndexField)
    .records.find((candidate) => candidate.id === recordId);
  return record ? { from: record.fullRange.from, to: record.fullRange.to } : null;
}

interface ImageWidgetDomState {
  readonly sourceInput: HTMLInputElement;
  readonly sourceRow: HTMLElement;
  readonly viewerButton: HTMLButtonElement;
  readonly onOutsidePointerDown: (event: PointerEvent) => void;
  readonly onViewKeyDown: (event: KeyboardEvent) => void;
  selected: boolean;
  /** 输入框内容是否正在被用户编辑(编辑中不被投影重建重置) */
  editing: boolean;
}

const widgetDomState = new WeakMap<HTMLElement, ImageWidgetDomState>();

interface ImageWidgetListeners {
  readonly pointerdown: EventListener;
  readonly click: EventListener;
  readonly load: EventListener;
  readonly error: EventListener;
  readonly viewerClick: EventListener;
  readonly sourceKeydown: EventListener;
}

const listenersByDom = new WeakMap<HTMLElement, ImageWidgetListeners>();

function preventWidgetSelection(event: Event): void {
  event.preventDefault();
}

/** 提交源码编辑:空输入删除图片;合法 markdown 替换 widget 范围 */
function commitImageSource(
  wrapper: HTMLElement,
  view: EditorView,
  state: ImageWidgetDomState,
): void {
  const widgetValue = wrapper.dataset.recordId ?? "";
  const markdown = state.sourceInput.value.trim();
  const range = recordRangeById(view.state, widgetValue);
  if (!range) {
    return;
  }
  if (!markdown) {
    view.dispatch({
      changes: { from: range.from, to: range.to },
      selection: EditorSelection.cursor(range.from),
      userEvent: "input.delete",
    });
    view.focus();
    return;
  }
  const details = parseImageMarkdownSource(markdown);
  if (!details) {
    wrapper.classList.add("cm-md-image-widget--source-invalid");
    return;
  }
  wrapper.classList.remove("cm-md-image-widget--source-invalid");
  if (view.state.sliceDoc(range.from, range.to) !== markdown) {
    view.dispatch({
      changes: { from: range.from, to: range.to, insert: markdown },
      userEvent: "input",
    });
  }
  // 同步后光标移到图片后,自动取消原子选中
  const cursor = Math.min(range.from + markdown.length, view.state.doc.length);
  view.dispatch({ selection: EditorSelection.cursor(cursor) });
  view.focus();
}

/** 删除整张图片 */
function deleteImage(wrapper: HTMLElement, view: EditorView): void {
  const recordId = wrapper.dataset.recordId ?? "";
  const range = recordRangeById(view.state, recordId);
  if (!range) {
    return;
  }
  view.dispatch({
    changes: { from: range.from, to: range.to },
    selection: EditorSelection.cursor(range.from),
    userEvent: "input.delete",
  });
  view.focus();
}

/** 放大查看器:全屏浮层显示大图,点击遮罩/Escape 关闭 */
function openImageViewer(wrapper: HTMLElement, view: EditorView): void {
  const previewSource = wrapper.dataset.previewSource;
  if (!previewSource) {
    return;
  }
  const document = view.dom.ownerDocument;
  const overlay = document.createElement("div");
  overlay.className = "cm-md-image-viewer";
  const image = document.createElement("img");
  image.className = "cm-md-image-viewer__image";
  image.src = previewSource;
  image.alt = wrapper.dataset.imageDescription ?? "Markdown image";
  overlay.append(image);
  document.body.append(overlay);

  const close = (): void => {
    overlay.remove();
    document.removeEventListener("keydown", onKeyDown, true);
    view.focus();
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  };
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) {
      close();
    }
  });
  document.addEventListener("keydown", onKeyDown, true);
}

export class ImageWidget extends WidgetType {
  constructor(readonly value: ImageWidgetValue) {
    super();
  }

  eq(other: ImageWidget): boolean {
    return (
      this.value.recordId === other.value.recordId &&
      this.value.markdownSource === other.value.markdownSource &&
      this.value.previewSource === other.value.previewSource &&
      this.value.alt === other.value.alt &&
      this.value.title === other.value.title &&
      this.value.active === other.value.active &&
      this.value.selected === other.value.selected
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const document = view.dom.ownerDocument;
    const wrapper = document.createElement("span");
    wrapper.className = "cm-md-image-widget";
    wrapper.setAttribute("role", "img");
    wrapper.setAttribute("tabindex", "-1");

    const image = document.createElement("img");
    image.className = "cm-md-image-widget__image";
    image.draggable = false;
    const placeholder = document.createElement("span");
    placeholder.className = "cm-md-image-widget__placeholder";
    placeholder.setAttribute("aria-hidden", "true");
    const placeholderTitle = document.createElement("span");
    placeholderTitle.className = "cm-md-image-widget__placeholder-title";
    const placeholderAlt = document.createElement("span");
    placeholderAlt.className = "cm-md-image-widget__placeholder-alt";
    const placeholderSource = document.createElement("code");
    placeholderSource.className = "cm-md-image-widget__placeholder-source";
    placeholder.append(placeholderTitle, placeholderAlt, placeholderSource);
    wrapper.append(image, placeholder);

    // 放大查看器按钮(图片右上角)
    const viewerButton = document.createElement("button");
    viewerButton.type = "button";
    viewerButton.className = "cm-md-image-widget__viewer";
    viewerButton.setAttribute("aria-label", "放大查看图片");
    viewerButton.title = "放大查看图片";
    viewerButton.textContent = "⤢";
    wrapper.append(viewerButton);

    // 源码编辑行:选中时显示,Enter 提交,Backspace 删除
    const sourceRow = document.createElement("span");
    sourceRow.className = "cm-md-image-widget__source-row";
    sourceRow.contentEditable = "false";
    const sourceInput = document.createElement("input");
    sourceInput.className = "cm-md-image-widget__source";
    sourceInput.type = "text";
    sourceInput.spellcheck = false;
    sourceInput.setAttribute("aria-label", "图片 markdown 源码");
    sourceRow.append(sourceInput);
    wrapper.append(sourceRow);

    const click: EventListener = (event) => {
      const mouseEvent = event as MouseEvent;
      selectWysiwygAtom(
        view,
        wrapper.dataset.recordId ?? "",
        mouseEvent.metaKey || mouseEvent.ctrlKey,
      );
    };
    const load: EventListener = () => {
      setImageFailure(wrapper, false);
      updateImageAccessibleLabel(wrapper, false);
    };
    const error: EventListener = () => {
      if (wrapper.dataset.failureRecorded !== "true") {
        wrapper.dataset.failureRecorded = "true";
        this.value.diagnostics?.recordSafeFallback("IMAGE_PREVIEW_LOAD_FAILED");
      }
      setImageFailure(wrapper, true);
      updateImageAccessibleLabel(wrapper, true);
    };
    const viewerClick: EventListener = (event) => {
      event.preventDefault();
      event.stopPropagation();
      openImageViewer(wrapper, view);
    };
    const sourceKeydown: EventListener = (event) => {
      const keyboardEvent = event as KeyboardEvent;
      const current = widgetDomState.get(wrapper);
      if (!current) {
        return;
      }
      if (keyboardEvent.key === "Enter") {
        keyboardEvent.preventDefault();
        commitImageSource(wrapper, view, current);
      } else if (
        (keyboardEvent.key === "Backspace" || keyboardEvent.key === "Delete") &&
        current.sourceInput.value.trim() === ""
      ) {
        keyboardEvent.preventDefault();
        deleteImage(wrapper, view);
      }
    };

    const onOutsidePointerDown = (event: PointerEvent): void => {
      if (event.target instanceof Node && wrapper.contains(event.target)) {
        return;
      }
      hideImageSource(wrapper);
    };
    const onViewKeyDown = (event: KeyboardEvent): void => {
      const current = widgetDomState.get(wrapper);
      if (
        !current?.selected ||
        (event.target instanceof Node && current.sourceRow.contains(event.target)) ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey
      ) {
        return;
      }
      if (event.key === "Backspace" || event.key === "Delete") {
        event.preventDefault();
        deleteImage(wrapper, view);
      }
    };

    widgetDomState.set(wrapper, {
      sourceInput,
      sourceRow,
      viewerButton,
      onOutsidePointerDown,
      onViewKeyDown,
      selected: false,
      editing: false,
    });

    wrapper.addEventListener("pointerdown", preventWidgetSelection);
    wrapper.addEventListener("click", click);
    viewerButton.addEventListener("click", viewerClick);
    sourceInput.addEventListener("keydown", sourceKeydown);
    image.addEventListener("load", load);
    image.addEventListener("error", error);
    listenersByDom.set(wrapper, {
      pointerdown: preventWidgetSelection,
      click,
      load,
      error,
      viewerClick,
      sourceKeydown,
    });
    updateImageDom(wrapper, this.value, view);
    this.value.diagnostics?.recordWidgetLifecycle("image", "create");
    return wrapper;
  }

  updateDOM(dom: HTMLElement, view: EditorView): boolean {
    updateImageDom(dom, this.value, view);
    this.value.diagnostics?.recordWidgetLifecycle("image", "update");
    return true;
  }

  destroy(dom: HTMLElement): void {
    const listeners = listenersByDom.get(dom);
    const image = dom.querySelector("img");
    const state = widgetDomState.get(dom);
    if (state) {
      dom.ownerDocument.removeEventListener("pointerdown", state.onOutsidePointerDown, true);
      dom.ownerDocument.removeEventListener("keydown", state.onViewKeyDown, true);
      widgetDomState.delete(dom);
    }
    if (listeners) {
      dom.removeEventListener("pointerdown", listeners.pointerdown);
      dom.removeEventListener("click", listeners.click);
      state?.viewerButton.removeEventListener("click", listeners.viewerClick);
      state?.sourceInput.removeEventListener("keydown", listeners.sourceKeydown);
      image?.removeEventListener("load", listeners.load);
      image?.removeEventListener("error", listeners.error);
      listenersByDom.delete(dom);
    }
    this.value.diagnostics?.recordWidgetLifecycle("image", "destroy");
  }
}

function hideImageSource(wrapper: HTMLElement): void {
  const state = widgetDomState.get(wrapper);
  if (!state) {
    return;
  }
  state.selected = false;
  state.editing = false;
  wrapper.classList.remove("cm-md-image-widget--source-invalid");
  wrapper.classList.remove("cm-md-image-widget--selected");
  state.sourceRow.hidden = true;
  wrapper.ownerDocument.removeEventListener("pointerdown", state.onOutsidePointerDown, true);
}

function showImageSource(wrapper: HTMLElement, view: EditorView): void {
  const state = widgetDomState.get(wrapper);
  if (!state) {
    return;
  }
  if (!state.selected) {
    // 首次显示:预填完整 markdown 源码(从 range-index 的 record 取,
    // widget 的 markdownSource 字段只是图片源 URL,不是完整源码)
    const recordId = wrapper.dataset.recordId ?? "";
    const range = view ? recordRangeById(view.state, recordId) : null;
    state.sourceInput.value =
      range && view
        ? view.state.sliceDoc(range.from, range.to)
        : (wrapper.dataset.markdownSource ?? "");
    wrapper.classList.remove("cm-md-image-widget--source-invalid");
    wrapper.classList.add("cm-md-image-widget--selected");
    state.sourceRow.hidden = false;
    wrapper.ownerDocument.addEventListener("pointerdown", state.onOutsidePointerDown, true);
    // 失焦时若仍选中,丢弃未提交编辑(与 Enter 提交语义一致)
    state.sourceInput.addEventListener(
      "blur",
      () => {
        if (widgetDomState.get(wrapper)?.selected) {
          hideImageSource(wrapper);
        }
      },
      { once: true },
    );
  }
  state.selected = true;
  state.editing = false;
}

function updateImageDom(dom: HTMLElement, value: ImageWidgetValue, view: EditorView): void {
  const image = dom.querySelector<HTMLImageElement>("img");
  const placeholder = dom.querySelector<HTMLElement>(".cm-md-image-widget__placeholder");
  const state = widgetDomState.get(dom);
  if (!image || !placeholder || !state) {
    return;
  }
  const placeholderTitle = placeholder.querySelector<HTMLElement>(
    ".cm-md-image-widget__placeholder-title",
  );
  const placeholderAlt = placeholder.querySelector<HTMLElement>(
    ".cm-md-image-widget__placeholder-alt",
  );
  const placeholderSource = placeholder.querySelector<HTMLElement>(
    ".cm-md-image-widget__placeholder-source",
  );
  if (!placeholderTitle || !placeholderAlt || !placeholderSource) {
    return;
  }

  dom.className = "cm-md-image-widget";
  dom.classList.toggle("cm-md-image-widget--active", value.active);
  dom.classList.toggle("cm-md-image-widget--selected", value.selected);
  dom.dataset.recordId = value.recordId;
  dom.dataset.markdownSource = value.markdownSource;
  dom.dataset.previewSource = value.previewSource ?? "";
  dom.dataset.imageDescription = value.alt.trim() || "Markdown image";
  dom.setAttribute("aria-selected", String(value.selected));
  updateImageAccessibleLabel(dom, !value.previewSource);
  image.alt = value.alt;
  image.title = value.title ?? "";
  placeholderTitle.textContent = "Image unavailable";
  placeholderAlt.textContent = value.alt.trim() || "Untitled image";
  placeholderSource.textContent = value.markdownSource.trim() || "No image source";

  // 选中态驱动源码编辑行显隐
  if (value.selected) {
    showImageSource(dom, view);
  } else {
    hideImageSource(dom);
  }

  if (!value.previewSource) {
    image.removeAttribute("src");
    setImageFailure(dom, true);
    return;
  }
  if (image.getAttribute("src") !== value.previewSource) {
    dom.dataset.failureRecorded = "false";
    setImageFailure(dom, false);
    image.src = value.previewSource;
  }
}

function setImageFailure(dom: HTMLElement, failed: boolean): void {
  const image = dom.querySelector<HTMLElement>("img");
  const placeholder = dom.querySelector<HTMLElement>(".cm-md-image-widget__placeholder");
  dom.classList.toggle("cm-md-image-widget--failed", failed);
  if (image) {
    image.hidden = failed;
  }
  if (placeholder) {
    placeholder.hidden = !failed;
  }
}

function updateImageAccessibleLabel(dom: HTMLElement, failed: boolean): void {
  const description = dom.dataset.imageDescription ?? "Markdown image";
  dom.setAttribute("aria-label", failed ? `${description}: preview unavailable` : description);
}
