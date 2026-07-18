import { WidgetType, type EditorView } from "@codemirror/view";
import type { WysiwygDiagnostics } from "../../diagnostics.ts";
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

interface ImageWidgetListeners {
  readonly pointerdown: EventListener;
  readonly click: EventListener;
  readonly load: EventListener;
  readonly error: EventListener;
}

const listenersByDom = new WeakMap<HTMLElement, ImageWidgetListeners>();

function preventWidgetSelection(event: Event): void {
  event.preventDefault();
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
    wrapper.addEventListener("pointerdown", preventWidgetSelection);
    wrapper.addEventListener("click", click);
    image.addEventListener("load", load);
    image.addEventListener("error", error);
    listenersByDom.set(wrapper, { pointerdown: preventWidgetSelection, click, load, error });
    updateImageDom(wrapper, this.value);
    this.value.diagnostics?.recordWidgetLifecycle("image", "create");
    return wrapper;
  }

  updateDOM(dom: HTMLElement): boolean {
    updateImageDom(dom, this.value);
    this.value.diagnostics?.recordWidgetLifecycle("image", "update");
    return true;
  }

  destroy(dom: HTMLElement): void {
    const listeners = listenersByDom.get(dom);
    const image = dom.querySelector("img");
    if (listeners) {
      dom.removeEventListener("pointerdown", listeners.pointerdown);
      dom.removeEventListener("click", listeners.click);
      image?.removeEventListener("load", listeners.load);
      image?.removeEventListener("error", listeners.error);
      listenersByDom.delete(dom);
    }
    this.value.diagnostics?.recordWidgetLifecycle("image", "destroy");
  }
}

function updateImageDom(dom: HTMLElement, value: ImageWidgetValue): void {
  const image = dom.querySelector<HTMLImageElement>("img");
  const placeholder = dom.querySelector<HTMLElement>(".cm-md-image-widget__placeholder");
  if (!image || !placeholder) {
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
  dom.dataset.imageDescription = value.alt.trim() || "Markdown image";
  dom.setAttribute("aria-selected", String(value.selected));
  updateImageAccessibleLabel(dom, !value.previewSource);
  image.alt = value.alt;
  image.title = value.title ?? "";
  placeholderTitle.textContent = "Image unavailable";
  placeholderAlt.textContent = value.alt.trim() || "Untitled image";
  placeholderSource.textContent = value.markdownSource.trim() || "No image source";

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
