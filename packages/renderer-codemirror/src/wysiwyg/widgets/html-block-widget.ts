import { WidgetType, type EditorView } from "@codemirror/view";
import type { WysiwygDiagnostics } from "../../diagnostics.ts";
import { selectWysiwygAtom } from "../atom-selection.ts";

export interface HtmlBlockWidgetValue {
  readonly recordId: string;
  readonly sanitizedHtml: string;
  readonly placeholder: string | null;
  readonly selected: boolean;
  readonly diagnostics: WysiwygDiagnostics | null;
}

interface HtmlBlockWidgetListeners {
  readonly pointerdown: EventListener;
  readonly click: EventListener;
}

const listenersByDom = new WeakMap<HTMLElement, HtmlBlockWidgetListeners>();

function preventWidgetSelection(event: Event): void {
  event.preventDefault();
}

/**
 * HTMLBlock 的 DOM 边界：sanitize 后先经 DOMParser 解析，再逐节点以 createElement、
 * textContent、setAttribute 重建到编辑器文档，绝不把用户字符串交给 innerHTML。
 */
export class HtmlBlockWidget extends WidgetType {
  constructor(readonly value: HtmlBlockWidgetValue) {
    super();
  }

  eq(other: HtmlBlockWidget): boolean {
    return (
      this.value.recordId === other.value.recordId &&
      this.value.sanitizedHtml === other.value.sanitizedHtml &&
      this.value.placeholder === other.value.placeholder &&
      this.value.selected === other.value.selected
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const wrapper = view.dom.ownerDocument.createElement("div");
    const click: EventListener = (event) => {
      const mouseEvent = event as MouseEvent;
      selectWysiwygAtom(
        view,
        wrapper.dataset.recordId ?? "",
        mouseEvent.metaKey || mouseEvent.ctrlKey,
      );
    };
    wrapper.addEventListener("pointerdown", preventWidgetSelection);
    wrapper.addEventListener("click", click);
    listenersByDom.set(wrapper, { pointerdown: preventWidgetSelection, click });
    updateHtmlBlockDom(wrapper, this.value);
    this.value.diagnostics?.recordWidgetLifecycle("html", "create");
    return wrapper;
  }

  updateDOM(dom: HTMLElement): boolean {
    updateHtmlBlockDom(dom, this.value);
    this.value.diagnostics?.recordWidgetLifecycle("html", "update");
    return true;
  }

  destroy(dom: HTMLElement): void {
    const listeners = listenersByDom.get(dom);
    if (listeners) {
      dom.removeEventListener("pointerdown", listeners.pointerdown);
      dom.removeEventListener("click", listeners.click);
      listenersByDom.delete(dom);
    }
    this.value.diagnostics?.recordWidgetLifecycle("html", "destroy");
  }
}

function updateHtmlBlockDom(dom: HTMLElement, value: HtmlBlockWidgetValue): void {
  const document = dom.ownerDocument;
  dom.className = "cm-md-html-block-widget";
  dom.dataset.recordId = value.recordId;
  dom.setAttribute("role", "group");
  dom.setAttribute("tabindex", "-1");
  dom.setAttribute("aria-label", "HTML block");
  dom.setAttribute("aria-selected", String(value.selected));
  dom.classList.toggle("cm-md-html-block-widget--selected", value.selected);
  dom.replaceChildren();

  if (value.placeholder) {
    appendPlaceholder(dom, value.placeholder);
    return;
  }

  const nodes = parseAndRebuildHtml(document, value.sanitizedHtml);
  if (!nodes) {
    appendPlaceholder(dom, "HTML preview unavailable; edit the original source instead.");
    return;
  }
  dom.append(...nodes);
}

function appendPlaceholder(dom: HTMLElement, message: string): void {
  const placeholder = dom.ownerDocument.createElement("span");
  placeholder.className = "cm-md-html-block-widget__placeholder";
  placeholder.setAttribute("role", "alert");
  placeholder.textContent = message;
  dom.append(placeholder);
}

function parseAndRebuildHtml(document: Document, html: string): Node[] | null {
  const Parser =
    document.defaultView?.DOMParser ?? (typeof DOMParser === "undefined" ? null : DOMParser);
  if (!Parser) {
    return null;
  }
  const parsed = new Parser().parseFromString(`<body>${html}</body>`, "text/html");
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
  const element = document.createElement(sourceElement.tagName.toLowerCase());
  for (const attribute of Array.from(sourceElement.attributes)) {
    element.setAttribute(attribute.name, attribute.value);
  }
  for (const child of Array.from(sourceElement.childNodes)) {
    element.append(rebuildNode(document, child));
  }
  return element;
}
