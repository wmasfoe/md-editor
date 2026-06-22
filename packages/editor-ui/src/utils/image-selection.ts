import { $prose } from "@milkdown/kit/utils";
import type { Node as ProseMirrorNode } from "@milkdown/kit/prose/model";
import { NodeSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";

export const imageSelectionPluginKey = new PluginKey("md-editor-image-selection");

export const imageSelectionPlugin = $prose(
  () =>
    new Plugin({
      key: imageSelectionPluginKey,
      props: {
        handleDOMEvents: {
          click(view, event) {
            return handleImagePointerEvent(view, event);
          },
          dragstart(_, event) {
            if (findImageElement(event.target)) {
              event.preventDefault();
              return true;
            }
            return false;
          }
        },
        handleClickOn(view, position, node, nodePosition, event) {
          if (node.type.name !== "image") {
            clearStaleSelectedImageDom(view);
            return false;
          }

          event.preventDefault();
          event.stopPropagation();
          selectImageNode(view, nodePosition);
          return true;
        },
        handleKeyDown(view, event) {
          if (!(event.key === "Backspace" || event.key === "Delete")) {
            return false;
          }

          const selection = view.state.selection;
          if (!(selection instanceof NodeSelection) || selection.node.type.name !== "image") {
            return false;
          }

          event.preventDefault();
          view.dispatch(view.state.tr.deleteSelection().scrollIntoView());
          return true;
        }
      },
      view(view) {
        prepareImageDom(view);
        setImageSelectionGuard(view);
        const removeSelectionGuard = bindNativeSelectionGuard(view);
        return {
          update(nextView) {
            prepareImageDom(nextView);
            setImageSelectionGuard(nextView);
            const selection = nextView.state.selection;
            if (selection instanceof NodeSelection && selection.node.type.name === "image") {
              clearNativeSelection(nextView);
              markSelectedImageDom(nextView, selection.from);
            } else {
              clearStaleSelectedImageDom(nextView);
            }
          },
          destroy() {
            removeSelectionGuard();
            view.dom.classList.remove("md-editor-image-node-selected");
          }
        };
      }
    })
);

export function selectImageNode(view: EditorView, position: number): void {
  clearNativeSelection(view);
  view.dispatch(
    view.state.tr
      .setSelection(NodeSelection.create(view.state.doc, position))
      .scrollIntoView()
  );
  view.focus();
  markSelectedImageDom(view, position);
  scheduleNativeSelectionCleanup(view);
}

export function findImageNodePositionForDom(
  doc: ProseMirrorNode,
  nodeDOM: (position: number) => Node | null,
  target: Node
): number | null {
  let foundPosition: number | null = null;

  doc.descendants((node, position) => {
    if (node.type.name !== "image") {
      return;
    }

    const dom = nodeDOM(position);
    if (dom && containsDomNode(dom, target)) {
      foundPosition = position;
      return false;
    }
  });

  return foundPosition;
}

function containsDomNode(parent: Node, target: Node): boolean {
  return parent === target || (typeof parent.contains === "function" && parent.contains(target));
}

function handleImagePointerEvent(view: EditorView, event: MouseEvent): boolean {
  const image = findImageElement(event.target);
  if (!image) {
    return false;
  }

  const position = findImageNodePositionForDom(view.state.doc, (pos) => view.nodeDOM(pos), image);
  if (position === null) {
    return false;
  }

  // Desktop WebKit can expose Live Text/OCR interactions on images. Claiming
  // the pointer event here keeps image clicks as editor node selection only.
  event.preventDefault();
  event.stopPropagation();
  selectImageNode(view, position);
  return true;
}

function clearNativeSelection(view: EditorView): void {
  const root = view.root;
  const selection = root instanceof Document ? root.getSelection() : window.getSelection();
  selection?.removeAllRanges();
}

function bindNativeSelectionGuard(view: EditorView): () => void {
  const root = view.root;
  const ownerDocument = root instanceof Document ? root : view.dom.ownerDocument;
  const handleSelectionChange = () => {
    if (!hasSelectedImageNode(view) || !hasNativeSelectionInside(view)) {
      return;
    }

    clearNativeSelection(view);
  };

  ownerDocument.addEventListener("selectionchange", handleSelectionChange);

  return () => {
    ownerDocument.removeEventListener("selectionchange", handleSelectionChange);
    view.dom.classList.remove("md-editor-image-node-selected");
  };
}

function setImageSelectionGuard(view: EditorView): void {
  view.dom.classList.toggle("md-editor-image-node-selected", hasSelectedImageNode(view));
}

export function isImageNodeSelection(selection: unknown): boolean {
  return selection instanceof NodeSelection && selection.node.type.name === "image";
}

function hasSelectedImageNode(view: EditorView): boolean {
  const selection = view.state.selection;
  return isImageNodeSelection(selection);
}

function hasNativeSelectionInside(view: EditorView): boolean {
  const root = view.root;
  const selection = root instanceof Document ? root.getSelection() : window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return false;
  }

  const anchor = selection.anchorNode;
  const focus = selection.focusNode;
  return Boolean(
    (anchor && view.dom.contains(anchor)) ||
    (focus && view.dom.contains(focus))
  );
}

function scheduleNativeSelectionCleanup(view: EditorView): void {
  [0, 50, 250, 750, 1200].forEach((delay) => {
    window.setTimeout(() => {
      if (hasSelectedImageNode(view)) {
        clearNativeSelection(view);
      }
    }, delay);
  });
}

function prepareImageDom(view: EditorView): void {
  view.dom.querySelectorAll<HTMLImageElement>("img").forEach((image) => {
    image.draggable = false;
    image.setAttribute("contenteditable", "false");
    image.dataset.mdEditorImage = "true";
  });
}

function findImageElement(target: EventTarget | null): HTMLImageElement | null {
  return target instanceof Element ? target.closest<HTMLImageElement>("img") : null;
}

function markSelectedImageDom(view: EditorView, position: number): void {
  clearStaleSelectedImageDom(view);
  const node = view.nodeDOM(position);
  if (node instanceof HTMLElement) {
    node.classList.add("md-editor-selected-image");
  }
}

function clearStaleSelectedImageDom(view: EditorView): void {
  view.dom
    .querySelectorAll(".md-editor-selected-image")
    .forEach((node) => node.classList.remove("md-editor-selected-image"));
}
