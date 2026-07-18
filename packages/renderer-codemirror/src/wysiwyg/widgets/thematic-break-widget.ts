import { WidgetType, type EditorView } from "@codemirror/view";
import type { WysiwygDiagnostics } from "../../diagnostics.ts";
import { selectWysiwygAtom } from "../atom-selection.ts";

export interface ThematicBreakWidgetValue {
  readonly recordId: string;
  readonly selected: boolean;
  readonly diagnostics: WysiwygDiagnostics | null;
}

const listenersByDom = new WeakMap<HTMLElement, readonly EventListener[]>();

function preventWidgetSelection(event: Event): void {
  event.preventDefault();
}

export class ThematicBreakWidget extends WidgetType {
  constructor(readonly value: ThematicBreakWidgetValue) {
    super();
  }

  eq(other: ThematicBreakWidget): boolean {
    return (
      this.value.recordId === other.value.recordId && this.value.selected === other.value.selected
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const separator = view.dom.ownerDocument.createElement("span");
    separator.className = "cm-md-thematic-break-widget";
    separator.setAttribute("role", "separator");
    separator.setAttribute("tabindex", "-1");
    separator.setAttribute("aria-label", "Thematic break");
    const click: EventListener = (event) => {
      const mouseEvent = event as MouseEvent;
      selectWysiwygAtom(
        view,
        separator.dataset.recordId ?? "",
        mouseEvent.metaKey || mouseEvent.ctrlKey,
      );
    };
    separator.addEventListener("pointerdown", preventWidgetSelection);
    separator.addEventListener("click", click);
    listenersByDom.set(separator, [preventWidgetSelection, click]);
    updateThematicBreakDom(separator, this.value);
    this.value.diagnostics?.recordWidgetLifecycle("thematic-break", "create");
    return separator;
  }

  updateDOM(dom: HTMLElement): boolean {
    updateThematicBreakDom(dom, this.value);
    this.value.diagnostics?.recordWidgetLifecycle("thematic-break", "update");
    return true;
  }

  destroy(dom: HTMLElement): void {
    const listeners = listenersByDom.get(dom);
    if (listeners) {
      dom.removeEventListener("pointerdown", listeners[0]);
      dom.removeEventListener("click", listeners[1]);
      listenersByDom.delete(dom);
    }
    this.value.diagnostics?.recordWidgetLifecycle("thematic-break", "destroy");
  }
}

function updateThematicBreakDom(dom: HTMLElement, value: ThematicBreakWidgetValue): void {
  dom.dataset.recordId = value.recordId;
  dom.setAttribute("aria-selected", String(value.selected));
  dom.classList.toggle("cm-md-thematic-break-widget--selected", value.selected);
}
