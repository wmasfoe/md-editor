import { WidgetType, type EditorView } from "@codemirror/view";
import type { WysiwygDiagnostics } from "../../diagnostics.ts";
import type { MarkdownSyntaxKind } from "../../markdown/range-types.ts";
import { selectWysiwygAtom } from "../atom-selection.ts";

export interface DefaultAtomWidgetValue {
  readonly recordId: string;
  readonly kind: MarkdownSyntaxKind;
  readonly primaryText: string;
  readonly secondaryText: string | null;
  readonly accessibleLabel: string;
  readonly selected: boolean;
  readonly block: boolean;
  readonly headingLevel: 1 | 2 | null;
  readonly diagnostics: WysiwygDiagnostics | null;
}

const listenersByDom = new WeakMap<HTMLElement, readonly EventListener[]>();

function preventWidgetSelection(event: Event): void {
  event.preventDefault();
}

export class DefaultAtomWidget extends WidgetType {
  constructor(readonly value: DefaultAtomWidgetValue) {
    super();
  }

  eq(other: DefaultAtomWidget): boolean {
    return (
      this.value.recordId === other.value.recordId &&
      this.value.kind === other.value.kind &&
      this.value.primaryText === other.value.primaryText &&
      this.value.secondaryText === other.value.secondaryText &&
      this.value.accessibleLabel === other.value.accessibleLabel &&
      this.value.selected === other.value.selected &&
      this.value.block === other.value.block &&
      this.value.headingLevel === other.value.headingLevel
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const atom = view.dom.ownerDocument.createElement("span");
    const primary = view.dom.ownerDocument.createElement("span");
    const secondary = view.dom.ownerDocument.createElement("span");
    primary.className = "cm-md-default-atom__primary";
    secondary.className = "cm-md-default-atom__secondary";
    secondary.setAttribute("aria-hidden", "true");
    atom.append(primary, secondary);

    const click: EventListener = (event) => {
      const mouseEvent = event as MouseEvent;
      selectWysiwygAtom(
        view,
        atom.dataset.recordId ?? "",
        mouseEvent.metaKey || mouseEvent.ctrlKey,
      );
    };
    atom.addEventListener("pointerdown", preventWidgetSelection);
    atom.addEventListener("click", click);
    listenersByDom.set(atom, [preventWidgetSelection, click]);
    updateDefaultAtomDom(atom, this.value);
    this.value.diagnostics?.recordWidgetLifecycle("default", "create");
    return atom;
  }

  updateDOM(dom: HTMLElement): boolean {
    updateDefaultAtomDom(dom, this.value);
    this.value.diagnostics?.recordWidgetLifecycle("default", "update");
    return true;
  }

  destroy(dom: HTMLElement): void {
    const listeners = listenersByDom.get(dom);
    if (listeners) {
      dom.removeEventListener("pointerdown", listeners[0]);
      dom.removeEventListener("click", listeners[1]);
      listenersByDom.delete(dom);
    }
    this.value.diagnostics?.recordWidgetLifecycle("default", "destroy");
  }
}

function updateDefaultAtomDom(dom: HTMLElement, value: DefaultAtomWidgetValue): void {
  const primary = dom.querySelector<HTMLElement>(".cm-md-default-atom__primary");
  const secondary = dom.querySelector<HTMLElement>(".cm-md-default-atom__secondary");
  if (!primary || !secondary) {
    return;
  }

  dom.className = `cm-md-default-atom cm-md-default-atom--${value.kind}`;
  dom.classList.toggle("cm-md-default-atom--block", value.block);
  dom.classList.toggle("cm-md-default-atom--selected", value.selected);
  dom.dataset.recordId = value.recordId;
  dom.dataset.syntaxKind = value.kind;
  dom.setAttribute("tabindex", "-1");
  dom.setAttribute("aria-label", value.accessibleLabel);
  dom.setAttribute("aria-selected", String(value.selected));
  dom.setAttribute(
    "role",
    value.headingLevel ? "heading" : value.kind === "footnote" ? "note" : "group",
  );
  if (value.headingLevel) {
    dom.setAttribute("aria-level", String(value.headingLevel));
  } else {
    dom.removeAttribute("aria-level");
  }
  primary.textContent = value.primaryText;
  secondary.textContent = value.secondaryText ?? "";
  secondary.hidden = !value.secondaryText;
}
