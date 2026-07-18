import { WidgetType, type EditorView } from "@codemirror/view";
import type { WysiwygDiagnostics } from "../../diagnostics.ts";

export interface FrontmatterHeaderWidgetValue {
  readonly recordId: string;
  readonly status: "closed" | "unterminated";
  readonly errorCount: number;
  readonly diagnostics: WysiwygDiagnostics | null;
}

export class FrontmatterHeaderWidget extends WidgetType {
  constructor(readonly value: FrontmatterHeaderWidgetValue) {
    super();
  }

  eq(other: FrontmatterHeaderWidget): boolean {
    return (
      this.value.recordId === other.value.recordId &&
      this.value.status === other.value.status &&
      this.value.errorCount === other.value.errorCount
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const header = view.dom.ownerDocument.createElement("span");
    const status = view.dom.ownerDocument.createElement("span");
    status.className = "cm-md-frontmatter-header__status";
    header.append(status);
    updateFrontmatterHeaderDom(header, this.value);
    this.value.diagnostics?.recordWidgetLifecycle("frontmatter", "create");
    return header;
  }

  updateDOM(dom: HTMLElement): boolean {
    updateFrontmatterHeaderDom(dom, this.value);
    this.value.diagnostics?.recordWidgetLifecycle("frontmatter", "update");
    return true;
  }

  destroy(): void {
    this.value.diagnostics?.recordWidgetLifecycle("frontmatter", "destroy");
  }

  ignoreEvent(): boolean {
    return true;
  }
}

function updateFrontmatterHeaderDom(dom: HTMLElement, value: FrontmatterHeaderWidgetValue): void {
  const status = dom.querySelector<HTMLElement>(".cm-md-frontmatter-header__status");
  if (!status) {
    return;
  }

  const hasError = value.errorCount > 0;
  const statusText =
    value.status === "unterminated" ? "Unterminated YAML" : hasError ? "YAML error" : "";
  dom.className = "cm-md-frontmatter-header";
  dom.classList.toggle("cm-md-frontmatter-header--error", hasError);
  dom.dataset.recordId = value.recordId;
  dom.dataset.frontmatterStatus = value.status;
  dom.setAttribute("role", "status");
  dom.setAttribute("aria-live", "polite");
  dom.setAttribute("aria-label", statusText || "YAML metadata");
  dom.hidden = statusText.length === 0;
  status.textContent = statusText;
}
