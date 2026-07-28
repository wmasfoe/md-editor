import { WidgetType, type EditorView } from "@codemirror/view";
import type { WysiwygDiagnostics } from "../../diagnostics.ts";
import type { MarkdownCodeBlockKind } from "../../markdown/range-types.ts";
import {
  CODE_BLOCK_LANGUAGE_CHOICES,
  copyCodeBlockBodyById,
  selectCodeBlockBodyById,
  setCodeBlockLanguageById,
} from "../code-block-commands.ts";

export interface CodeBlockToolbarWidgetValue {
  readonly recordId: string;
  readonly blockKind: MarkdownCodeBlockKind;
  readonly languageLabel: string;
  readonly active: boolean;
  readonly diagnostics: WysiwygDiagnostics | null;
}

const cleanupByDom = new WeakMap<HTMLElement, readonly (() => void)[]>();

function keepEditorSelection(event: Event): void {
  event.preventDefault();
}

export class CodeBlockToolbarWidget extends WidgetType {
  constructor(readonly value: CodeBlockToolbarWidgetValue) {
    super();
  }

  eq(other: CodeBlockToolbarWidget): boolean {
    return (
      this.value.recordId === other.value.recordId &&
      this.value.blockKind === other.value.blockKind &&
      this.value.languageLabel === other.value.languageLabel &&
      this.value.active === other.value.active
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const toolbar = view.dom.ownerDocument.createElement("div");
    const selectButton = view.dom.ownerDocument.createElement("button");
    const copyButton = view.dom.ownerDocument.createElement("button");
    const cleanups: Array<() => void> = [];
    const currentRecordId = () => toolbar.dataset.recordId ?? this.value.recordId;

    if (this.value.blockKind === "fenced") {
      const language = view.dom.ownerDocument.createElement("select");
      language.className = "cm-md-code-toolbar__language";
      language.setAttribute("aria-label", "Code language");
      for (const choice of languageChoices(this.value.languageLabel)) {
        const option = view.dom.ownerDocument.createElement("option");
        option.value = choice.token;
        option.textContent = choice.label;
        language.append(option);
      }
      const onLanguageChange = () => {
        setCodeBlockLanguageById(view, currentRecordId(), language.value);
      };
      language.addEventListener("change", onLanguageChange);
      cleanups.push(() => language.removeEventListener("change", onLanguageChange));
      toolbar.append(language);
    }

    selectButton.type = "button";
    selectButton.className = "cm-md-code-toolbar__select";
    selectButton.textContent = "Select";
    selectButton.setAttribute("aria-label", "Select code block body");

    copyButton.type = "button";
    copyButton.className = "cm-md-code-toolbar__copy";
    copyButton.textContent = "Copy";
    copyButton.setAttribute("aria-label", "Copy code block body");

    const status = view.dom.ownerDocument.createElement("span");
    status.className = "cm-md-code-toolbar__status";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");

    const onSelectBody = () => {
      selectCodeBlockBodyById(view, currentRecordId());
    };
    const onCopyBody = () => {
      copyButton.disabled = true;
      setToolbarStatus(toolbar, "Copying");
      void copyCodeBlockBodyById(view, currentRecordId())
        .then((ok) => {
          if (!toolbar.isConnected) return;
          setToolbarStatus(toolbar, ok ? "Copied" : "Copy failed");
        })
        .finally(() => {
          if (!toolbar.isConnected) return;
          copyButton.disabled = false;
        });
    };
    const onKeyDown = (event: Event) => {
      if (!(event instanceof KeyboardEvent) || event.key !== "Escape") return;
      event.preventDefault();
      view.focus();
    };

    copyButton.addEventListener("pointerdown", keepEditorSelection);
    selectButton.addEventListener("click", onSelectBody);
    copyButton.addEventListener("click", onCopyBody);
    toolbar.addEventListener("keydown", onKeyDown);
    cleanups.push(
      () => copyButton.removeEventListener("pointerdown", keepEditorSelection),
      () => selectButton.removeEventListener("click", onSelectBody),
      () => copyButton.removeEventListener("click", onCopyBody),
      () => toolbar.removeEventListener("keydown", onKeyDown),
    );
    cleanupByDom.set(toolbar, cleanups);
    toolbar.append(selectButton, copyButton, status);
    updateCodeBlockToolbarDom(toolbar, this.value);
    this.value.diagnostics?.recordWidgetLifecycle("code-block", "create");
    return toolbar;
  }

  updateDOM(dom: HTMLElement): boolean {
    updateCodeBlockToolbarDom(dom, this.value);
    this.value.diagnostics?.recordWidgetLifecycle("code-block", "update");
    return true;
  }

  destroy(dom: HTMLElement): void {
    const cleanups = cleanupByDom.get(dom);
    if (cleanups) {
      for (const cleanup of cleanups) {
        cleanup();
      }
      cleanupByDom.delete(dom);
    }
    this.value.diagnostics?.recordWidgetLifecycle("code-block", "destroy");
  }
}

function updateCodeBlockToolbarDom(dom: HTMLElement, value: CodeBlockToolbarWidgetValue): void {
  const language = dom.querySelector<HTMLSelectElement>(".cm-md-code-toolbar__language");
  dom.className = "cm-md-code-toolbar";
  dom.classList.toggle("cm-md-code-toolbar--active", value.active);
  dom.dataset.recordId = value.recordId;
  dom.dataset.codeBlockKind = value.blockKind;
  dom.setAttribute("role", "toolbar");
  dom.setAttribute("aria-label", `${value.blockKind} code block actions`);
  if (language) {
    language.value = languageValueForLabel(value.languageLabel);
  }
}

function languageChoices(
  currentLabel: string,
): readonly { readonly label: string; readonly token: string }[] {
  const choices = [...CODE_BLOCK_LANGUAGE_CHOICES];
  if (
    currentLabel &&
    currentLabel !== "Plain" &&
    !choices.some((choice) => choice.label === currentLabel || choice.token === currentLabel)
  ) {
    choices.push({ label: `Custom: ${currentLabel}`, token: currentLabel });
  }
  return choices;
}

function languageValueForLabel(label: string): string {
  if (!label || label === "Plain") {
    return "";
  }
  return (
    CODE_BLOCK_LANGUAGE_CHOICES.find((choice) => choice.label === label || choice.token === label)
      ?.token ?? label
  );
}

function setToolbarStatus(toolbar: HTMLElement, text: string): void {
  const status = toolbar.querySelector<HTMLElement>(".cm-md-code-toolbar__status");
  if (status) {
    status.textContent = text;
  }
}
