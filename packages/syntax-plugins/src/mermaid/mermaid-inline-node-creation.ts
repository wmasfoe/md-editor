import type { MermaidWysiwygEditor } from "@visimer/core";
import type { EditorMessageTranslator } from "@md-editor/plugin-sdk/syntax";
import { isMermaidLabel } from "./mermaid-draft-editor.ts";

/**
 * Inline "new node" placeholder.
 *
 * Double-clicking empty canvas drops a dashed box at the pointer that accepts a
 * label in place. Committing the label appends a node; the box then disappears
 * and the real node appears wherever the automatic layout puts it.
 *
 * Why not morph the placeholder into the final node: this editor is
 * default-layout only and stores no coordinates, so the committed node's
 * position comes from the layout, not from the click. The placeholder is
 * therefore an input affordance, not a position promise — that is a deliberate
 * trade of automatic layout, not an unfinished feature.
 */

export interface InlineNodeCreationOptions {
  readonly editor: MermaidWysiwygEditor;
  /** The `.mw-canvas` element; the placeholder is positioned against it. */
  readonly container: HTMLElement;
  readonly text: EditorMessageTranslator;
  /** Report a rejected label to the host status line. */
  readonly onError: (message: string) => void;
  /** Suspends competing canvas mutations while the placeholder is open. */
  readonly onBusyChange: (busy: boolean) => void;
}

export interface InlineNodeCreationController {
  /** Open the placeholder at a client point. No-op when one is already open. */
  open(clientX: number, clientY: number): void;
  /** True while the placeholder is open, so other add-node paths can stand down. */
  isOpen(): boolean;
  destroy(): void;
}

export function installInlineNodeCreation(
  options: InlineNodeCreationOptions,
): InlineNodeCreationController {
  const { editor, container, text, onError, onBusyChange } = options;
  const doc = container.ownerDocument;

  let placeholder: HTMLElement | null = null;
  let input: HTMLElement | null = null;
  let committed = false;

  const close = (): void => {
    if (!placeholder) return;
    placeholder.remove();
    placeholder = null;
    input = null;
    committed = false;
    onBusyChange(false);
  };

  const commit = (): void => {
    if (!input || committed) return;
    const label = (input.textContent ?? "").trim();
    if (label === "") {
      // An empty label is a cancel, matching "click away without typing".
      close();
      return;
    }
    if (!isMermaidLabel(label)) {
      onError(
        text(
          "editor.mermaid.invalidLabel",
          "文字包含不支持的符号或换行，请使用单行文字和常规标点。",
        ),
      );
      input.focus();
      return;
    }
    committed = true;
    close();
    editor.dispatch({ type: "addNode", label });
  };
  const open = (clientX: number, clientY: number): void => {
    if (placeholder || container.classList.contains("mw-readonly")) return;
    const box = container.getBoundingClientRect();
    const element = doc.createElement("div");
    element.className = "mw-new-node";
    element.style.left = `${clientX - box.left + container.scrollLeft}px`;
    element.style.top = `${clientY - box.top + container.scrollTop}px`;

    const field = doc.createElement("div");
    field.className = "mw-new-node__input";
    field.contentEditable = "true";
    field.spellcheck = false;
    field.setAttribute("role", "textbox");
    field.setAttribute("aria-label", text("editor.mermaid.newNodeText", "新节点文字"));
    field.dataset.placeholder = text("editor.mermaid.nodeText", "节点文字");

    element.append(field);
    container.append(element);
    placeholder = element;
    input = field;
    committed = false;
    onBusyChange(true);
    field.focus();

    // Enter commits, Escape cancels; an IME composition Enter must not commit.
    field.addEventListener("keydown", (event) => {
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        commit();
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close();
      }
    });
    // Losing focus commits, which is the "type the name, click away" gesture.
    field.addEventListener("blur", () => commit());
  };

  return {
    open,
    isOpen: () => placeholder !== null,
    destroy() {
      close();
    },
  };
}
